import { chemflowSupabase } from "@/services/supabase/chemflow";
import {
  TIPO_CONVENCIONAL,
  TIPO_IND_VASILHAME,
  isItemSaidaVazio,
  isTanqueVazioItem,
  itemTemHistoricoValidacao,
  saidaItemChave,
} from "@transbordo/lib/saidaOrigem";

const TABLE = "t_saida_validacao_historico_tanque";

/** Órfãos antigos não devem marcar tanques reutilizados em ciclos futuros. */
const HISTORICO_ORFAO_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function isPendenteRecente(row) {
  const ts = Date.parse(row?.updated_at || row?.created_at || "");
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts <= HISTORICO_ORFAO_MAX_AGE_MS;
}

function isMissingTableError(error) {
  const msg = String(error?.message || error?.details || "");
  const code = String(error?.code || "");
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    /Could not find the table|relation .* does not exist|schema cache/i.test(msg)
  );
}

/** Chave física (placa + barril) para sobreviver a recriação de UUID do vasilhame. */
export function placaHistoricoKeyFromItem(item) {
  if (!item || isItemSaidaVazio(item) || isTanqueVazioItem(item)) return "";
  const tipo = String(item.tipo || "");
  if (
    tipo !== TIPO_CONVENCIONAL &&
    tipo !== "convencional" &&
    tipo !== TIPO_IND_VASILHAME
  ) {
    return "";
  }
  const placa = normalizeToken(
    item.vasilhame_placa || item.placa || item.container_number || ""
  );
  if (!placa) return "";
  const barril = normalizeToken(
    item.vasilhame_barril || item.barril || item.barril_number || ""
  );
  return `placa:${placa}|${barril || "-"}`;
}

/** Todas as chaves pelas quais um item pode herdar/publicar histórico. */
export function historicoKeysFromItem(item) {
  const keys = [];
  const chave = saidaItemChave(item);
  if (chave) keys.push(chave);
  const placaKey = placaHistoricoKeyFromItem(item);
  if (placaKey) keys.push(placaKey);
  return keys;
}

export function listItensRemovidosComHistorico(oldItens, newItens, saida) {
  const currentChaves = new Set(
    (newItens || []).map((item) => saidaItemChave(item)).filter(Boolean)
  );

  return (oldItens || []).filter((item) => {
    const chave = saidaItemChave(item);
    if (!chave || currentChaves.has(chave)) return false;
    return itemTemHistoricoValidacao(item, saida);
  });
}

function rowFromItem(item, sourceSaida) {
  const tankKey = saidaItemChave(item);
  if (!tankKey) return null;
  return {
    tank_key: tankKey,
    placa_key: placaHistoricoKeyFromItem(item) || null,
    vasilhame_id: item.vasilhame_id ? String(item.vasilhame_id) : null,
    container_id: item.container_id ? String(item.container_id) : null,
    placa:
      String(
        item.vasilhame_placa || item.placa || item.container_number || ""
      ).trim() || null,
    barril:
      String(
        item.vasilhame_barril || item.barril || item.barril_number || ""
      ).trim() || null,
    source_saida_id: sourceSaida?.id || null,
    source_saida_codigo: sourceSaida?.codigo || null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Publica histórico órfão dos tanques removidos de uma saída.
 * Sem tabela (migration 059), falha de forma silenciosa.
 */
export async function publicarHistoricoTanquesRemovidos({
  oldItens,
  newItens,
  saida,
}) {
  if (!saida?.id || !chemflowSupabase) return [];
  const removidos = listItensRemovidosComHistorico(oldItens, newItens, saida);
  const rows = removidos.map((item) => rowFromItem(item, saida)).filter(Boolean);
  if (rows.length === 0) return [];

  const { data, error } = await chemflowSupabase
    .from(TABLE)
    .upsert(rows, { onConflict: "tank_key" })
    .select();

  if (error) {
    if (isMissingTableError(error)) {
      console.warn(
        `[saidaValidacaoHistoricoTanque] Execute o script 059_t_saida_validacao_historico_tanque.sql: ${error.message}`
      );
      return [];
    }
    throw new Error(error.message || "Falha ao publicar histórico de validação");
  }
  return data || [];
}

/**
 * Índice de chaves com histórico órfão (tanque removido de uma saída
 * após ter sido validado). Não consulta itens ainda presentes em outras
 * saídas — o check só migra depois da remoção ser salva.
 */
export function buildHistoricoTanqueKeySet({ pendentes = [] } = {}) {
  const keys = new Set();

  for (const row of pendentes || []) {
    if (!isPendenteRecente(row)) continue;
    if (row?.tank_key) keys.add(String(row.tank_key));
    if (row?.placa_key) keys.add(String(row.placa_key));
  }

  return keys;
}

export function itemTemHistoricoHerdavel(item, historicoKeys) {
  if (!item || !historicoKeys || historicoKeys.size === 0) return false;
  return historicoKeysFromItem(item).some((key) => historicoKeys.has(key));
}

export function aplicarHistoricoHerdado(item, historicoKeys) {
  if (!item || item.validado_historico === true) return item;
  if (!itemTemHistoricoHerdavel(item, historicoKeys)) return item;
  return { ...item, validado_historico: true };
}

export async function listHistoricoTanquePendentes() {
  if (!chemflowSupabase) return [];
  const { data, error } = await chemflowSupabase.from(TABLE).select("*");
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(error.message || "Falha ao listar histórico de validação");
  }
  return data || [];
}

/**
 * Remove órfãos já herdados pela nova composição.
 */
export async function consumirHistoricoTanquesHerdados(itens) {
  if (!chemflowSupabase) return;
  const tankKeys = new Set();
  const placaKeys = new Set();
  for (const item of itens || []) {
    if (item?.validado_historico !== true) continue;
    const tankKey = saidaItemChave(item);
    if (tankKey) tankKeys.add(tankKey);
    const placaKey = placaHistoricoKeyFromItem(item);
    if (placaKey) placaKeys.add(placaKey);
  }
  if (tankKeys.size === 0 && placaKeys.size === 0) return;

  if (tankKeys.size > 0) {
    const { error } = await chemflowSupabase
      .from(TABLE)
      .delete()
      .in("tank_key", [...tankKeys]);
    if (error && !isMissingTableError(error)) {
      throw new Error(error.message || "Falha ao consumir histórico (tank_key)");
    }
  }

  if (placaKeys.size > 0) {
    const { error } = await chemflowSupabase
      .from(TABLE)
      .delete()
      .in("placa_key", [...placaKeys]);
    if (error && !isMissingTableError(error)) {
      throw new Error(error.message || "Falha ao consumir histórico (placa_key)");
    }
  }
}
