import { buildReservaChave } from '@painel/lib/materialReservas';
import { roundQuantidade } from '@transbordo/lib/format';

function sameId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function produtoKeyOf(row) {
  return row?.produto_id || row?.produto_nome || '';
}

/**
 * Chave comercial do lote embalado (cliente + produto + lote + unidade).
 * Alinha seleção de saída com a agregação de Reservar Material.
 */
export function chaveFromEntradaEmbalado(
  entrada,
  { clienteId, clienteNome, unidadeFallback = 'kg' } = {}
) {
  return buildReservaChave({
    clienteId: entrada?.cliente_id ?? clienteId,
    clienteNome: entrada?.cliente_nome ?? clienteNome,
    produtoCodigo: entrada?.produto_codigo,
    lote: entrada?.lote,
    unidade: entrada?.unidade_medida || unidadeFallback,
  });
}

function sortEntradasFifo(a, b) {
  const codA = Number(a?.codigo_estoque);
  const codB = Number(b?.codigo_estoque);
  if (Number.isFinite(codA) && Number.isFinite(codB) && codA !== codB) {
    return codA - codB;
  }
  const fabA = a?.data_fabricacao ? new Date(a.data_fabricacao).getTime() : 0;
  const fabB = b?.data_fabricacao ? new Date(b.data_fabricacao).getTime() : 0;
  if (fabA && fabB && fabA !== fabB) return fabA - fabB;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

/**
 * Agrega linhas físicas de estoque em uma opção de lote por chave comercial.
 * Ex.: 800 L + 150 L do mesmo lote → uma opção com 950 L.
 */
export function aggregateLotesEmbaladoOptions({
  entradas = [],
  getAvailableSaldoLote,
  index,
  produtoId,
  produtoNome,
  currentEntradaId = null,
  clienteId,
  clienteNome,
} = {}) {
  const produtoKey = produtoId || produtoNome;
  if (!produtoKey) return [];

  const map = new Map();

  for (const entrada of entradas) {
    if (produtoKeyOf(entrada) !== produtoKey) continue;

    const saldoFisico = Number(entrada.saldo_atual) || 0;
    const isCurrent = sameId(entrada.id, currentEntradaId);
    if (saldoFisico <= 0 && !isCurrent) continue;

    const unidade = entrada.unidade_medida || 'kg';
    const chave = chaveFromEntradaEmbalado(entrada, {
      clienteId,
      clienteNome,
      unidadeFallback: unidade,
    });

    const prev = map.get(chave);
    if (prev) {
      prev.saldoFisico = roundQuantidade(prev.saldoFisico + saldoFisico);
      if (!prev.estoqueIds.some((id) => sameId(id, entrada.id))) {
        prev.estoqueIds.push(entrada.id);
      }
      prev.entradas.push(entrada);
      if (isCurrent || saldoFisico > (Number(prev.primary?.saldo_atual) || 0)) {
        prev.primary = entrada;
        prev.peso_liquido = entrada.peso_liquido || prev.peso_liquido;
      }
      continue;
    }

    map.set(chave, {
      id: chave,
      chave,
      lote: String(entrada.lote || '').trim(),
      unidade_medida: unidade,
      saldoFisico: roundQuantidade(saldoFisico),
      saldoDisponivel: roundQuantidade(saldoFisico),
      estoqueIds: [entrada.id],
      entradas: [entrada],
      primary: entrada,
      produto_id: entrada.produto_id,
      produto_nome: entrada.produto_nome,
      produto_codigo: entrada.produto_codigo,
      peso_liquido: entrada.peso_liquido || 0,
      cliente_id: entrada.cliente_id,
      cliente_nome: entrada.cliente_nome,
    });
  }

  return [...map.values()]
    .map((row) => {
      const disponivel =
        typeof getAvailableSaldoLote === 'function'
          ? Number(getAvailableSaldoLote(row.chave, index)) || 0
          : row.saldoFisico;
      return {
        ...row,
        saldoDisponivel: roundQuantidade(disponivel),
      };
    })
    .filter(
      (row) =>
        row.saldoDisponivel > 0 ||
        (currentEntradaId &&
          (row.estoqueIds || []).some((id) => sameId(id, currentEntradaId)))
    )
    .sort((a, b) =>
      String(a.lote).localeCompare(String(b.lote), 'pt-BR', { numeric: true })
    );
}

/**
 * Saldo disponível agregado do lote (todas as linhas físicas da chave),
 * descontando outras linhas do formulário que usam o mesmo lote.
 */
export function getAvailableSaldoLote({
  entradas = [],
  itens = [],
  currentIndex,
  chave,
  clienteId,
  clienteNome,
  getEntradaSaldo,
} = {}) {
  if (!chave) return 0;

  const doLote = (entradas || []).filter(
    (e) =>
      chaveFromEntradaEmbalado(e, { clienteId, clienteNome }) === chave
  );

  let saldo = doLote.reduce(
    (sum, e) => sum + (Number(getEntradaSaldo?.(e.id)) || 0),
    0
  );

  (itens || []).forEach((item, i) => {
    if (i === currentIndex) return;
    if (item?.tipo !== 'embalado' && item?.tipo !== 'Embalado') return;
    const itemChave =
      item.reserva_chave ||
      chaveFromEntradaEmbalado(
        (entradas || []).find((e) => sameId(e.id, item.entrada_id)),
        {
          clienteId,
          clienteNome,
          unidadeFallback: item.unidade || 'kg',
        }
      );
    if (itemChave !== chave) return;
    saldo -= Number(item.quantidade_solicitada) || 0;
  });

  return roundQuantidade(Math.max(0, saldo));
}

/**
 * Distribui a quantidade solicitada em FIFO pelas linhas físicas do lote.
 */
export function allocateFifoEstoqueLote({
  entradas = [],
  quantidade,
  getEntradaSaldo,
  chave,
  clienteId,
  clienteNome,
} = {}) {
  const qtd = roundQuantidade(quantidade);
  if (!(qtd > 0)) return { alocacoes: [], restante: 0 };

  const rows = (entradas || [])
    .filter((e) => {
      if (!chave) return true;
      return (
        chaveFromEntradaEmbalado(e, { clienteId, clienteNome }) === chave
      );
    })
    .slice()
    .sort(sortEntradasFifo);

  let remaining = qtd;
  const alocacoes = [];

  for (const entrada of rows) {
    if (remaining <= 0) break;
    const disponivel = Math.max(
      0,
      Number(getEntradaSaldo?.(entrada.id) ?? entrada.saldo_atual) || 0
    );
    if (disponivel <= 0) continue;
    const take = roundQuantidade(Math.min(disponivel, remaining));
    if (take <= 0) continue;
    alocacoes.push({ entrada_id: entrada.id, quantidade: take });
    remaining = roundQuantidade(remaining - take);
  }

  return { alocacoes, restante: Math.max(0, remaining) };
}

/** Quantidade de um item de saída que debita um estoque específico. */
export function quantidadeItemParaEstoque(item, estoqueId) {
  if (!item || estoqueId == null) return 0;

  const alocacoes = item.estoque_alocacoes;
  if (Array.isArray(alocacoes) && alocacoes.length > 0) {
    const alocTotal = alocacoes.reduce(
      (sum, a) => sum + (Number(a?.quantidade) || 0),
      0
    );
    const fatia = alocacoes.reduce((sum, a) => {
      if (!sameId(a?.entrada_id, estoqueId)) return sum;
      return sum + (Number(a.quantidade) || 0);
    }, 0);
    if (!(fatia > 0) || !(alocTotal > 0)) return 0;

    const efetiva =
      item.quantidade_carregada != null && item.quantidade_carregada !== ''
        ? Number(item.quantidade_carregada) || 0
        : Number(item.quantidade_solicitada) || 0;
    if (!(efetiva > 0)) return 0;
    if (Math.abs(efetiva - alocTotal) < 1e-9) return fatia;
    return roundQuantidade((fatia / alocTotal) * efetiva);
  }

  if (!sameId(item.entrada_id, estoqueId)) return 0;

  if (item.quantidade_carregada != null && item.quantidade_carregada !== '') {
    return Number(item.quantidade_carregada) || 0;
  }
  return Number(item.quantidade_solicitada) || 0;
}

/** Ids de estoque afetados por um item embalado (alocações ou entrada única). */
export function estoqueIdsFromSaidaItem(item) {
  if (!item || (item.tipo !== 'embalado' && item.tipo !== 'Embalado')) {
    return [];
  }
  const alocacoes = item.estoque_alocacoes;
  if (Array.isArray(alocacoes) && alocacoes.length > 0) {
    return [
      ...new Set(
        alocacoes.map((a) => a?.entrada_id).filter((id) => id != null && id !== '')
      ),
    ];
  }
  return item.entrada_id ? [item.entrada_id] : [];
}
