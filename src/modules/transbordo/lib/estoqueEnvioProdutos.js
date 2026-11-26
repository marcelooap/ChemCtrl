import { productsMatch } from "@industrializacao/lib/recipeRevisions";
import {
  getEstoqueSaldoEntrada,
  getEstoqueUnidadeEntrada,
  isUnidadeVolumeEntrada,
  normalizeUnidadeEntrada,
  somaLocaisEstoque,
} from "@transbordo/lib/estoqueSaldo";
import { parseDensidade, roundQuantidade } from "@transbordo/lib/format";
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

function normLoteKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

/**
 * Converte quantidade entre massa e volume usando densidade (kg/L).
 * Sem densidade válida não inventa o outro eixo (retorna 0).
 */
export function converterQuantidadeEntreUom(qty, unidadeOrigem, unidadeAlvo, densidade) {
  const q = Number(qty) || 0;
  if (!(q > 0)) return 0;
  const fromVol = isUnidadeVolumeEntrada(unidadeOrigem);
  const toVol = isUnidadeVolumeEntrada(unidadeAlvo);
  if (fromVol === toVol) return q;
  const dens = parseDensidade(densidade);
  if (!(dens > 0) || dens >= 20) return 0;
  return toVol ? roundQuantidade(q / dens) : roundQuantidade(q * dens);
}

/**
 * Unidade canônica do grupo produto+cliente.
 * Se há qualquer fonte em volume, o consolidado é em L (pátio físico).
 * Nunca promove o grupo para kg quando já existe L — isso rotulava mal
 * e somava kg+L sem conversão.
 */
export function resolveUnidadeCanonicaGrupo(fontesDoGrupo) {
  const list = fontesDoGrupo || [];
  if (list.some((f) => isUnidadeVolumeEntrada(f?.unidade))) {
    return "L";
  }
  const first = list.find((f) => f?.unidade != null && String(f.unidade).trim());
  return normalizeUnidadeEntrada(first?.unidade) || "kg";
}

/**
 * Reescreve uma fonte na unidade canônica do grupo (com densidade).
 *
 * Embalado sem densidade válida: o saldo é a quantidade nominal da embalagem
 * (ex.: BALDE 12 KG lançado em kg ou L). Igual à tela de Estoque
 * (`valorNaUnidadeEntrada` não converte embalado). Relabel a UOM do grupo
 * e preserva o número — zerar via kg↔L apagava linhas reais (GAMAZYME 72+120).
 */
export function converterFonteParaUnidade(fonte, unidadeAlvo) {
  if (!fonte) return fonte;
  const alvo = isUnidadeVolumeEntrada(unidadeAlvo)
    ? "L"
    : normalizeUnidadeEntrada(unidadeAlvo) || "kg";
  const origem = fonte.unidade || "kg";
  if (
    isUnidadeVolumeEntrada(origem) === isUnidadeVolumeEntrada(alvo) &&
    normalizeUnidadeEntrada(origem) === normalizeUnidadeEntrada(alvo)
  ) {
    return { ...fonte, unidade: alvo };
  }

  const dens = parseDensidade(fonte.densidade);
  const densidadeValida = dens > 0 && dens < 20;
  const isEmbalado =
    fonte.tipo_recebimento === "embalado" || fonte.embalado === true;
  if (isEmbalado && !densidadeValida) {
    return { ...fonte, unidade: alvo };
  }

  const conv = (q) => converterQuantidadeEntreUom(q, origem, alvo, fonte.densidade);
  return {
    ...fonte,
    unidade: alvo,
    saldo: conv(fonte.saldo),
    saldoEmbalado: conv(fonte.saldoEmbalado),
    saldoTanque: conv(fonte.saldoTanque),
    saldoTanka: conv(fonte.saldoTanka),
  };
}

/**
 * Remove espelhos em L de entrada tipo vasilhame quando o MESMO lote já
 * existe em massa (kg) no grupo: evita duplicar o físico na coluna Tanque.
 *
 * Não suprime entradas vasilhame de lote distinto — entradas reais
 * (ex.: OS-1627 em L ao lado de OF-1489 em kg) devem permanecer.
 */
export function suprimirEspelhosVasilhameEmLitros(fontes) {
  const lotesMassaPorGrupo = new Map();
  for (const f of fontes || []) {
    if (isUnidadeVolumeEntrada(f.unidade)) continue;
    const lote = normLoteKey(f.lote);
    if (!lote) continue;
    const key = estoqueEnvioGrupoKey(f);
    let set = lotesMassaPorGrupo.get(key);
    if (!set) {
      set = new Set();
      lotesMassaPorGrupo.set(key, set);
    }
    set.add(lote);
  }
  return (fontes || []).filter((f) => {
    if (!isUnidadeVolumeEntrada(f.unidade)) return true;
    if (f.tipo_recebimento !== "vasilhame") return true;
    const massLotes = lotesMassaPorGrupo.get(estoqueEnvioGrupoKey(f));
    if (!massLotes || massLotes.size === 0) return true;
    const lote = normLoteKey(f.lote);
    if (lote && massLotes.has(lote)) return false;
    return true;
  });
}

/**
 * Quando o mesmo produto+cliente mistura L e kg, normaliza tudo para a
 * unidade canônica (L se houver volume). Aplica a todo produto — não só SCAVEN.
 */
export function normalizarGruposComMisturaUom(fontes) {
  const byKey = new Map();
  for (const f of fontes || []) {
    const key = estoqueEnvioGrupoKey(f);
    let list = byKey.get(key);
    if (!list) {
      list = [];
      byKey.set(key, list);
    }
    list.push(f);
  }

  const canonByKey = new Map();
  for (const [key, list] of byKey) {
    canonByKey.set(key, resolveUnidadeCanonicaGrupo(list));
  }

  return (fontes || []).map((f) => {
    const canon = canonByKey.get(estoqueEnvioGrupoKey(f));
    if (!canon) return f;
    const sameAxis =
      isUnidadeVolumeEntrada(f.unidade) === isUnidadeVolumeEntrada(canon);
    if (sameAxis) {
      return {
        ...f,
        unidade: isUnidadeVolumeEntrada(canon)
          ? "L"
          : normalizeUnidadeEntrada(f.unidade) || canon,
      };
    }
    return converterFonteParaUnidade(f, canon);
  });
}

/**
 * Consolida fontes já filtradas em uma linha por produto+cliente.
 * Sempre reconverte para a UOM canônica do grupo antes de somar — defesa
 * em profundidade caso alguma fonte escape da normalização prévia.
 */
export function aggregateEstoqueEnvioProdutos(fontes) {
  const buckets = new Map();
  for (const raw of fontes || []) {
    const saldo = Number(raw?.saldo) || 0;
    if (saldo <= 0) continue;
    const key = estoqueEnvioGrupoKey(raw);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, members: [] };
      buckets.set(key, bucket);
    }
    bucket.members.push(raw);
  }

  const rows = [];
  for (const { key, members } of buckets.values()) {
    const unidade = resolveUnidadeCanonicaGrupo(members);
    let saldo = 0;
    let saldoEmbalado = 0;
    let saldoTanque = 0;
    let saldoTanka = 0;
    let colunasLivro = false;
    let clienteId = null;
    let clienteNome = "";
    let codigo = "—";
    let produto = "—";

    for (const raw of members) {
      const e = converterFonteParaUnidade(raw, unidade);
      saldo += Number(e.saldo) || 0;
      saldoEmbalado += Number(e.saldoEmbalado) || 0;
      saldoTanque += Number(e.saldoTanque) || 0;
      saldoTanka += Number(e.saldoTanka) || 0;
      if (e.colunasLivro) colunasLivro = true;
      if (!clienteId && e.cliente_id) clienteId = e.cliente_id;
      if (!clienteNome && e.cliente_nome) clienteNome = e.cliente_nome;
      if (e.codigo && e.codigo !== "—") codigo = e.codigo;
      if (e.produto && e.produto !== "—") produto = e.produto;
    }

    rows.push({
      id: key,
      codigo,
      produto,
      unidade,
      saldo,
      saldoEmbalado,
      saldoTanque,
      saldoTanka,
      colunasLivro,
      cliente_nome: clienteNome,
      clienteId,
    });
  }
  return rows;
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
      lote: item?.lote || item?.lotes?.[0]?.lote || "",
      densidade:
        item?.densidade ||
        item?.lotes?.[0]?.densidade ||
        null,
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

  let merged = normalizarGruposComMisturaUom(
    suprimirEspelhosVasilhameEmLitros(fontes)
  );

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

  return normalizarGruposComMisturaUom(merged);
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
