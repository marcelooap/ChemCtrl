import { createClient } from '@supabase/supabase-js';

/**
 * Normaliza a URL do projeto Supabase.
 * Aceita tanto a URL base quanto variantes com `/rest/v1` (erro comum ao copiar).
 */
function normalizeSupabaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
}

const chemflowSupabaseUrl = normalizeSupabaseUrl(
  import.meta.env.VITE_CHEMFLOW_SUPABASE_URL
);
const chemflowSupabaseAnonKey = (import.meta.env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || '').trim();

/**
 * True quando as credenciais do Supabase Projeto B estão definidas.
 * Não lançamos erro no import: isso derrubava o lazy load de /chemflow
 * e deixava a tela em branco.
 */
export const isChemFlowConfigured = Boolean(
  chemflowSupabaseUrl && chemflowSupabaseAnonKey
);

export const CHEMFLOW_CONFIG_ERROR =
  'ChemFlow: configure VITE_CHEMFLOW_SUPABASE_URL e VITE_CHEMFLOW_SUPABASE_ANON_KEY ' +
  'no arquivo .env (veja .env.example) com as credenciais do Supabase Projeto B.';

// Cliente Supabase exclusivo do ChemFlow (Projeto B).
// Isolado do cliente do ChemBlend (Projeto A) — nenhuma tabela é compartilhada
// entre módulos. A autenticação de usuário continua centralizada na plataforma
// (Projeto A); este cliente usa a anon key do Projeto B protegida por RLS.
export const chemflowSupabase = isChemFlowConfigured
  ? createClient(chemflowSupabaseUrl, chemflowSupabaseAnonKey)
  : null;

export { chemflowSupabaseUrl, chemflowSupabaseAnonKey };
