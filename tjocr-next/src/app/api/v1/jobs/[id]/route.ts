import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { JobService } from '@/server/jobs/job-service';
import { errorResponse, jsonNoStore } from '@/server/security/request';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);

    const job = await JobService.getJob(jobId, user.id, supabase);

    if (!job) {
      return jsonNoStore(
        {
          error: {
            code: 'JOB_NOT_FOUND',
            messageKey: 'jobs.notFound',
            retryable: false,
          },
        },
        { status: 404 }
      );
    }

    return jsonNoStore({ job });
  } catch (err) {
    return errorResponse(err);
  }
}
