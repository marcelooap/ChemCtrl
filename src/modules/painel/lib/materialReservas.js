import {
  getEstoqueSaldoEntrada,
  getEstoqueUnidadeEntrada,
  hydrateEstoqueFiscal,
} from '@transbordo/lib/estoqueSaldo';
import { formatMass, formatVolume } from '@transbordo/lib/format';
import { isEstoqueEmbalagemUnitaria } from '@transbordo/lib/transbordoEmbalado';
import { isVasilhameReservaChave } from '@painel/lib/vasilhameReservas';
import { sumBloqueioPendenteChave, rpcCriarMaterialReserva, rpcAtualizarMaterialReserva } from '@painel/lib/saidaReservas';
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
 * @param {Array} saidas - saídas usadas no bloqueio de saída sem reserva pendente
 */
export function aggregateEstoqueByLote(estoqueRows = [], reservas = [], saidas = []) {
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
      const bloqueioPendente = sumBloqueioPendenteChave(saidas, row.chave);
      const saldoFinal = Math.max(0, saldoAtual - saldoReservado - bloqueioPendente);
      return {
        ...row,
        saldoAtual,
        saldoReservado,
        saldoFinal,
        bloqueioPendente,
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
    if (isVasilhameReservaChave(r.chave)) return sum;
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

function normalizeSolicitante(value) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return name.slice(0, 120);
}

function reservaActor(user) {
  return {
    usuarioId: toUserIdText(user?.id),
    usuarioNome: user?.nome || user?.full_name || user?.username || user?.email || '—',
  };
}

function sumAtivas(reservas = []) {
  return (reservas || [])
    .filter((r) => r?.status === 'ativa')
    .reduce((s, r) => s + (Number(r.quantidade) || 0), 0);
}

function assertWithinStock(total, saldoAtual, unidade) {
  const reserved = Math.round(total);
  const stock = Math.round(saldoAtual);
  if (reserved > stock) {
    throw new Error(
      `Quantidade reservada (${reserved}) não pode exceder o saldo disponível para reserva (${stock} ${unidade}).`
    );
  }
}

/**
 * Inclui uma reserva ativa para o solicitante informado.
 * Não altera as demais reservas do mesmo produto/lote.
 */
export async function createMaterialReserva({ row, quantidade, solicitante, user }) {
  if (!row?.chave) throw new Error('Linha de estoque inválida.');

  const qtd = Math.round(Number(quantidade) || 0);
  if (qtd <= 0) throw new Error('Informe uma quantidade maior que zero.');

  const solicitanteNome = normalizeSolicitante(solicitante);
  if (!solicitanteNome) throw new Error('Informe o solicitante da reserva.');

  const all = await entities.materialReservas.filter({ chave: row.chave });
  const saldoAtual = Math.round(Number(row.saldoAtual) || 0);
  const bloqueio = Math.round(Number(row.bloqueioPendente) || 0);
  assertWithinStock(sumAtivas(all) + qtd, saldoAtual - bloqueio, row.unidade);

  const { usuarioId, usuarioNome } = reservaActor(user);
  const criado = await rpcCriarMaterialReserva({
    p_chave: row.chave,
    p_cliente_id: toUuidOrNull(row.clienteId),
    p_cliente_nome: row.clienteNome || null,
    p_produto_id: toUuidOrNull(row.produtoId),
    p_produto_codigo: row.codigo === '—' ? '' : row.codigo,
    p_produto_nome: row.produto === '—' ? null : row.produto,
    p_lote: row.lote === '—' ? '' : row.lote,
    p_unidade: row.unidade || 'kg',
    p_quantidade: qtd,
    p_solicitante: solicitanteNome,
    p_usuario_id: usuarioId,
    p_usuario_nome: usuarioNome,
  });
  if (criado.missing) {
    throw new Error(
      'Execute o script 035_t_saida_reserva_saldo.sql no SQL Editor do ChemFlow para reservar com controle de saldo.'
    );
  }
  return { changed: true };
}

/**
 * Altera quantidade e solicitante de uma reserva ativa.
 * Aumento atualiza o mesmo registro. Redução parcial registra a parcela removida.
 * Quantidade 0 marca a reserva como removida.
 */
export async function updateMaterialReservaQuantidade({
  row,
  reservaId,
  novaQuantidade,
  solicitante,
  user,
}) {
  if (!row?.chave) throw new Error('Linha de estoque inválida.');
  if (!reservaId) throw new Error('Reserva não encontrada.');

  const target = Math.max(0, Math.round(Number(novaQuantidade) || 0));
  const solicitanteNome = normalizeSolicitante(solicitante);
  if (target !== 0 && !solicitanteNome) throw new Error('Informe o solicitante da reserva.');
  const all = await entities.materialReservas.filter({ chave: row.chave });
  const reserva = (all || []).find((r) => r.id === reservaId && r.status === 'ativa');
  if (!reserva) throw new Error('Reserva não encontrada.');

  const atual = Math.round(Number(reserva.quantidade) || 0);
  const sameRequester =
    !!solicitanteNome && String(reserva.solicitante || '').trim() === solicitanteNome;
  if (target === atual && sameRequester) return { changed: false, removed: false };

  if (target !== atual) {
    const outras = (all || [])
      .filter((r) => r.status === 'ativa' && r.id !== reservaId)
      .reduce((s, r) => s + (Number(r.quantidade) || 0), 0);
    const saldoAtual = Math.round(Number(row.saldoAtual) || 0);
    const bloqueio = Math.round(Number(row.bloqueioPendente) || 0);
    assertWithinStock(outras + target, saldoAtual - bloqueio, row.unidade);
  }

  const { usuarioId, usuarioNome } = reservaActor(user);
  const ajustada = await rpcAtualizarMaterialReserva({
    p_reserva_id: reservaId,
    p_quantidade: target,
    p_solicitante: solicitanteNome,
    p_usuario_id: usuarioId,
    p_usuario_nome: usuarioNome,
  });
  if (!ajustada.missing) return { changed: true, removed: target === 0 };
  throw new Error(
    'Execute o script 035_t_saida_reserva_saldo.sql no SQL Editor do ChemFlow para ajustar a reserva com controle de saldo.'
  );
}
