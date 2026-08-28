/**
 * Reexporta o cliente compartilhado. Mantém o path legado
 * `@industrializacao/lib/supabaseClient` sem criar segunda instância GoTrue.
 */
export {
  supabase,
  supabaseUrl,
  supabaseAnonKey,
  isSupabaseConfigured,
} from '@/lib/supabaseShared';
