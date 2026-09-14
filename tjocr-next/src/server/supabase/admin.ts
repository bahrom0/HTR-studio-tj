import { createClient } from '@supabase/supabase-js';
import { getServerConfig } from '../config';

export function createAdminSupabaseClient() {
  const config = getServerConfig();

  if (!config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for privileged server operations.');
  }

  return createClient(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
