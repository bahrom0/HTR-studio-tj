import { createServerSupabaseClient } from '@/server/supabase/server';
import { getAuthenticatedUser } from '@/server/auth/session';
import { getDocumentQuota } from '@/server/limits/quota';
import { errorResponse, jsonNoStore } from '@/server/security/request';

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return jsonNoStore({ user: null, quota: null });

    return jsonNoStore({
      user,
      quota: await getDocumentQuota(supabase),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
