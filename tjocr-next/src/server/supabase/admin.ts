import { createClient } from '@supabase/supabase-js';
import { AppConfig, getServerConfig } from '../config';

function legacyKeyRole(key: string): string | null {
  if (!key.startsWith('eyJ')) return null;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** A browser-safe key must never be used by the durable worker. */
export function hasSupabaseServerKey(config: AppConfig): boolean {
  const key = config.SUPABASE_SECRET_KEY || config.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;
  if (key.startsWith('sb_publishable_')) return false;
  return legacyKeyRole(key) === 'service_role';
}

export function createAdminSupabaseClient() {
  const config = getServerConfig();

  const secretKey = config.SUPABASE_SECRET_KEY || config.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey || !hasSupabaseServerKey(config)) {
    throw new Error('A Supabase sb_secret key or legacy service_role key is required for privileged server operations.');
  }

  return createClient(config.NEXT_PUBLIC_SUPABASE_URL, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
