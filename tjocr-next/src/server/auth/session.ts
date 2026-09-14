import { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '@/server/security/request';

export interface AuthenticatedUser {
  id: string;
  isAnonymous: boolean;
  email?: string;
}

export async function getAuthenticatedUser(supabase: SupabaseClient): Promise<AuthenticatedUser | null> {
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return {
    id: user.id,
    isAnonymous: user.is_anonymous ?? false,
    email: user.email,
  };
}

export async function requireUser(supabase: SupabaseClient): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser(supabase);
  if (!user) {
    throw new HttpError('Требуется авторизация.', 'UNAUTHORIZED', 401, false);
  }
  return user;
}
