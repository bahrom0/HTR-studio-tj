import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { ExportLayoutService } from '@/server/exports/layout-service';
import { assertSameOrigin, errorResponse, jsonNoStore } from '@/server/security/request';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id: documentId } = await params;
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);
    return jsonNoStore({ layout: await ExportLayoutService.analyse(documentId, user.id, supabase) });
  } catch (error) {
    return errorResponse(error);
  }
}
