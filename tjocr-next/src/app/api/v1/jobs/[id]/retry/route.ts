import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { JobService } from '@/server/jobs/job-service';
import { getServerConfig } from '@/server/config';
import { assertSameOrigin, errorResponse, jsonNoStore } from '@/server/security/request';
import { enforceRateLimit } from '@/server/security/rate-limit';

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

    const retriedJob = await JobService.retryJob(jobId, user.id, supabase);

    return jsonNoStore({ job: retriedJob });
  } catch (err) {
    return errorResponse(err);
  }
}
