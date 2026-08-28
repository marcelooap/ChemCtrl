import {
  supabase as sharedSupabase,
  supabaseUrl as sharedUrl,
  supabaseAnonKey as sharedKey,
} from '@/lib/supabaseShared';
import { createClient } from '@supabase/supabase-js';

/**
 * Normaliza a URL do projeto Supabase.
 * Aceita tanto a URL base quanto variantes com `/rest/v1` (erro comum ao copiar).
 */
function normalizeSupabaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
}

// BANCO UNIFICADO: por padrão reutiliza o cliente compartilhado (evita 2× GoTrue).
// VITE_CHEMFLOW_* permite apontar para outro projeto (staging).
const chemflowSupabaseUrl = normalizeSupabaseUrl(
  import.meta.env.VITE_CHEMFLOW_SUPABASE_URL || sharedUrl
);
const chemflowSupabaseAnonKey = (
  import.meta.env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || sharedKey
).trim();

const sameProject =
  normalizeSupabaseUrl(chemflowSupabaseUrl) === normalizeSupabaseUrl(sharedUrl) &&
  chemflowSupabaseAnonKey === sharedKey;

export const isChemFlowConfigured = Boolean(
  chemflowSupabaseUrl && chemflowSupabaseAnonKey
);

export const CHEMFLOW_CONFIG_ERROR =
  'ChemFlow: credenciais do Supabase indisponíveis. O padrão usa o banco unificado ' +
  'do ChemCtrl; para apontar para outro projeto, defina VITE_CHEMFLOW_SUPABASE_URL ' +
  'e VITE_CHEMFLOW_SUPABASE_ANON_KEY no arquivo .env (veja .env.example).';

/**
 * Se for o mesmo projeto do ChemCtrl, reutiliza a instância compartilhada.
 * Só cria um segundo cliente quando VITE_CHEMFLOW_* aponta para outro projeto.
 */
export const chemflowSupabase = !isChemFlowConfigured
  ? null
  : sameProject
    ? sharedSupabase
    : createClient(chemflowSupabaseUrl, chemflowSupabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: 'chemflow-auth',
        },
        realtime: {
          params: { eventsPerSecond: 0 },
        },
      });

export { chemflowSupabaseUrl, chemflowSupabaseAnonKey };
