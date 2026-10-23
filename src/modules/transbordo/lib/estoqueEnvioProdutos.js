import {
  getEstoqueSaldoEntrada,
  getEstoqueUnidadeEntrada,
  isUnidadeVolumeEntrada,
  normalizeUnidadeEntrada,
} from "@transbordo/lib/estoqueSaldo";
import {
  entradaByIdMap,
  isMateriaPrimaIndustrializacao,
} from "@transbordo/lib/materiaPrimaIndustrializacao";
import { resolveTipoRecebimentoEstoque } from "@transbordo/lib/tipoRecebimento";

function normNome(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function clientePorNome(clientes, nome) {
  const key = normNome(nome);
  if (!key) return null;
  return (clientes || []).find((c) => normNome(c?.nome) === key) || null;
}

/**
 * Chave de deduplicação produto+cliente (normalizada, case/accent-insensitive).
 */
function prodClienteKey(produto, clienteNome) {
  return `${normNome(produto)}||${normNome(clienteNome)}`;
}

/** Chave única do produto na grade consolidada (sem unidade). */
export function estoqueEnvioGrupoKey(f) {
  return [
    String(f?.codigo || "").trim() || "—",
    normNome(f?.produto),
    f?.cliente_id || normNome(f?.cliente_nome) || "",
  ].join("||");
}

/**
 * Remove espelhos de estoque em L por vasilhame quando o mesmo produto já
 * tem saldo em massa (kg): evita linha duplicada; o físico fica na coluna Tanque.
 */
function suprimirEspelhosVasilhameEmLitros(fontes) {
  const grupoTemMassa = new Map();
  for (const f of fontes || []) {
    if (!isUnidadeVolumeEntrada(f.unidade)) {
      grupoTemMassa.set(estoqueEnvioGrupoKey(f), true);
    }
  }
  return (fontes || []).filter((f) => {
    if (!isUnidadeVolumeEntrada(f.unidade)) return true;
    if (f.tipo_recebimento === "vasilhame" && grupoTemMassa.get(estoqueEnvioGrupoKey(f))) {
      return false;
    }
    return true;
  });
}

/**
 * Fontes do consolidado de produtos em Estoque Envio.
 *
 * Transbordo: saldo operacional (quantidade recebida menos saídas).
 * Matéria-prima: saldo atual de estoque_mp (current_stock).
 *
 * O espelho em t_estoque guarda o saldo de entrada (initial_stock) e não entra
 * na soma quando a industrialização foi carregada, para não duplicar o lote.
 *
 * indStock só entra para produtos que NÃO aparecem no estoque de Transbordo:
 * evita linha duplicada quando o mesmo produto existe em ambas as origens.
 */
export function collectEstoqueEnvioFontes({
  estoque,
  entradas,
  indStock,
  clientes,
  indStockReady,
}) {
  const entradasPorId = entradaByIdMap(entradas);
  const fontes = [];

  // Rastreia produto+cliente já publicado pelo Transbordo para
  // suprimir entradas duplicadas de indStock.
  const transbordoKeys = new Set();

  for (const item of estoque || []) {
    if (
      indStockReady &&
      isMateriaPrimaIndustrializacao(
        item,
        entradasPorId.get(item?.entrada_id != null ? String(item.entrada_id) : "")
      )
    ) {
      continue;
    }

    const saldo = getEstoqueSaldoEntrada(item);
    if (saldo <= 0) continue;

    const produto = String(item?.produto_nome || "").trim() || "—";
    const clienteNome = item?.cliente_nome || "";

    const tipoRecebimento = resolveTipoRecebimentoEstoque(item);
    fontes.push({
      codigo: String(item?.produto_codigo || "").trim() || "—",
      produto,
      unidade: getEstoqueUnidadeEntrada(item) || "kg",
      saldo,
      cliente_nome: clienteNome,
      cliente_id: item?.cliente_id || null,
      embalado: tipoRecebimento === "embalado",
      tipo_recebimento: tipoRecebimento,
    });

    // Registra como "já coberto pelo Transbordo"
    transbordoKeys.add(prodClienteKey(produto, clienteNome));
  }

  let merged = suprimirEspelhosVasilhameEmLitros(fontes);

  if (!indStockReady) return merged;

  for (const mp of indStock || []) {
    const saldo = Number(mp?.current_stock);
    if (!Number.isFinite(saldo) || saldo <= 0) continue;

    const clienteNome = String(mp?.client || "").trim();
    const cliente = clientePorNome(clientes, clienteNome);
    const resolvedClienteNome = cliente?.nome || clienteNome;
    const produto = String(mp?.mp_name || "").trim() || "—";

    // Suprime duplicata: produto+cliente já publicado pelo Transbordo
    if (transbordoKeys.has(prodClienteKey(produto, resolvedClienteNome))) continue;

    merged.push({
      codigo: String(mp?.mp_code || "").trim() || "—",
      produto,
      unidade: normalizeUnidadeEntrada(mp?.unit) || "kg",
      saldo,
      cliente_nome: resolvedClienteNome,
      cliente_id: cliente?.id || null,
      embalado: false,
      tipo_recebimento: "materia_prima",
    });
  }

  return merged;
}
