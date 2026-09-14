import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase client variables are not set.');
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
