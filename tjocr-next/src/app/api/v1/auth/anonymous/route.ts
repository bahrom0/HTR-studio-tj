import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { getAuthenticatedUser } from '@/server/auth/session';
import { getServerConfig } from '@/server/config';
import { assertSameOrigin, errorResponse, jsonNoStore } from '@/server/security/request';
import { enforceRateLimit } from '@/server/security/rate-limit';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const config = getServerConfig();
    await enforceRateLimit(request, 'auth:anonymous', config.ANONYMOUS_RATE_LIMIT_PER_MINUTE);

    const supabase = await createServerSupabaseClient();
    const existingUser = await getAuthenticatedUser(supabase);
    if (existingUser) {
      return jsonNoStore({
        user: existingUser,
        expiresAt: null,
        created: false,
      });
    }

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.session) {
      console.error('[Auth Error] Supabase anonymous sign-in failed:', error?.code || 'unknown');
      const message = error?.code === 'anonymous_provider_disabled'
        ? 'В Supabase включите Anonymous Sign-ins для гостевого режима.'
        : 'Не удалось открыть гостевую сессию.';
      return jsonNoStore(
        {
          error: {
            code: error?.code || 'AUTH_ANONYMOUS_FAILED',
            messageKey: message,
            retryable: true,
          },
        },
        { status: 400 },
      );
    }

    return jsonNoStore({
      user: {
        id: data.session.user.id,
        isAnonymous: data.session.user.is_anonymous ?? true,
      },
      expiresAt: data.session.expires_at,
      created: true,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
