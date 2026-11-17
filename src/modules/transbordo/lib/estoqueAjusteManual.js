/**
 * Ajuste manual de saldo (Estoque / Armazenagem) — exclusivo Administrador.
 *
 * - Ledger: t_estoque_ajustes_manuais
 * - Persistência atômica: RPC t_ajustar_saldo_estoque
 * - Não cria OP / entrada / saída / produção
 */

import { callRPC } from "@industrializacao/api/rpcClient";
import {
  roundMass,
  roundVolume,
  roundQuantidade,
  parseDensidade,
} from "@transbordo/lib/format";
import {
  isVasilhameLinkedToEstoque,
  listTankaIdsLinkedToEstoque,
  getEstoqueQuantidade,
  getEstoqueUnidade,
  getEstoqueUnidadeEntrada,
  isUnidadeVolumeEntrada,
  resolveQuantidadeVasilhameParaBaixa,
  isVasilhameExpedido,
} from "@transbordo/lib/estoqueSaldo";
import { isVasilhameNoPatio } from "@transbordo/lib/vasilhameComposicao";
import { isVasilhameLegadoEmbalado } from "@transbordo/lib/tiposEmbalagem";
import { matchesTanka, computeTankaSaldo } from "@transbordo/lib/tankaVolume";
import { entities } from "@transbordo/services/entities";
import { chemflowSupabase, isChemFlowConfigured } from "@/services/supabase/chemflow";

export const AJUSTE_MANUAL_CODIGO = "AJUSTE-MANUAL";

export const TIPO_LOCAL = {
  EMBALADO: "embalado",
  TANQUE: "tanque",
  TANKA: "tanka",
};

export const TIPO_AJUSTE = {
  AUMENTAR: "aumentar",
  DIMINUIR: "diminuir",
};

function idsEqual(a, b) {
  if (a == null || b == null || a === "" || b === "") return false;
  return String(a) === String(b);
}

function normCodigo(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** Delta na UOM do estoque → litros (tanque/tanka). */
export function quantidadeParaLitros(quantidade, estoqueItem) {
  const q = Number(quantidade) || 0;
  if (!(q > 0)) return 0;
  if (isUnidadeVolumeEntrada(getEstoqueUnidadeEntrada(estoqueItem))) {
    return roundVolume(q);
  }
  const dens = parseDensidade(estoqueItem?.densidade);
  if (dens > 0) return roundVolume(q / dens);
  return roundVolume(q);
}

/** Litros → UOM do estoque. */
export function litrosParaQuantidade(litros, estoqueItem) {
  const v = roundVolume(litros);
  if (isUnidadeVolumeEntrada(getEstoqueUnidadeEntrada(estoqueItem))) {
    return v;
  }
  const dens = parseDensidade(estoqueItem?.densidade);
  if (dens > 0) return roundMass(v * dens);
  return roundQuantidade(v);
}

/**
 * Tipos de local disponíveis no modal.
 * Inclui locais com saldo > 0; sempre oferece Embalado (permite correção inventário).
 * Tanque/Tanka só entram se já houver saldo naquele local (há contentor vinculado).
 */
export function listTiposLocaisDisponiveis(locaisSaldo) {
  const locais = locaisSaldo || {};
  const out = [TIPO_LOCAL.EMBALADO];
  if ((Number(locais.vasilhames) || 0) > 0.0005) out.push(TIPO_LOCAL.TANQUE);
  if ((Number(locais.tankas) || 0) > 0.0005) out.push(TIPO_LOCAL.TANKA);
  return out;
}

/**
 * Tanques No Pátio vinculados ao estoque (exclui Tankagem e unitários embalados).
 */
export function listTanquesParaAjuste(
  estoqueItem,
  { vasilhames = [], transbordos = [] } = {}
) {
  if (!estoqueItem?.id) return [];
  const rows = [];
  for (const v of vasilhames || []) {
    if (!v?.id) continue;
    if (isVasilhameExpedido(v)) continue;
    if (!isVasilhameNoPatio(v)) continue;
    if ((v.tipo || "") === "Tankagem") continue;
    if (isVasilhameLegadoEmbalado(v.tipo)) continue;
    if (!isVasilhameLinkedToEstoque(v, estoqueItem, { transbordos, vasilhames })) {
      continue;
    }
    const volume = roundVolume(Number(v.volume) || 0);
    if (volume <= 0) continue;
    let qtdEstoque = litrosParaQuantidade(volume, estoqueItem);
    try {
      const resolved = resolveQuantidadeVasilhameParaBaixa(
        estoqueItem,
        v,
        transbordos
      );
      if (Number(resolved) > 0) qtdEstoque = roundQuantidade(resolved);
    } catch {
      // mantém conversão por densidade
    }

    rows.push({
      id: v.id,
      placa: v.placa || "",
      barril: v.barril || "",
      codigo: v.codigo || "",
      tipo: v.tipo || "Vasilhame",
      capacidade: Number(v.capacidade) || 0,
      volume,
      saldo_atual: qtdEstoque,
      densidade: v.densidade || estoqueItem.densidade || "",
      lote: v.lote || estoqueItem.lote || "",
      raw: v,
    });
  }
  rows.sort((a, b) => String(a.placa).localeCompare(String(b.placa), "pt-BR"));
  return rows;
}

/**
 * Tankas com saldo vinculadas ao estoque (via OP + espelho No Pátio).
 */
export function listTankasParaAjuste(
  estoqueItem,
  { vasilhames = [], transbordos = [], ajustes = [] } = {}
) {
  if (!estoqueItem?.id) return [];
  const linked = listTankaIdsLinkedToEstoque(estoqueItem, {
    transbordos,
    vasilhames,
  });
  const byKey = new Map();

  for (const v of vasilhames || []) {
    if (!v?.id) continue;
    if ((v.tipo || "") !== "Tankagem") continue;
    if (isVasilhameExpedido(v)) continue;
    if (!isVasilhameNoPatio(v)) continue;
    const codigo = v.placa || v.tanka || "";
    const codigoNorm = normCodigo(codigo);
    const idOk = v.tanka_id && linked.ids.has(v.tanka_id);
    const codigoOk = codigoNorm && linked.codigos.has(codigoNorm);
    // Fallback: composição com stamp deste estoque
    const stampOk = (Array.isArray(v.composicao) ? v.composicao : []).some(
      (c) =>
        idsEqual(c.estoque_id, estoqueItem.id) ||
        idsEqual(c.entrada_id, estoqueItem.id)
    );
    if (!idOk && !codigoOk && !stampOk) continue;

    const volumeOp = computeTankaSaldo({
      isotanqueId: v.tanka_id || null,
      tankaCodigo: codigo,
      transbordos,
    });
    const volumeAjuste = sumAjustesTankaLitros(ajustes, {
      tankaId: v.tanka_id,
      tankaCodigo: codigo,
      vasilhameId: v.id,
    });
    const volume = roundVolume(
      Math.max(Number(v.volume) || 0, volumeOp + volumeAjuste)
    );
    if (volume <= 0 && !stampOk) continue;

    const key = codigoNorm || String(v.id);
    const prev = byKey.get(key);
    if (prev && (Number(prev.volume) || 0) >= volume) continue;

    byKey.set(key, {
      id: v.id,
      tanka_id: v.tanka_id || null,
      placa: codigo,
      tanka_codigo: codigo,
      barril: v.barril || "",
      codigo: v.codigo || "",
      tipo: "Tankagem",
      capacidade: Number(v.capacidade) || 0,
      volume,
      saldo_atual: litrosParaQuantidade(volume, estoqueItem),
      densidade: v.densidade || estoqueItem.densidade || "",
      lote: v.lote || estoqueItem.lote || "",
      raw: v,
    });
  }

  const rows = [...byKey.values()];
  rows.sort((a, b) =>
    String(a.tanka_codigo || a.placa).localeCompare(
      String(b.tanka_codigo || b.placa),
      "pt-BR"
    )
  );
  return rows;
}

/**
 * Soma quantidade_signed do ledger para um estoque.
 * @param {Array} ajustes
 * @param {string} estoqueId
 * @param {string|null} tipoLocal filtrar por local (embalado|tanque|tanka) ou todos
 */
export function sumAjustesQuantidadeSigned(
  ajustes = [],
  estoqueId,
  tipoLocal = null
) {
  if (!estoqueId) return 0;
  const id = String(estoqueId);
  let sum = 0;
  for (const a of ajustes || []) {
    if (String(a?.estoque_id || "") !== id) continue;
    if (tipoLocal && a?.tipo_local !== tipoLocal) continue;
    sum += Number(a.quantidade_signed) || 0;
  }
  return roundQuantidade(sum);
}

/** Soma signed volume_l dos ajustes de uma tanka. */
export function sumAjustesTankaLitros(
  ajustes = [],
  { tankaId = null, tankaCodigo = "", vasilhameId = null } = {}
) {
  const codigo = normCodigo(tankaCodigo);
  let sum = 0;
  for (const a of ajustes || []) {
    if (a?.tipo_local !== TIPO_LOCAL.TANKA) continue;
    const matchId = tankaId && idsEqual(a.tanka_id, tankaId);
    const matchVas = vasilhameId && idsEqual(a.vasilhame_id, vasilhameId);
    const matchCodigo =
      codigo &&
      (normCodigo(a.tanka_codigo) === codigo ||
        normCodigo(a.vasilhame_placa) === codigo);
    if (!matchId && !matchVas && !matchCodigo) continue;
    const vol = Number(a.volume_l);
    if (Number.isFinite(vol)) {
      sum += vol;
    } else {
      const signed = Number(a.quantidade_signed) || 0;
      // Sem volume_l: assume já em L se unidade volume; senão ignora no ledger L
      sum += signed;
    }
  }
  return roundVolume(sum);
}

/**
 * Valida payload do modal antes de chamar a RPC.
 * @returns {{ ok: boolean, message?: string, volumeL?: number, signed?: number }}
 */
export function validateAjusteManualPayload({
  tipoLocal,
  tipoAjuste,
  quantidade,
  justificativa,
  saldoLocalAtual,
  vasilhameId,
  selectedContainer,
}) {
  const qtd = Number(quantidade);
  if (!Number.isFinite(qtd) || qtd <= 0) {
    return { ok: false, message: "Informe uma quantidade maior que zero." };
  }
  if (!justificativa || !String(justificativa).trim()) {
    return { ok: false, message: "A justificativa é obrigatória." };
  }
  if (
    tipoLocal !== TIPO_LOCAL.EMBALADO &&
    !vasilhameId &&
    !selectedContainer?.id
  ) {
    return {
      ok: false,
      message:
        tipoLocal === TIPO_LOCAL.TANKA
          ? "Selecione a Tanka que receberá o ajuste."
          : "Selecione o tanque que receberá o ajuste.",
    };
  }

  const saldo = Number(saldoLocalAtual) || 0;
  const signed = tipoAjuste === TIPO_AJUSTE.AUMENTAR ? qtd : -qtd;
  const novo = roundQuantidade(saldo + signed);
  if (novo < -0.0005) {
    return {
      ok: false,
      message: "O ajuste geraria saldo negativo.",
    };
  }
  if (tipoAjuste === TIPO_AJUSTE.DIMINUIR && qtd > saldo + 0.0005) {
    return {
      ok: false,
      message: "A redução é superior ao saldo disponível.",
    };
  }

  return { ok: true, signed, novoSaldo: Math.max(0, novo) };
}

/**
 * Persiste o ajuste via RPC admin-only.
 */
export async function persistAjusteManualSaldo({
  estoqueItem,
  tipoLocal,
  tipoAjuste,
  quantidade,
  justificativa,
  vasilhameId = null,
  tankaId = null,
  tankaCodigo = null,
  saldoLocalAtual = null,
}) {
  if (!estoqueItem?.id) {
    throw new Error("Registro de estoque inválido.");
  }
  const qtd = roundQuantidade(Number(quantidade) || 0);
  const validation = validateAjusteManualPayload({
    tipoLocal,
    tipoAjuste,
    quantidade: qtd,
    justificativa,
    saldoLocalAtual:
      saldoLocalAtual != null
        ? saldoLocalAtual
        : Number(estoqueItem.saldo_atual) || 0,
    vasilhameId,
  });
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  let volumeL = null;
  if (tipoLocal === TIPO_LOCAL.TANQUE || tipoLocal === TIPO_LOCAL.TANKA) {
    volumeL = quantidadeParaLitros(qtd, estoqueItem);
  }

  try {
    const result = await callRPC("t_ajustar_saldo_estoque", {
      p_estoque_id: String(estoqueItem.id),
      p_tipo_local: tipoLocal,
      p_tipo_ajuste: tipoAjuste,
      p_quantidade: qtd,
      p_justificativa: String(justificativa).trim(),
      p_vasilhame_id: vasilhameId || null,
      p_tanka_id: tankaId || null,
      p_tanka_codigo: tankaCodigo || null,
      p_volume_l: volumeL,
      p_saldo_local_atual:
        saldoLocalAtual != null ? Number(saldoLocalAtual) : null,
    });
    return result;
  } catch (err) {
    const raw = err?.message || err?.body || "";
    let message = typeof raw === "string" ? raw : "Falha ao gravar o ajuste.";
    try {
      const parsed = JSON.parse(message);
      if (parsed?.message) message = parsed.message;
    } catch {
      // texto puro do PostgREST
    }
    // Remove prefixos técnicos comuns
    message = message
      .replace(/^.*ERROR:\s*/i, "")
      .replace(/\s+CONTEXT:[\s\S]*$/i, "")
      .trim();
    throw new Error(message || "Falha ao gravar o ajuste.");
  }
}

/**
 * Lista ajustes do ledger (filtros opcionais).
 */
export async function listAjustesManuais({
  estoqueId = null,
  vasilhameId = null,
  tankaId = null,
  tankaCodigo = null,
  limit = 200,
} = {}) {
  if (!isChemFlowConfigured || !chemflowSupabase) return [];

  let q = chemflowSupabase
    .from("t_estoque_ajustes_manuais")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (estoqueId) q = q.eq("estoque_id", String(estoqueId));
  if (vasilhameId) q = q.eq("vasilhame_id", String(vasilhameId));
  if (tankaId) q = q.eq("tanka_id", String(tankaId));
  if (tankaCodigo) q = q.eq("tanka_codigo", String(tankaCodigo));

  const { data, error } = await q;
  if (error) {
    // Tabela ainda não aplicada no ambiente: falha silenciosa para não quebrar telas.
    console.warn("[ajuste-manual] Falha ao listar ajustes:", error.message || error);
    return [];
  }
  return data || [];
}

/**
 * Carrega todos os ajustes (workspace / tanka saldo). Cache leve por chamada.
 */
export async function listAllAjustesManuais(limit = 2000) {
  if (!isChemFlowConfigured || !chemflowSupabase) return [];
  const { data, error } = await chemflowSupabase
    .from("t_estoque_ajustes_manuais")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[ajuste-manual] Falha ao listar ajustes:", error.message || error);
    return [];
  }
  return data || [];
}

export function labelTipoLocal(tipo) {
  if (tipo === TIPO_LOCAL.EMBALADO) return "Embalado";
  if (tipo === TIPO_LOCAL.TANQUE) return "Tanque";
  if (tipo === TIPO_LOCAL.TANKA) return "Tanka";
  return tipo || "—";
}

export function labelTipoAjuste(tipo) {
  if (tipo === TIPO_AJUSTE.AUMENTAR) return "Aumentar saldo (+)";
  if (tipo === TIPO_AJUSTE.DIMINUIR) return "Diminuir saldo (-)";
  return tipo || "—";
}

export function formatAjusteDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("pt-BR");
}

/** Unidade de exibição do item. */
export function unidadeDoEstoque(estoqueItem) {
  return getEstoqueUnidadeEntrada(estoqueItem) || getEstoqueUnidade(estoqueItem) || "kg";
}

export function saldoAtualDoLocal(locaisSaldo, tipoLocal) {
  const locais = locaisSaldo || {};
  if (tipoLocal === TIPO_LOCAL.EMBALADO) return Number(locais.patio) || 0;
  if (tipoLocal === TIPO_LOCAL.TANQUE) return Number(locais.vasilhames) || 0;
  if (tipoLocal === TIPO_LOCAL.TANKA) return Number(locais.tankas) || 0;
  return 0;
}

export { getEstoqueQuantidade, entities };
