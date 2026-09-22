import { formatMass, formatVolume } from '@transbordo/lib/format';
import {
  ORIGEM_TRANSBORDO,
  TIPO_EMBALADO,
  isSaidaValidadaNoModulo,
} from '@transbordo/lib/saidaOrigem';
import {
  chemflowSupabase,
  isChemFlowConfigured,
} from '@/services/supabase/chemflow';

const SEM_RESERVA_ID = '__sem_reserva__';

function norm(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

function roundQty(value) {
  return Math.round(Number(value) || 0);
}

export function isVolumeUnit(unidade) {
  const u = String(unidade || 'kg').toLowerCase();
  return u === 'l' || u === 'lt' || u === 'litro' || u === 'litros' || u === 'gal';
}

export function formatQtyReserva(value, unidade) {
  if (isVolumeUnit(unidade)) return formatVolume(value, { empty: '0' });
  return formatMass(value, { empty: '0' });
}

/** Saída ainda não baixada no Transbordo (estoque físico intacto). */
export function isSaidaPendenteBaixa(saida) {
  return !isSaidaValidadaNoModulo(saida, ORIGEM_TRANSBORDO);
}

export function chaveReservaItem(saida, item) {
  if (item?.reserva_chave) return String(item.reserva_chave);
  const cliente = saida?.cliente_id || norm(saida?.cliente_nome) || '';
  const unidade = String(item?.unidade || 'kg').trim();
  return [cliente, norm(item?.produto_codigo), norm(item?.lote), unidade].join('||');
}

export function quantidadeEfetivaItem(item) {
  const raw = item?.quantidade_carregada;
  if (raw != null && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return Number(item?.quantidade_solicitada) || 0;
}

export function sumBloqueioPendenteChave(saidas, chave, { excludeSaidaId } = {}) {
  if (!chave) return 0;
  let total = 0;
  for (const saida of saidas || []) {
    if (!saida || !isSaidaPendenteBaixa(saida)) continue;
    if (excludeSaidaId && String(saida.id) === String(excludeSaidaId)) continue;
    for (const item of saida.itens || []) {
      if (chaveReservaItem(saida, item) !== chave) continue;
      if (item?.sem_reserva === true || item?.reserva_abatida) {
        total += item.reserva_abatida
          ? Number(item.quantidade_abatida ?? item.quantidade_carregada) || 0
          : quantidadeEfetivaItem(item);
      }
    }
  }
  return roundQty(total);
}

export function sumComprometidoReserva(saidas, reservaId, { excludeSaidaId } = {}) {
  if (!reservaId) return 0;
  let total = 0;
  for (const saida of saidas || []) {
    if (!isSaidaPendenteBaixa(saida)) continue;
    if (excludeSaidaId && String(saida.id) === String(excludeSaidaId)) continue;
    for (const item of saida.itens || []) {
      if (item?.tipo !== TIPO_EMBALADO) continue;
      if (String(item.reserva_id || '') !== String(reservaId)) continue;
      if (item.reserva_abatida) continue;
      total += Number(item.quantidade_solicitada) || 0;
    }
  }
  return roundQty(total);
}

function sumNoFormulario(itens, reservaId, index) {
  return roundQty(
    (itens || []).reduce((sum, item, i) => {
      if (i === index) return sum;
      if (String(item?.reserva_id || '') !== String(reservaId)) return sum;
      if (item.reserva_abatida) return sum;
      return sum + (Number(item.quantidade_solicitada) || 0);
    }, 0)
  );
}

export function saldoDisponivelReserva(reserva, saidas, itens, index, excludeSaidaId) {
  const base = roundQty(reserva?.quantidade);
  const committed =
    sumComprometidoReserva(saidas, reserva?.id, { excludeSaidaId }) +
    sumNoFormulario(itens, reserva?.id, index);
  return Math.max(0, base - committed);
}

export function saldoExcepcionalDisponivel({
  saldoFisico,
  reservadoAtivo,
  bloqueioPendente,
}) {
  return Math.max(
    0,
    roundQty(saldoFisico) - roundQty(reservadoAtivo) - roundQty(bloqueioPendente)
  );
}

export function opcoesReservaEmbalado({
  reservas = [],
  saidas = [],
  itens = [],
  index = 0,
  chave,
  unidade = 'kg',
  excludeSaidaId = null,
  reservaIdAtual = '',
}) {
  const options = [
    {
      id: SEM_RESERVA_ID,
      semReserva: true,
      solicitante: '',
      disponivel: null,
      label: 'Sem reserva',
    },
  ];

  const ativas = (reservas || []).filter(
    (r) => r && r.status === 'ativa' && r.chave === chave && !String(r.chave || '').startsWith('vasilhame||')
  );

  for (const reserva of ativas) {
    const disponivel = saldoDisponivelReserva(reserva, saidas, itens, index, excludeSaidaId);
    const selecionada = reservaIdAtual && String(reserva.id) === String(reservaIdAtual);
    if (disponivel <= 0 && !selecionada) continue;
    const solicitante = String(reserva.solicitante || reserva.cliente_nome || 'Reserva').trim();
    const uni = String(reserva.unidade_medida || unidade || 'kg').trim();
    const qtd = selecionada ? Math.max(disponivel, 0) : disponivel;
    options.push({
      id: reserva.id,
      semReserva: false,
      solicitante,
      disponivel: qtd,
      unidade: uni,
      label: `${solicitante} - ${formatQtyReserva(qtd, uni)} ${uni}`,
    });
  }

  return options;
}

export function reservadoAtivoChave(reservas, chave) {
  return roundQty(
    (reservas || []).reduce((sum, r) => {
      if (!r || r.status !== 'ativa' || r.chave !== chave) return sum;
      if (String(r.chave || '').startsWith('vasilhame||')) return sum;
      return sum + (Number(r.quantidade) || 0);
    }, 0)
  );
}

/** Outras linhas do mesmo formulário marcadas como saída sem reserva da mesma chave. */
export function sumExcepcionalNoForm(itens, index, chave) {
  return roundQty(
    (itens || []).reduce((sum, item, i) => {
      if (i === index || item?.tipo !== TIPO_EMBALADO) return sum;
      if (item.reserva_id && item.sem_reserva !== true) return sum;
      if (item.sem_reserva !== true) return sum;
      if (!chave || item.reserva_chave !== chave) return sum;
      return sum + (Number(item.quantidade_solicitada) || 0);
    }, 0)
  );
}

/**
 * Valida itens embalados no cliente, antes do RPC.
 * Lança Error com mensagem para o formulário.
 */
export function validarItensEmbalado({
  itens = [],
  reservas = [],
  saidas = [],
  entradas = [],
  clienteId,
  clienteNome,
  excludeSaidaId,
  buildChave,
}) {
  const acumuladoReserva = new Map();
  const acumuladoExc = new Map();

  itens.forEach((item, index) => {
    if (item?.tipo !== TIPO_EMBALADO || item.reserva_abatida) return;
    const qtd = roundQty(item.quantidade_solicitada);
    if (qtd <= 0) return;
    const entrada = (entradas || []).find((e) => e.id === item.entrada_id);
    const unidade = item.unidade || entrada?.unidade_medida || 'kg';
    const chave =
      item.reserva_chave ||
      buildChave?.({
        clienteId,
        clienteNome,
        produtoCodigo: item.produto_codigo,
        lote: item.lote,
        unidade,
      });
    if (!chave) return;

    if (item.reserva_id && item.sem_reserva !== true) {
      const reserva = (reservas || []).find((r) => r.id === item.reserva_id && r.status === 'ativa');
      if (!reserva) {
        throw new Error(`Produto ${index + 1}: a reserva selecionada não está mais ativa.`);
      }
      const usado = acumuladoReserva.get(reserva.id) || 0;
      const disp =
        saldoDisponivelReserva(reserva, saidas, [], -1, excludeSaidaId) - usado;
      if (qtd > disp) {
        const nome = reserva.solicitante || reserva.cliente_nome || 'reserva';
        throw new Error(
          `Produto ${index + 1}: a quantidade solicitada excede o saldo da reserva ${nome} (${formatQtyReserva(Math.max(disp, 0), unidade)}).`
        );
      }
      acumuladoReserva.set(reserva.id, usado + qtd);
      return;
    }

    const fisico = roundQty(
      (entradas || []).reduce((sum, e) => {
        const tipo = e.tipo_recebimento || e.lotes?.[0]?.tipo_recebimento;
        const embalado = tipo
          ? tipo === 'embalado'
          : Boolean(e.embalado || e.lotes?.[0]?.embalado);
        if (!embalado) return sum;
        const eChave = buildChave?.({
          clienteId: e.cliente_id,
          clienteNome: e.cliente_nome,
          produtoCodigo: e.produto_codigo,
          lote: e.lote,
          unidade: e.unidade_medida || unidade,
        });
        if (eChave !== chave) return sum;
        return sum + (Number(e.saldo_atual) || 0);
      }, 0)
    );
    const reservado = reservadoAtivoChave(reservas, chave);
    const bloqueio = sumBloqueioPendenteChave(saidas, chave, { excludeSaidaId });
    const usado = acumuladoExc.get(chave) || 0;
    const disp = saldoExcepcionalDisponivel({
      saldoFisico: fisico,
      reservadoAtivo: reservado,
      bloqueioPendente: bloqueio,
    }) - usado;
    if (qtd > disp) {
      throw new Error(
        `Produto ${index + 1}: a quantidade solicitada excede o saldo disponível para saída sem reserva (${formatQtyReserva(Math.max(disp, 0), unidade)}).`
      );
    }
    acumuladoExc.set(chave, usado + qtd);
  });
}

export function isMissingRpcError(error) {
  const message = String(error?.message || error || '');
  return (
    error?.code === 'PGRST202' ||
    /could not find the function/i.test(message) ||
    /schema cache/i.test(message) ||
    /function .* does not exist/i.test(message)
  );
}

const RPC_SETUP_MESSAGE =
  'Execute o script 035_t_saida_reserva_saldo.sql no SQL Editor do ChemFlow para garantir o saldo de reservas com usuários simultâneos.';

async function callRpc(fn, args, { required = false } = {}) {
  if (!isChemFlowConfigured || !chemflowSupabase) {
    if (required) throw new Error(RPC_SETUP_MESSAGE);
    return { missing: true, data: null };
  }
  const { data, error } = await chemflowSupabase.rpc(fn, args);
  if (!error) return { missing: false, data };
  if (isMissingRpcError(error)) {
    if (required) throw new Error(RPC_SETUP_MESSAGE);
    return { missing: true, data: null };
  }
  throw new Error(error.message || 'Não foi possível validar o saldo da reserva.');
}

export async function rpcCriarMaterialReserva(args) {
  return callRpc('t_criar_material_reserva', args, { required: false });
}

export async function rpcAtualizarMaterialReserva(args) {
  return callRpc('t_atualizar_material_reserva', args, { required: false });
}

export async function rpcSalvarSaidaComReserva(args) {
  return callRpc('t_salvar_saida_com_reserva', args, { required: false });
}

export async function rpcAbaterReservasSaida(saidaId, qtds, origem = 'carregamento') {
  return callRpc(
    't_abater_reservas_saida',
    { p_saida_id: saidaId, p_qtds: qtds || null, p_origem: origem },
    { required: true }
  );
}

export async function rpcEstornarReservasSaida(saidaId, origem = 'carregamento') {
  return callRpc(
    't_estornar_reservas_saida',
    { p_saida_id: saidaId, p_origem: origem },
    { required: true }
  );
}

export function saidaTemControleReserva(saida) {
  return (saida?.itens || []).some(
    (item) =>
      item?.tipo === TIPO_EMBALADO &&
      (item.reserva_id || item.sem_reserva === true || item.reserva_abatida)
  );
}

export { SEM_RESERVA_ID };
