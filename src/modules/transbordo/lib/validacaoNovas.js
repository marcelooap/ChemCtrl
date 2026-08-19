/**
 * Validações "novas" no Transbordo e na Industrialização.
 *
 * Origem: Painel → Recebimento e Painel → Ordem de Transbordo.
 * Controle: usuário + módulo + validação (visualizar num módulo
 * não marca como lida no outro).
 */
import { chemflowSupabase, isChemFlowConfigured } from "@/services/supabase/chemflow";
import { subscribeChemflowTable, POLL_INTERVAL_MS } from "@transbordo/lib/saidaNovas";

export const VALIDACAO_PATH_TRANSBORDO = "/chemflow/validacao";
export const VALIDACAO_PATH_INDUSTRIALIZACAO = "/validacao";

export const MODULO_TRANSBORDO = "transbordo";
export const MODULO_INDUSTRIALIZACAO = "industrializacao";

export function normalizeValidacaoModulo(modulo) {
  return modulo === MODULO_INDUSTRIALIZACAO
    ? MODULO_INDUSTRIALIZACAO
    : MODULO_TRANSBORDO;
}

export function isValidacaoNovaCandidata(row) {
  if (!row?.id) return false;
  return row.status !== "validado";
}

function emptyClient() {
  return !isChemFlowConfigured || !chemflowSupabase;
}

function sourceTable(modulo) {
  return normalizeValidacaoModulo(modulo) === MODULO_INDUSTRIALIZACAO
    ? "ind_validacoes"
    : "t_transbordo_validacoes";
}

export async function listValidacoesPendentes(modulo) {
  if (emptyClient()) return [];
  const table = sourceTable(modulo);
  const { data, error } = await chemflowSupabase
    .from(table)
    .select("id, status")
    .neq("status", "validado");
  if (error) throw error;
  return (data || []).filter(isValidacaoNovaCandidata);
}

export async function listValidacaoIdsLidas(usuarioId, modulo) {
  if (emptyClient() || !usuarioId) return [];
  const m = normalizeValidacaoModulo(modulo);
  const { data, error } = await chemflowSupabase
    .from("t_validacao_leituras")
    .select("validacao_id")
    .eq("usuario_id", String(usuarioId))
    .eq("modulo", m);
  if (error) throw error;
  return (data || []).map((row) => row.validacao_id).filter(Boolean);
}

export async function markValidacaoLida(validacaoId, usuarioId, modulo) {
  if (emptyClient() || !validacaoId || !usuarioId) return null;
  const m = normalizeValidacaoModulo(modulo);
  const { error } = await chemflowSupabase
    .from("t_validacao_leituras")
    .upsert(
      {
        validacao_id: String(validacaoId),
        usuario_id: String(usuarioId),
        modulo: m,
      },
      { onConflict: "validacao_id,usuario_id,modulo", ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function loadUnreadValidacaoIds(usuarioId, modulo) {
  if (!usuarioId) return [];
  const m = normalizeValidacaoModulo(modulo);
  const [pendentes, lidas] = await Promise.all([
    listValidacoesPendentes(m),
    listValidacaoIdsLidas(usuarioId, m),
  ]);
  const lidasSet = new Set(lidas.map(String));
  return pendentes
    .map((v) => v.id)
    .filter((id) => id && !lidasSet.has(String(id)));
}

export { subscribeChemflowTable, POLL_INTERVAL_MS };
