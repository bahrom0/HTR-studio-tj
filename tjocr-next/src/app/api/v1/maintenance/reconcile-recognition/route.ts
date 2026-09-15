import { NextRequest } from 'next/server';
import { start } from 'workflow/api';
import { getServerConfig } from '@/server/config';
import { errorResponse, HttpError, jsonNoStore } from '@/server/security/request';
import { createAdminSupabaseClient } from '@/server/supabase/admin';
import { runRecognitionWorkflow } from '@/workflows/recognition';

const MAX_DISPATCHES_PER_RUN = 10;
const MAX_DISPATCH_ATTEMPTS = 5;

export async function GET(request: NextRequest) {
  try {
    const config = getServerConfig();
    if (!config.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${config.CRON_SECRET}`) {
      throw new HttpError('Недопустимый вызов обслуживания.', 'CRON_FORBIDDEN', 401, false);
    }

    const db = createAdminSupabaseClient();
    const now = new Date().toISOString();
    const { data: pending, error } = await db
      .from('job_outbox')
      .select('job_id, attempts, payload, jobs!inner(kind, status)')
      .eq('dispatch_state', 'pending')
      .lte('next_attempt_at', now)
      .eq('jobs.kind', 'recognition')
      .in('jobs.status', ['queued', 'running'])
      .order('next_attempt_at', { ascending: true })
      .limit(MAX_DISPATCHES_PER_RUN);
    if (error) throw new HttpError('Не удалось прочитать outbox.', 'OUTBOX_READ_FAILED', 503, true);

    let dispatched = 0;
    let deferred = 0;
    for (const item of pending || []) {
      try {
        const run = await start(runRecognitionWorkflow, [item.job_id]);
        // Do not refresh updated_at here. The workflow can claim a recovery
        // only when the abandoned running job is still stale.
        await db.from('jobs').update({ workflow_id: run.runId }).eq('id', item.job_id);
        await db.from('job_outbox').update({
          // Keep it pending until the workflow itself finishes. If the
          // Workflow service is interrupted before it can claim the stale
          // job, the outbox remains recoverable on the next maintenance run.
          dispatch_state: 'pending',
          attempts: item.attempts + 1,
          next_attempt_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        }).eq('job_id', item.job_id);
        dispatched++;
      } catch {
        const attempts = item.attempts + 1;
        const exhausted = attempts >= MAX_DISPATCH_ATTEMPTS;
        const backoffMs = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1));
        await db.from('job_outbox').update({
          dispatch_state: exhausted ? 'failed' : 'pending',
          attempts,
          next_attempt_at: new Date(Date.now() + backoffMs).toISOString(),
        }).eq('job_id', item.job_id);
        if (exhausted) {
          await db.from('jobs').update({ status: 'failed', error_code: 'WORKFLOW_DISPATCH_FAILED', updated_at: new Date().toISOString() }).eq('id', item.job_id);
        }
        deferred++;
      }
    }

    return jsonNoStore({ dispatched, deferred });
  } catch (error) {
    return errorResponse(error);
  }
}
