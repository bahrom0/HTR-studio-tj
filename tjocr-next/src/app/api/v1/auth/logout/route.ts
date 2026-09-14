import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { assertSameOrigin, errorResponse, jsonNoStore } from '@/server/security/request';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
    return jsonNoStore({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
