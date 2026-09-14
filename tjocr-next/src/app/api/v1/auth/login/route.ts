import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { getServerConfig } from '@/server/config';
import { assertSameOrigin, errorResponse, HttpError, jsonNoStore } from '@/server/security/request';
import { enforceRateLimit } from '@/server/security/rate-limit';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const config = getServerConfig();
    await enforceRateLimit(request, 'auth:login', config.AUTH_RATE_LIMIT_PER_MINUTE);

    const parsed = z
      .object({
        email: z.string().trim().toLowerCase().email(),
        password: z.string().min(1).max(128),
      })
      .safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError('Введите корректную почту и пароль.', 'INVALID_CREDENTIALS_INPUT', 400, false);

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error || !data.session || !data.user) {
      throw new HttpError('Почта или пароль не подходят.', 'INVALID_LOGIN', 401, false);
    }

    return jsonNoStore({
      user: {
        id: data.user.id,
        email: data.user.email,
        isAnonymous: data.user.is_anonymous ?? false,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
