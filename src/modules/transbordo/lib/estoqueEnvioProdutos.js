import {
  getEstoqueSaldoEntrada,
  getEstoqueUnidadeEntrada,
  normalizeUnidadeEntrada,
} from "@transbordo/lib/estoqueSaldo";
import {
  entradaByIdMap,
  isMateriaPrimaIndustrializacao,
} from "@transbordo/lib/materiaPrimaIndustrializacao";

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
 * Fontes do consolidado de produtos em Estoque Envio.
 *
 * Transbordo: saldo operacional (quantidade recebida menos saídas).
 * Matéria-prima: saldo atual de estoque_mp (current_stock).
 * O espelho em t_estoque guarda o saldo de entrada (initial_stock) e não entra
 * na soma quando a industrialização foi carregada, para não duplicar o lote.
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

    fontes.push({
      codigo: String(item?.produto_codigo || "").trim() || "—",
      produto: String(item?.produto_nome || "").trim() || "—",
      unidade: getEstoqueUnidadeEntrada(item) || "kg",
      saldo,
      cliente_nome: item?.cliente_nome || "",
      cliente_id: item?.cliente_id || null,
    });
  }

  if (!indStockReady) return fontes;

  for (const mp of indStock || []) {
    const saldo = Number(mp?.current_stock);
    if (!Number.isFinite(saldo) || saldo <= 0) continue;

    const clienteNome = String(mp?.client || "").trim();
    const cliente = clientePorNome(clientes, clienteNome);

    fontes.push({
      codigo: String(mp?.mp_code || "").trim() || "—",
      produto: String(mp?.mp_name || "").trim() || "—",
      unidade: normalizeUnidadeEntrada(mp?.unit) || "kg",
      saldo,
      cliente_nome: cliente?.nome || clienteNome,
      cliente_id: cliente?.id || null,
    });
  }

  return fontes;
}
