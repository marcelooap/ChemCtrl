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

// BANCO UNIFICADO: desde a migração (migration_chemflow_unification.sql), as
// tabelas do ChemFlow vivem no mesmo projeto Supabase do ChemBlend (Projeto A).
// Por padrão este cliente reutiliza as credenciais do ChemBlend como fonte
// única de verdade. As variáveis VITE_CHEMFLOW_* seguem tendo prioridade e
// permitem apontar para outro projeto (ex.: staging).
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
  'do ChemBlend; para apontar para outro projeto, defina VITE_CHEMFLOW_SUPABASE_URL ' +
  'e VITE_CHEMFLOW_SUPABASE_ANON_KEY no arquivo .env (veja .env.example).';

// Cliente Supabase do ChemFlow. Desde a unificação dos bancos aponta para o
// mesmo projeto do ChemBlend (Projeto A), mas permanece uma instância separada
// para preservar o isolamento da camada de dados do módulo. A autenticação de
// usuário continua centralizada na plataforma; este cliente usa a anon key
// protegida por RLS (políticas chemflow_anon_all_* nas tabelas do domínio).
export const chemflowSupabase = isChemFlowConfigured
  ? createClient(chemflowSupabaseUrl, chemflowSupabaseAnonKey)
  : null;

export { chemflowSupabaseUrl, chemflowSupabaseAnonKey };
