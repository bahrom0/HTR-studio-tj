import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { getAuthenticatedUser } from '@/server/auth/session';
import { getServerConfig } from '@/server/config';
import { assertSameOrigin, errorResponse, HttpError, jsonNoStore } from '@/server/security/request';
import { enforceRateLimit } from '@/server/security/rate-limit';

function credentialsSchema(minPasswordLength: number) {
  return z
    .object({
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(minPasswordLength).max(128),
      passwordConfirmation: z.string().optional(),
    })
    .superRefine((value, context) => {
      if (value.passwordConfirmation !== undefined && value.password !== value.passwordConfirmation) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['passwordConfirmation'], message: 'password_mismatch' });
      }
    });
}

function authError(error: { code?: string } | null | undefined) {
  if (error?.code === 'user_already_exists' || error?.code === 'email_exists') {
    return new HttpError('Аккаунт с этой почтой уже существует.', 'ACCOUNT_EXISTS', 409, false);
  }
  if (error?.code === 'weak_password') {
    return new HttpError('Пароль слишком простой.', 'WEAK_PASSWORD', 400, false);
  }
  return new HttpError('Не удалось создать аккаунт.', 'REGISTRATION_FAILED', 400, false);
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const config = getServerConfig();
    await enforceRateLimit(request, 'auth:register', config.AUTH_RATE_LIMIT_PER_MINUTE);

    const parsed = credentialsSchema(config.AUTH_PASSWORD_MIN_LENGTH).safeParse(
      await request.json().catch(() => ({})),
    );
    if (!parsed.success) {
      throw new HttpError('Введите корректную почту и пароль.', 'INVALID_CREDENTIALS_INPUT', 400, false);
    }

    const supabase = await createServerSupabaseClient();
    const currentUser = await getAuthenticatedUser(supabase);
    if (currentUser && !currentUser.isAnonymous) {
      throw new HttpError('Вы уже вошли в аккаунт.', 'ALREADY_AUTHENTICATED', 409, false);
    }

    const result = currentUser?.isAnonymous
      ? await supabase.auth.updateUser({ email: parsed.data.email, password: parsed.data.password })
      : await supabase.auth.signUp({ email: parsed.data.email, password: parsed.data.password });

    if (result.error || !result.data.user) throw authError(result.error);

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session || session.user.is_anonymous) {
      throw new HttpError(
        'Регистрация создана, но подтверждение почты включено в Supabase. Отключите его для режима без кода.',
        'EMAIL_CONFIRMATION_REQUIRED',
        409,
        false,
      );
    }

    return jsonNoStore({
      user: {
        id: session.user.id,
        email: session.user.email,
        isAnonymous: false,
      },
      convertedAnonymousSession: Boolean(currentUser?.isAnonymous),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
