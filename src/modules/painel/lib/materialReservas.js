import {
  getEstoqueSaldoEntrada,
  getEstoqueUnidadeEntrada,
  hydrateEstoqueFiscal,
} from '@transbordo/lib/estoqueSaldo';
import { formatMass, formatVolume } from '@transbordo/lib/format';
import { isEstoqueEmbalagemUnitaria } from '@transbordo/lib/transbordoEmbalado';
import { isVasilhameReservaChave } from '@painel/lib/vasilhameReservas';
import { entities } from '@transbordo/services/entities';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Normaliza texto para chave estável de agregação. */
function norm(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

/** Aceita apenas UUID válido para colunas uuid do ChemFlow; caso contrário null. */
function toUuidOrNull(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return UUID_RE.test(s) ? s : null;
}

/** ID do usuário da plataforma ChemCtrl (pode ser ObjectId / string). */
function toUserIdText(value) {
  if (value == null || value === '') return null;
  return String(value).trim() || null;
}

/**
 * Chave de agregação comercial: cliente + produto + lote + unidade.
 * Garante que lotes iguais do mesmo produto/cliente/unidade somem em uma linha.
 */
export function buildReservaChave({
  clienteId,
  clienteNome,
  produtoCodigo,
  lote,
  unidade,
}) {
  const cliente = clienteId || norm(clienteNome) || '';
  return [cliente, norm(produtoCodigo), norm(lote), String(unidade || 'kg').trim()].join(
    '||'
  );
}

export function chaveFromEstoqueRow(estoqueItem) {
  return buildReservaChave({
    clienteId: estoqueItem?.cliente_id,
    clienteNome: estoqueItem?.cliente_nome,
    produtoCodigo: estoqueItem?.produto_codigo,
    lote: estoqueItem?.lote,
    unidade: getEstoqueUnidadeEntrada(estoqueItem),
  });
}

export function isVolumeUnit(unidade) {
  const u = String(unidade || 'kg').toLowerCase();
  return u === 'l' || u === 'lt' || u === 'litro' || u === 'litros' || u === 'gal';
}

export function formatQty(value, unidade) {
  if (isVolumeUnit(unidade)) return formatVolume(value, { empty: '—' });
  return formatMass(value, { empty: '—' });
}

/**
 * Agrega estoque do Transbordo por lote (cliente + produto + lote + unidade).
 * @param {Array} estoqueRows - registros já com saldo_atual recalculado
 * @param {Array} reservas - registros de t_material_reservas
 */
export function aggregateEstoqueByLote(estoqueRows = [], reservas = []) {
  const map = new Map();

  for (const raw of estoqueRows) {
    if (!raw || isEstoqueEmbalagemUnitaria(raw)) continue;

    const item = hydrateEstoqueFiscal(raw);
    const saldo = getEstoqueSaldoEntrada(item);
    const unidade = getEstoqueUnidadeEntrada(item) || 'kg';
    const lote = String(item.lote || '').trim() || '—';
    const codigo = String(item.produto_codigo || '').trim() || '—';
    const produto = String(item.produto_nome || '').trim() || '—';
    const clienteNome = String(item.cliente_nome || '').trim() || '—';
    const chave = buildReservaChave({
      clienteId: item.cliente_id,
      clienteNome: item.cliente_nome,
      produtoCodigo: item.produto_codigo,
      lote: item.lote,
      unidade,
    });

    const prev = map.get(chave);
    if (prev) {
      prev.saldoAtual += saldo;
      prev.estoqueIds.push(item.id);
      if (!prev.produtoId && item.produto_id) prev.produtoId = item.produto_id;
      if (!prev.clienteId && item.cliente_id) prev.clienteId = item.cliente_id;
      if (prev.lote === '—' && lote !== '—') prev.lote = lote;
    } else {
      map.set(chave, {
        id: chave,
        chave,
        clienteId: item.cliente_id || null,
        clienteNome,
        produtoId: item.produto_id || null,
        codigo,
        produto,
        lote,
        unidade,
        saldoAtual: saldo,
        estoqueIds: item.id ? [item.id] : [],
        densidade: item.densidade || item.lotes?.[0]?.densidade || null,
      });
    }
  }

  const reservadoByChave = new Map();
  for (const r of reservas || []) {
    if (!r || r.status !== 'ativa') continue;
    const chave = r.chave;
    if (!chave || isVasilhameReservaChave(chave)) continue;
    reservadoByChave.set(
      chave,
      (reservadoByChave.get(chave) || 0) + (Number(r.quantidade) || 0)
    );
  }

  // Inclui chaves que só têm reserva (estoque zerado)
  for (const [chave, qtd] of reservadoByChave) {
    if (map.has(chave)) continue;
    const sample = (reservas || []).find((r) => r.chave === chave);
    if (!sample) continue;
    map.set(chave, {
      id: chave,
      chave,
      clienteId: sample.cliente_id || null,
      clienteNome: sample.cliente_nome || '—',
      produtoId: sample.produto_id || null,
      codigo: sample.produto_codigo || '—',
      produto: sample.produto_nome || '—',
      lote: sample.lote || '—',
      unidade: sample.unidade_medida || 'kg',
      saldoAtual: 0,
      estoqueIds: [],
      densidade: null,
    });
  }

  return [...map.values()]
    .map((row) => {
      const saldoReservado = Math.round(reservadoByChave.get(row.chave) || 0);
      const saldoAtual = Math.round(row.saldoAtual || 0);
      const saldoFinal = Math.max(0, saldoAtual - saldoReservado);
      return {
        ...row,
        saldoAtual,
        saldoReservado,
        saldoFinal,
      };
    })
    .filter((row) => row.saldoAtual > 0 || row.saldoReservado > 0)
    .sort((a, b) => {
      const byCliente = String(a.clienteNome).localeCompare(String(b.clienteNome), 'pt-BR');
      if (byCliente !== 0) return byCliente;
      const byCod = String(a.codigo).localeCompare(String(b.codigo), 'pt-BR', {
        numeric: true,
      });
      if (byCod !== 0) return byCod;
      return String(a.lote).localeCompare(String(b.lote), 'pt-BR', { numeric: true });
    });
}

export function sumReservasAtivas(reservas = [], chave) {
  return (reservas || [])
    .filter((r) => r.chave === chave && r.status === 'ativa')
    .reduce((s, r) => s + (Number(r.quantidade) || 0), 0);
}

/**
 * Chave comercial sem lote: cliente + produto + unidade.
 * Usada para consolidar reservas na visão agregada de Estoque Envio.
 */
export function buildReservaChaveSemLote({
  clienteId,
  clienteNome,
  produtoCodigo,
  unidade,
}) {
  const cliente = clienteId || norm(clienteNome) || '';
  return [cliente, norm(produtoCodigo), String(unidade || 'kg').trim()].join('||');
}

/**
 * Soma reservas ativas de um produto/cliente/unidade (todos os lotes).
 * Diferencia pelo nome/descrição do produto quando informado (ex.: Bombona vs IBC).
 * Aceita match de cliente por cliente_id ou, na ausência, por nome normalizado.
 */
export function sumReservadoForProdutoCliente(
  reservas = [],
  { clienteId, clienteNome, produtoCodigo, produtoNome, unidade } = {}
) {
  const cod = norm(produtoCodigo);
  const nome = produtoNome != null ? norm(produtoNome) : '';
  const uni = String(unidade || 'kg').trim();
  const cliNome = norm(clienteNome);
  const cliId = clienteId ? String(clienteId).trim() : '';

  return (reservas || []).reduce((sum, r) => {
    if (!r || r.status !== 'ativa') return sum;
    if (norm(r.produto_codigo) !== cod) return sum;
    if (String(r.unidade_medida || 'kg').trim() !== uni) return sum;

    // Quando o nome é critério de identidade, não mistura descrições distintas
    if (nome) {
      const rNome = norm(r.produto_nome);
      if (rNome !== nome) return sum;
    }

    const rId = r.cliente_id ? String(r.cliente_id).trim() : '';
    const rCliNome = norm(r.cliente_nome);

    let sameCliente = false;
    if (cliId && rId) sameCliente = cliId === rId;
    else if (cliNome && rCliNome) sameCliente = cliNome === rCliNome;
    else sameCliente = !cliId && !cliNome && !rId && !rCliNome;

    if (!sameCliente) return sum;
    return sum + (Number(r.quantidade) || 0);
  }, 0);
}

export function listReservasForChave(reservas = [], chave) {
  return (reservas || [])
    .filter((r) => r.chave === chave)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

/**
 * Ajusta o saldo reservado total da chave para `novaQuantidade`.
 * Aumentos criam nova reserva; reduções marcam registros como removidos (com auditoria).
 */
export async function setSaldoReservado({
  row,
  novaQuantidade,
  user,
  observacao = '',
  motivoRemocao = '',
}) {
  if (!row?.chave) throw new Error('Linha de estoque inválida.');

  const target = Math.max(0, Math.round(Number(novaQuantidade) || 0));
  const saldoAtual = Math.round(Number(row.saldoAtual) || 0);
  if (target > saldoAtual) {
    throw new Error(
      `Quantidade reservada (${target}) não pode exceder o saldo atual (${saldoAtual} ${row.unidade}).`
    );
  }

  const all = await entities.materialReservas.filter({ chave: row.chave });
  const ativas = (all || [])
    .filter((r) => r.status === 'ativa')
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const atual = ativas.reduce((s, r) => s + (Number(r.quantidade) || 0), 0);
  const usuarioNome =
    user?.nome || user?.full_name || user?.username || user?.email || '—';
  const usuarioId = toUserIdText(user?.id);

  const basePayload = {
    chave: row.chave,
    cliente_id: toUuidOrNull(row.clienteId),
    cliente_nome: row.clienteNome || null,
    produto_id: toUuidOrNull(row.produtoId),
    produto_codigo: row.codigo === '—' ? '' : row.codigo,
    produto_nome: row.produto === '—' ? null : row.produto,
    lote: row.lote === '—' ? '' : row.lote,
    unidade_medida: row.unidade || 'kg',
  };

  if (target === atual) return { changed: false, saldoReservado: atual };

  if (target > atual) {
    const delta = target - atual;
    await entities.materialReservas.create({
      ...basePayload,
      quantidade: delta,
      status: 'ativa',
      usuario_id: usuarioId,
      usuario_nome: usuarioNome,
      observacao: observacao || null,
    });
    return { changed: true, saldoReservado: target };
  }

  // Redução: remove das reservas mais recentes
  let remaining = atual - target;
  const now = new Date().toISOString();

  for (const reserva of ativas) {
    if (remaining <= 0) break;
    const qtd = Number(reserva.quantidade) || 0;
    if (qtd <= 0) continue;

    if (qtd <= remaining) {
      await entities.materialReservas.update(reserva.id, {
        status: 'removida',
        removido_em: now,
        removido_por_id: usuarioId,
        removido_por_nome: usuarioNome,
        motivo_remocao: motivoRemocao || observacao || 'Ajuste de saldo reservado',
      });
      remaining -= qtd;
    } else {
      // Parcial: reduz a ativa e registra a parcela removida
      await entities.materialReservas.update(reserva.id, {
        quantidade: qtd - remaining,
      });
      await entities.materialReservas.create({
        ...basePayload,
        quantidade: remaining,
        status: 'removida',
        usuario_id: toUserIdText(reserva.usuario_id),
        usuario_nome: reserva.usuario_nome || '—',
        observacao: reserva.observacao || null,
        removido_em: now,
        removido_por_id: usuarioId,
        removido_por_nome: usuarioNome,
        motivo_remocao: motivoRemocao || observacao || 'Ajuste parcial de saldo reservado',
        created_at: reserva.created_at || now,
      });
      remaining = 0;
    }
  }

  return { changed: true, saldoReservado: target };
}
