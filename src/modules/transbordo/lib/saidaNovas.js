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
  getModulosRelevantesSaida,
  isSaidaModuloPainel,
  isSaidaValidadaNoModulo,
  saidaHasIndustrializacaoItems,
  saidaHasTransbordoItems,
  saidaTemItemPendenteNoModulo,
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
  // Tanque incluído depois da validação volta a notificar o módulo.
  if (saidaTemItemPendenteNoModulo(saida, m)) return true;
  if (isSaidaValidadaNoModulo(saida, m)) return false;
  return true;
}

/** Apaga as leituras do módulo para a flag da sidebar voltar a aparecer. */
export async function clearSaidaLeituras(saidaId, modulo) {
  if (emptyClient() || !saidaId) return;
  let query = chemflowSupabase.from('t_saida_leituras').delete().eq('saida_id', saidaId);
  if (modulo) query = query.eq('modulo', normalizeSaidaModulo(modulo));
  const { error } = await query;
  if (error) throw error;
}

/**
 * Alerta de novo agendamento na tela de Saída.
 * Só reabre o badge "Novo" nos módulos ainda pendentes de validação.
 * Saída já validada (sem itens pendentes) não dispara alerta.
 */
export async function notifyAgendamentoSePendenteValidacao(saida) {
  if (!saida?.id) return;
  let row = saida;
  if (
    !isSaidaModuloPainel(row) ||
    !Array.isArray(row.itens) ||
    row.validacao_modulos == null
  ) {
    if (emptyClient()) return;
    const { data, error } = await chemflowSupabase
      .from('t_saidas')
      .select('id, modulo_origem, status, enviado_ao_fiscal, itens, validacao_modulos')
      .eq('id', saida.id)
      .maybeSingle();
    if (error || !data) return;
    row = data;
  }
  if (!isSaidaModuloPainel(row)) return;
  const mods = getModulosRelevantesSaida(row);
  if (mods.length === 0) return;
  for (const modulo of mods) {
    const validada =
      isSaidaValidadaNoModulo(row, modulo) &&
      !saidaTemItemPendenteNoModulo(row, modulo);
    if (validada) continue;
    try {
      await clearSaidaLeituras(row.id, modulo);
    } catch (err) {
      console.error(
        '[saidaNovas] Falha ao reabrir alerta após agendamento:',
        err
      );
    }
  }
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

/** Canal status tracker para gatear polling de badges. */
const channelHealth = new Map(); // channelName → 'connected' | 'error' | ...

export function getChemflowChannelStatus(channelName) {
  return channelHealth.get(channelName) || 'unknown';
}

/**
 * Subscreve postgres_changes de uma tabela ChemFlow.
 * @returns {() => void} unsubscribe
 */
export function subscribeChemflowTable(tableName, onPayload, { channelKey = 'tb' } = {}) {
  if (emptyClient()) return () => {};

  const name = `chemflow-saida-novas-${channelKey}-${tableName}`;
  const channel = chemflowSupabase
    .channel(name)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: tableName },
      (payload) => {
        onPayload?.(payload);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') channelHealth.set(name, 'connected');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') channelHealth.set(name, 'error');
      else if (status === 'CLOSED') channelHealth.set(name, 'disconnected');
      else channelHealth.set(name, String(status || 'unknown').toLowerCase());
    });

  return () => {
    channelHealth.delete(name);
    chemflowSupabase.removeChannel(channel);
  };
}

export { POLL_INTERVAL_MS };
