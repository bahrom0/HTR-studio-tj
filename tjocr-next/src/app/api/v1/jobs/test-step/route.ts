import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { JobService } from '@/server/jobs/job-service';
import { getServerConfig } from '@/server/config';
import { assertSameOrigin, errorResponse, HttpError, jsonNoStore } from '@/server/security/request';
import { enforceRateLimit } from '@/server/security/rate-limit';

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const config = getServerConfig();
    await enforceRateLimit(req, 'jobs:test-step', config.DOCUMENT_RATE_LIMIT_PER_MINUTE);
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);

    const body = await req.json().catch(() => ({}));
    const { documentId, simulateFailure = false } = body;

    if (!documentId) {
      throw new HttpError('Нужен идентификатор документа.', 'DOCUMENT_ID_REQUIRED', 400, false);
    }

    // 1. Create job in queued state using user's authenticated client
    const job = await JobService.createTestJob({
      documentId,
      ownerId: user.id,
      simulateFailure,
      client: supabase,
    });

    // 2. Execute step (simulates durable step execution)
    const executedJob = await JobService.executeStep(job.id, simulateFailure, supabase);

    return jsonNoStore({ job: executedJob });
  } catch (err) {
    return errorResponse(err);
  }
}
