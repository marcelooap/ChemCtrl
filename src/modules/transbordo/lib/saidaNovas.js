/**
 * Solicitações de saída "novas" no Transbordo e na Industrialização.
 *
 * Controle: usuário + módulo + saída.
 * Visualizar no Transbordo não marca como lida na Industrialização.
 *
 * Candidata a "Novo" quando:
 * - criada no Painel Comercial;
 * - possui itens daquele módulo;
 * - aquele módulo ainda não validou;
 * - o usuário ainda não visualizou naquele módulo.
 */
import { chemflowSupabase, isChemFlowConfigured } from '@/services/supabase/chemflow';
import {
  ORIGEM_INDUSTRIALIZACAO,
  ORIGEM_TRANSBORDO,
  isSaidaModuloPainel,
  isSaidaValidadaNoModulo,
  saidaHasIndustrializacaoItems,
  saidaHasTransbordoItems,
} from '@transbordo/lib/saidaOrigem';

export const SAIDA_PATH_TRANSBORDO = '/chemflow/saida';
export const SAIDA_PATH_INDUSTRIALIZACAO = '/saida';
/** @deprecated use SAIDA_PATH_TRANSBORDO */
export const SAIDA_PATH = SAIDA_PATH_TRANSBORDO;
const POLL_INTERVAL_MS = 30000;

export function normalizeSaidaModulo(modulo) {
  return modulo === ORIGEM_INDUSTRIALIZACAO
    ? ORIGEM_INDUSTRIALIZACAO
    : ORIGEM_TRANSBORDO;
}

export function isSaidaValidada(saida) {
  return Boolean(saida?.enviado_ao_fiscal || saida?.status === 'enviado_fiscal');
}

function saidaHasItensDoModulo(saida, modulo) {
  const m = normalizeSaidaModulo(modulo);
  if (m === ORIGEM_INDUSTRIALIZACAO) return saidaHasIndustrializacaoItems(saida);
  return saidaHasTransbordoItems(saida);
}

/** Candidata a badge Novo / contador da Sidebar naquele módulo. */
export function isSaidaNovaCandidata(saida, { onlyIndustrializacao = false, modulo } = {}) {
  const m = normalizeSaidaModulo(
    modulo || (onlyIndustrializacao ? ORIGEM_INDUSTRIALIZACAO : ORIGEM_TRANSBORDO)
  );
  if (!isSaidaModuloPainel(saida)) return false;
  if (!saidaHasItensDoModulo(saida, m)) return false;
  if (isSaidaValidadaNoModulo(saida, m)) return false;
  return true;
}

function emptyClient() {
  return !isChemFlowConfigured || !chemflowSupabase;
}

export async function listSaidasPainelPendentes(options = {}) {
  if (emptyClient()) return [];
  const { data, error } = await chemflowSupabase
    .from('t_saidas')
    .select('id, modulo_origem, status, enviado_ao_fiscal, itens, validacao_modulos')
    .eq('modulo_origem', 'painel');
  if (error) throw error;
  return (data || []).filter((s) => isSaidaNovaCandidata(s, options));
}

export async function listSaidaIdsLidas(usuarioId, modulo) {
  if (emptyClient() || !usuarioId) return [];
  const m = normalizeSaidaModulo(modulo);
  const { data, error } = await chemflowSupabase
    .from('t_saida_leituras')
    .select('saida_id')
    .eq('usuario_id', String(usuarioId))
    .eq('modulo', m);
  if (error) throw error;
  return (data || []).map((row) => row.saida_id).filter(Boolean);
}

export async function markSaidaLida(saidaId, usuarioId, modulo) {
  if (emptyClient() || !saidaId || !usuarioId) return null;
  const m = normalizeSaidaModulo(modulo);
  const { error } = await chemflowSupabase
    .from('t_saida_leituras')
    .upsert(
      {
        saida_id: saidaId,
        usuario_id: String(usuarioId),
        modulo: m,
      },
      { onConflict: 'saida_id,usuario_id,modulo', ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function loadUnreadSaidaIds(usuarioId, options = {}) {
  if (!usuarioId) return [];
  const modulo = normalizeSaidaModulo(
    options.modulo ||
      (options.onlyIndustrializacao ? ORIGEM_INDUSTRIALIZACAO : ORIGEM_TRANSBORDO)
  );
  const [pendentes, lidas] = await Promise.all([
    listSaidasPainelPendentes({ ...options, modulo }),
    listSaidaIdsLidas(usuarioId, modulo),
  ]);
  const lidasSet = new Set(lidas);
  return pendentes.map((s) => s.id).filter((id) => id && !lidasSet.has(id));
}

/**
 * Subscreve postgres_changes de uma tabela ChemFlow.
 * @returns {() => void} unsubscribe
 */
export function subscribeChemflowTable(tableName, onPayload, { channelKey = 'tb' } = {}) {
  if (emptyClient()) return () => {};

  const channel = chemflowSupabase
    .channel(`chemflow-saida-novas-${channelKey}-${tableName}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: tableName },
      (payload) => {
        onPayload?.(payload);
      }
    )
    .subscribe();

  return () => {
    chemflowSupabase.removeChannel(channel);
  };
}

export { POLL_INTERVAL_MS };
