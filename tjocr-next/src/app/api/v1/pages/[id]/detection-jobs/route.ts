import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { assertSameOrigin, errorResponse, jsonNoStore } from '@/server/security/request';
import { DetectionJobService } from '@/server/detection/service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id: pageId } = await params;
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);

    const { job, alreadyRunning } = await DetectionJobService.startDetectionJob(pageId, user.id, supabase);

    if (!alreadyRunning) {
      // Execute the detection step
      // In serverless / Vercel runtime, execute synchronously within the handler window
      try {
        const completedJob = await DetectionJobService.executeDetection(job.id, pageId, user.id, supabase);
        return jsonNoStore(
          {
            success: true,
            jobId: completedJob.id,
            status: completedJob.status,
            completedCount: completedJob.completedCount,
            totalCount: completedJob.totalCount,
          },
          { status: 202 },
        );
      } catch {
        // Return 202 with failed status so client can handle retry gracefully
        return jsonNoStore(
          {
            success: false,
            jobId: job.id,
            status: 'failed',
            error: 'Recognition request failed.',
          },
          { status: 202 },
        );
      }
    }

    return jsonNoStore(
      {
        success: true,
        jobId: job.id,
        status: job.status,
        alreadyRunning: true,
      },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
