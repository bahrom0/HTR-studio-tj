import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { assertSameOrigin, errorResponse, jsonNoStore } from '@/server/security/request';
import { RecognitionJobService } from '@/server/recognition/service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id: pageId } = await params;
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);

    let revisionId: string | undefined;
    try {
      const body = await request.json();
      if (body && typeof body.revisionId === 'string') {
        revisionId = body.revisionId;
      }
    } catch {
      // Body may be empty, defaults to latest confirmed revision
    }

    const { job, alreadyRunning } = await RecognitionJobService.startRecognitionJob(
      pageId,
      user.id,
      revisionId,
      supabase,
    );

    if (!alreadyRunning) {
      try {
        const completedJob = await RecognitionJobService.executeRecognition(
          job.id,
          user.id,
          supabase,
        );
        return jsonNoStore(
          {
            success: true,
            jobId: completedJob.id,
            status: completedJob.status,
            completedCount: completedJob.completedCount,
            failedCount: completedJob.failedCount,
            totalCount: completedJob.totalCount,
          },
          { status: 202 },
        );
      } catch (execError) {
        return jsonNoStore(
          {
            success: false,
            jobId: job.id,
            status: 'failed',
            error: execError instanceof Error ? execError.message : 'Recognition failed',
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
        completedCount: job.completedCount,
        failedCount: job.failedCount,
        totalCount: job.totalCount,
      },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
