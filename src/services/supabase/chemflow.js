import { createClient } from '@supabase/supabase-js';
import {
  supabaseUrl as chemblendSupabaseUrl,
  supabaseAnonKey as chemblendSupabaseAnonKey,
} from '@chemblend/api/supabaseClient';

/**
 * Normaliza a URL do projeto Supabase.
 * Aceita tanto a URL base quanto variantes com `/rest/v1` (erro comum ao copiar).
 */
function normalizeSupabaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
}

// BANCO UNIFICADO: tabelas do módulo ChemFlow no mesmo projeto Supabase do ChemCtrl.
// Por padrão este cliente reutiliza as credenciais principais. As variáveis
// VITE_CHEMFLOW_* têm prioridade e permitem apontar para outro projeto (ex.: staging).
const chemflowSupabaseUrl = normalizeSupabaseUrl(
  import.meta.env.VITE_CHEMFLOW_SUPABASE_URL || chemblendSupabaseUrl
);
const chemflowSupabaseAnonKey = (
  import.meta.env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || chemblendSupabaseAnonKey
).trim();

/**
 * True quando as credenciais do Supabase do ChemFlow estão definidas.
 * Não lançamos erro no import: isso derrubava o lazy load de /chemflow
 * e deixava a tela em branco.
 */
export const isChemFlowConfigured = Boolean(
  chemflowSupabaseUrl && chemflowSupabaseAnonKey
);

export const CHEMFLOW_CONFIG_ERROR =
  'ChemFlow: credenciais do Supabase indisponíveis. O padrão usa o banco unificado ' +
  'do ChemCtrl; para apontar para outro projeto, defina VITE_CHEMFLOW_SUPABASE_URL ' +
  'e VITE_CHEMFLOW_SUPABASE_ANON_KEY no arquivo .env (veja .env.example).';

// Cliente Supabase do módulo ChemFlow (mesmo projeto do ChemCtrl por padrão).
// Instância separada para isolamento da camada de dados do módulo.
export const chemflowSupabase = isChemFlowConfigured
  ? createClient(chemflowSupabaseUrl, chemflowSupabaseAnonKey)
  : null;

export { chemflowSupabaseUrl, chemflowSupabaseAnonKey };
