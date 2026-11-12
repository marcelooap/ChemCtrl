import { productsMatch } from "@industrializacao/lib/recipeRevisions";
import {
  getEstoqueSaldoEntrada,
  getEstoqueUnidadeEntrada,
  isUnidadeVolumeEntrada,
  normalizeUnidadeEntrada,
  somaLocaisEstoque,
} from "@transbordo/lib/estoqueSaldo";
import { asLoteList } from "@transbordo/lib/lotesList";
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
 * Produto acabado (ou físico) já coberto por uma linha agregada de livro/MP.
 */
export function agregadoCoversPhysicalSlot(agregados, slot) {
  const clienteSlot = normNome(slot?.cliente_nome);
  if (!clienteSlot) return false;

  return (agregados || []).some((p) => {
    if (normNome(p?.cliente_nome) !== clienteSlot) return false;

    const codP = String(p?.codigo === "—" ? "" : p?.codigo || "").trim();
    const codS = String(slot?.codigo || "").trim();
    if (codP && codS && normNome(codP) === normNome(codS)) return true;

    const prodP = String(p?.produto || "").trim();
    const prodS = String(slot?.produto || "").trim();
    if (prodP && prodS && productsMatch(prodP, prodS)) return true;
    return normNome(prodP) === normNome(prodS);
  });
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

    const produto = String(item?.produto_nome || "").trim() || "—";
    const clienteNome = item?.cliente_nome || "";

    const tipoRecebimento = resolveTipoRecebimentoEstoque(item);
    const locais = item?.locais;
    const colunasLivro = Boolean(locais);
    // Mesma regra da tela de Estoque: Saldo Atual = embalado + tanque + tanka.
    const saldo = colunasLivro
      ? somaLocaisEstoque(locais)
      : getEstoqueSaldoEntrada(item);
    if (saldo <= 0) continue;

    fontes.push({
      codigo: String(item?.produto_codigo || "").trim() || "—",
      produto,
      unidade: getEstoqueUnidadeEntrada(item) || "kg",
      saldo,
      cliente_nome: clienteNome,
      cliente_id: item?.cliente_id || null,
      embalado: tipoRecebimento === "embalado",
      tipo_recebimento: tipoRecebimento,
      // Mesmas colunas da tela de Estoque (pátio/embalado / tanque / tanka).
      // patio já inclui destinos unitários (bombona/tambor/IBC) do transbordo.
      saldoEmbalado: colunasLivro
        ? Number(locais.patio) || 0
        : tipoRecebimento === "embalado"
          ? saldo
          : 0,
      saldoTanque: colunasLivro ? Number(locais.vasilhames) || 0 : 0,
      saldoTanka: colunasLivro ? Number(locais.tankas) || 0 : 0,
      colunasLivro,
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

function normLoteKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function controleQualidadeKey({ codigo, produto, lote }) {
  return [
    String(codigo || "").trim() || "—",
    normNome(produto),
    normLoteKey(lote),
  ].join("||");
}

function toDateOnlyKey(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = raw.includes("T") ? new Date(raw) : new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Lotes com validade para a folha "Controle de Qualidade" do PDF de Estoque Envio.
 * Uma linha por lote (produto com 3 lotes → 3 linhas). Sem filtro de cliente/busca —
 * o caller aplica o mesmo recorte da tela.
 */
export function collectControleQualidadeLotes({
  estoque,
  entradas,
  indStock,
  clientes,
  indStockReady,
}) {
  const entradasPorId = entradaByIdMap(entradas);
  const map = new Map();
  const transbordoKeys = new Set();

  const upsert = (row) => {
    const codigo = String(row?.codigo || "").trim() || "—";
    const produto = String(row?.produto || "").trim() || "—";
    const lote = String(row?.lote || "").trim();
    if (!lote) return;

    const key = controleQualidadeKey({ codigo, produto, lote });
    const next = {
      codigo,
      produto,
      lote,
      data_validade: row?.validade_indeterminada
        ? null
        : row?.data_validade || null,
      validade_indeterminada: Boolean(row?.validade_indeterminada),
      cliente_nome: row?.cliente_nome || "",
      cliente_id: row?.cliente_id || null,
    };

    const prev = map.get(key);
    if (!prev) {
      map.set(key, next);
      return;
    }

    // Mantém a validade mais próxima do vencimento quando o mesmo lote aparece
    // em mais de uma origem (Transbordo / espelho).
    if (prev.validade_indeterminada && !next.validade_indeterminada) {
      map.set(key, { ...prev, ...next });
      return;
    }
    if (!prev.validade_indeterminada && next.validade_indeterminada) return;

    const prevKey = toDateOnlyKey(prev.data_validade);
    const nextKey = toDateOnlyKey(next.data_validade);
    if (!prevKey && nextKey) {
      map.set(key, { ...prev, ...next });
    } else if (prevKey && nextKey && nextKey < prevKey) {
      map.set(key, { ...prev, ...next });
    }
  };

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

    const locais = item?.locais;
    const colunasLivro = Boolean(locais);
    const saldo = colunasLivro
      ? somaLocaisEstoque(locais)
      : getEstoqueSaldoEntrada(item);
    if (saldo <= 0) continue;

    const codigo = String(item?.produto_codigo || "").trim() || "—";
    const produto = String(item?.produto_nome || "").trim() || "—";
    const clienteNome = item?.cliente_nome || "";
    const clienteId = item?.cliente_id || null;
    const itemIndeterminada = Boolean(item?.validade_indeterminada);
    const itemValidade = itemIndeterminada ? null : item?.data_validade || null;

    transbordoKeys.add(prodClienteKey(produto, clienteNome));

    const lotes = asLoteList(item?.lotes);
    if (lotes.length === 0) {
      upsert({
        codigo,
        produto,
        lote: item?.lote || "",
        data_validade: itemValidade,
        validade_indeterminada: itemIndeterminada,
        cliente_nome: clienteNome,
        cliente_id: clienteId,
      });
      continue;
    }

    for (const loteRow of lotes) {
      if (
        loteRow?.quantidade != null &&
        Number.isFinite(Number(loteRow.quantidade)) &&
        Number(loteRow.quantidade) <= 0
      ) {
        continue;
      }
      const indeterminada = Boolean(
        loteRow?.validade_indeterminada || itemIndeterminada
      );
      upsert({
        codigo:
          String(loteRow?.produto_codigo || "").trim() ||
          codigo,
        produto:
          String(loteRow?.produto_nome || "").trim() ||
          produto,
        lote: loteRow?.lote || item?.lote || "",
        data_validade: indeterminada
          ? null
          : loteRow?.data_validade || itemValidade || null,
        validade_indeterminada: indeterminada,
        cliente_nome: clienteNome,
        cliente_id: clienteId,
      });
    }
  }

  if (indStockReady) {
    for (const mp of indStock || []) {
      const saldo = Number(mp?.current_stock);
      if (!Number.isFinite(saldo) || saldo <= 0) continue;

      const clienteNome = String(mp?.client || "").trim();
      const cliente = clientePorNome(clientes, clienteNome);
      const resolvedClienteNome = cliente?.nome || clienteNome;
      const produto = String(mp?.mp_name || "").trim() || "—";

      if (transbordoKeys.has(prodClienteKey(produto, resolvedClienteNome))) {
        continue;
      }

      upsert({
        codigo: String(mp?.mp_code || "").trim() || "—",
        produto,
        lote: mp?.lot || mp?.lote || "",
        data_validade: mp?.expiry_date || null,
        validade_indeterminada: false,
        cliente_nome: resolvedClienteNome,
        cliente_id: cliente?.id || null,
      });
    }
  }

  return [...map.values()].sort((a, b) => {
    const byProd = String(a.produto).localeCompare(String(b.produto), "pt-BR", {
      sensitivity: "base",
    });
    if (byProd !== 0) return byProd;
    const byCod = String(a.codigo).localeCompare(String(b.codigo), "pt-BR", {
      numeric: true,
    });
    if (byCod !== 0) return byCod;
    const aVal = a.validade_indeterminada
      ? "9999-99-99"
      : toDateOnlyKey(a.data_validade) || "9999-99-98";
    const bVal = b.validade_indeterminada
      ? "9999-99-99"
      : toDateOnlyKey(b.data_validade) || "9999-99-98";
    if (aVal !== bVal) return aVal.localeCompare(bVal);
    return String(a.lote).localeCompare(String(b.lote), "pt-BR", {
      numeric: true,
      sensitivity: "base",
    });
  });
}
