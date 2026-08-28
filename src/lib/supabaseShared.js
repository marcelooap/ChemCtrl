/**
 * Cliente Supabase compartilhado (uma única instância GoTrue/Realtime).
 * Evita o warning "Multiple GoTrueClient instances" e 401 intermitentes.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.VITE_CHEMBLEND_SUPABASE_URL ||
  'https://cpzibnwytukcgxeamfhp.supabase.co'
).replace(/\/$/, '');

const supabaseAnonKey = (
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_CHEMBLEND_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwemlibnd5dHVrY2d4ZWFtZmhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcyMjksImV4cCI6MjA5NzMzMzIyOX0.28Y66Ba_u1GyQNnDpsdPXLiGHvcn_BkjGOyHsBPSqR0'
).trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/** Cliente único da plataforma — persistSession false (auth própria via x-session-id). */
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'chemctrl-shared-auth',
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    })
  : null;

export { supabaseUrl, supabaseAnonKey };
