import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/session';
import { JobService } from '@/server/jobs/job-service';
import { assertSameOrigin, errorResponse, HttpError, jsonNoStore } from '@/server/security/request';
import { createServerSupabaseClient } from '@/server/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id: jobId } = await params;
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);
    const job = await JobService.getJob(jobId, user.id, supabase);

    if (!job) {
      throw new HttpError('Задача не найдена.', 'JOB_NOT_FOUND', 404, false);
    }
    if (job.kind !== 'recognition') {
      throw new HttpError('Эта задача не поддерживает отмену.', 'JOB_CANCEL_UNSUPPORTED', 409, false);
    }

    const terminal = ['succeeded', 'partial', 'failed', 'cancelled'].includes(job.status);
    if (!terminal) {
      const { error } = await supabase
        .from('jobs')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('owner_id', user.id);
      if (error) throw new HttpError('Не удалось отменить задачу.', 'JOB_CANCEL_FAILED', 503, true);

      // A terminal cancel immediately frees a stuck task for a user retry.
      // A currently running batch may finish its in-flight request, but the
      // worker observes this status before submitting a subsequent batch.
      await supabase
        .from('job_outbox')
        .update({ dispatch_state: 'dispatched' })
        .eq('job_id', jobId);
      await supabase
        .from('documents')
        .update({ state: 'lines_ready', updated_at: new Date().toISOString() })
        .eq('id', job.documentId)
        .eq('owner_id', user.id);
    }

    const updatedJob = await JobService.getJob(jobId, user.id, supabase);
    return jsonNoStore({ job: updatedJob });
  } catch (error) {
    return errorResponse(error);
  }
}
