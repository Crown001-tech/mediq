import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

const supabaseUrl = env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = env.SUPABASE_ANON_KEY || 'placeholder-anon-key';
const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
