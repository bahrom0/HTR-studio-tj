import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { assertSameOrigin, errorResponse, jsonNoStore } from '@/server/security/request';
import { RecognitionJobService } from '@/server/recognition/service';
import { scheduleRecognitionFastPath } from '@/server/recognition/fast-path';

export const maxDuration = 60;

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
      scheduleRecognitionFastPath(job.id);
    }

    return jsonNoStore(
      {
        success: true,
        jobId: job.id,
        status: job.status,
        alreadyRunning,
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
