import { entities } from "@transbordo/services/entities";
import { resolveEstoqueIdFromOrigemTransbordo } from "@transbordo/lib/estoqueSaldo";

const NF_FROM_CODIGO_RE = /\bNF\s*([A-Za-z0-9\/\-]+)\b/i;

export function extractNotaFiscalFromOrigemCodigo(codigo = "") {
  const match = String(codigo || "").match(NF_FROM_CODIGO_RE);
  return match ? String(match[1] || "").trim() : "";
}

function sameText(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function isPendingGranelId(value) {
  const id = String(value || "").trim();
  return !id || id.startsWith("__PENDING_GRANEL__");
}

function matchEstoqueByOrigem(estoqueList = [], origem = {}, transbordo = {}) {
  const lote = String(origem?.lote || "").trim();
  const nf =
    extractNotaFiscalFromOrigemCodigo(origem?.entrada_codigo) ||
    String(origem?.nota_fiscal || "").trim();
  const clienteId = transbordo?.cliente_id || origem?.cliente_id || null;
  const produtoId = transbordo?.produto_id || origem?.produto_id || null;

  const candidates = (estoqueList || []).filter((row) => {
    if (!row?.id) return false;
    if (String(row?.grupo_entrada || "").startsWith("TB")) return false;
    if (lote && !sameText(row.lote, lote)) return false;
    if (nf) {
      const rowNf = String(row.nota_fiscal || "").trim();
      if (rowNf && !sameText(rowNf, nf)) return false;
      if (!rowNf && nf) {
        // Sem NF no estoque: ainda aceita se lote+cliente/produto baterem.
      }
    }
    if (clienteId && row.cliente_id && String(row.cliente_id) !== String(clienteId)) {
      return false;
    }
    if (produtoId && row.produto_id && String(row.produto_id) !== String(produtoId)) {
      return false;
    }
    return Boolean(lote || nf);
  });

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1 && nf) {
    const byNf = candidates.filter((row) => sameText(row.nota_fiscal, nf));
    if (byNf.length === 1) return byNf[0];
    if (byNf.length > 0) return byNf[0];
  }
  return candidates[0] || null;
}

async function loadEntradaFromEstoqueId(estoqueId, estoqueList = []) {
  if (!estoqueId || isPendingGranelId(estoqueId)) return { entrada: null, estoque: null };

  const estoque =
    (estoqueList || []).find((e) => String(e?.id) === String(estoqueId)) || null;
  const parentId = estoque?.entrada_id || null;

  let entrada = null;
  if (parentId && !isPendingGranelId(parentId)) {
    entrada = await entities.entradas.get(parentId).catch(() => null);
  }
  if (!entrada?.id) {
    entrada = await entities.entradas.get(estoqueId).catch(() => null);
  }
  if (!entrada?.id && estoque?.id) {
    entrada = estoque;
  }
  return { entrada, estoque };
}

async function loadEntradaFromValidacao(transbordoId) {
  if (!transbordoId) return null;
  const rows = await entities.transbordoValidacoes
    .filter({ transbordo_id: transbordoId })
    .catch(() => []);
  const entradaId = rows?.[0]?.entrada_id || null;
  if (!entradaId || isPendingGranelId(entradaId)) return null;
  return entities.entradas.get(entradaId).catch(() => null);
}

/**
 * Resolve o recebimento (entrada) para impressão de etiqueta de origem granel.
 * Cobre OPs legados da Ordem de Transbordo que ficaram com entrada_id null.
 */
export async function resolveOrigemGranelRecebimento({
  origem,
  transbordo,
  estoqueList = [],
  estoqueCodigoMap = {},
} = {}) {
  if (!origem) {
    throw new Error("Origem granel sem vínculo com o recebimento.");
  }

  let estoqueId = resolveEstoqueIdFromOrigemTransbordo(origem);
  let estoque = null;
  let entrada = null;

  if (estoqueId && !isPendingGranelId(estoqueId)) {
    ({ entrada, estoque } = await loadEntradaFromEstoqueId(estoqueId, estoqueList));
  }

  if (!entrada?.id) {
    const matched = matchEstoqueByOrigem(estoqueList, origem, transbordo);
    if (matched?.id) {
      estoqueId = matched.id;
      ({ entrada, estoque } = await loadEntradaFromEstoqueId(matched.id, estoqueList));
      if (!entrada?.id && matched.entrada_id) {
        entrada = await entities.entradas.get(matched.entrada_id).catch(() => null);
      }
      if (!entrada?.id) entrada = matched;
    }
  }

  if (!entrada?.id) {
    entrada = await loadEntradaFromValidacao(transbordo?.id);
  }

  if (!entrada?.id) {
    throw new Error(
      estoqueId && !isPendingGranelId(estoqueId)
        ? "Não foi possível carregar o recebimento desta origem."
        : "Origem granel sem vínculo com o recebimento."
    );
  }

  const entradaCodigo =
    String(entrada.id_entrada || "").trim() ||
    (estoqueId ? estoqueCodigoMap[estoqueId] : "") ||
    estoqueCodigoMap[entrada.id] ||
    String(estoque?.entrada_codigo || "").trim() ||
    String(entrada.entrada_codigo || "").trim() ||
    "";

  return { entrada, entradaCodigo, estoqueId: estoqueId || estoque?.id || null };
}
