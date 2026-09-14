import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { errorResponse, jsonNoStore } from '@/server/security/request';
import { RecognitionJobService } from '@/server/recognition/service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: documentId } = await params;
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);

    const lineResults = await RecognitionJobService.getLineResults(
      documentId,
      user.id,
      supabase,
    );

    return jsonNoStore({ lineResults }, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
