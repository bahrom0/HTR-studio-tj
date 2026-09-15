import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { JobService } from '@/server/jobs/job-service';
import { RecognitionJobService } from '@/server/recognition/service';
import { getServerConfig } from '@/server/config';
import { assertSameOrigin, errorResponse, jsonNoStore } from '@/server/security/request';
import { enforceRateLimit } from '@/server/security/rate-limit';
import { scheduleRecognitionFastPath } from '@/server/recognition/fast-path';

export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(_req);
    const config = getServerConfig();
    await enforceRateLimit(_req, 'jobs:retry', config.DOCUMENT_RATE_LIMIT_PER_MINUTE);
    const { id: jobId } = await params;
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);

    const existingJob = await JobService.getJob(jobId, user.id, supabase);
    const retriedJob = existingJob?.kind === 'recognition'
      ? await RecognitionJobService.retryRecognitionJob(jobId, user.id, supabase)
      : await JobService.retryJob(jobId, user.id, supabase);

    if (retriedJob.kind === 'recognition' && retriedJob.status === 'queued') {
      scheduleRecognitionFastPath(retriedJob.id);
    }

    return jsonNoStore({ job: retriedJob });
  } catch (err) {
    return errorResponse(err);
  }
}
