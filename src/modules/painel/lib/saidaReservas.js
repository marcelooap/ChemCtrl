import { formatMass, formatVolume } from '@transbordo/lib/format';
import {
  ORIGEM_TRANSBORDO,
  TIPO_EMBALADO,
  clientsMatch,
  isSaidaValidadaNoModulo,
  sameClienteRecord,
} from '@transbordo/lib/saidaOrigem';
import {
  chemflowSupabase,
  isChemFlowConfigured,
} from '@/services/supabase/chemflow';

const SEM_RESERVA_ID = '__sem_reserva__';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function norm(value) {
  const s = String(value ?? '')
    .trim()
    .toUpperCase();
  return s === '—' || s === '-' ? '' : s;
}

function roundQty(value) {
  return Math.round(Number(value) || 0);
}

function normUnidade(value) {
  return String(value || 'kg').trim().toLowerCase() || 'kg';
}

function parseReservaChave(chave) {
  const parts = String(chave || '').split('||');
  if (parts.length < 4) return null;
  const [clientePart, produtoCodigo, lote, ...unidadeParts] = parts;
  return {
    clientePart: String(clientePart || '').trim(),
    produtoCodigo: norm(produtoCodigo),
    lote: norm(lote),
    unidade: normUnidade(unidadeParts.join('||')),
  };
}

function sameClienteReserva(reservaAsCliente, ctxId, ctxNome) {
  if (sameClienteRecord(reservaAsCliente, ctxId, ctxNome)) return true;
  // Grafias curtas vs completas (ex.: "BAKER HUGHES" vs "BAKER HUGHES OIC").
  return clientsMatch(reservaAsCliente?.cliente_nome, ctxNome);
}

/**
 * Match de reserva à chave/lote do item embalado.
 * Prioridade: chave exata → lote+unidade (+ cliente soft) → lote na chave.
 * Não exige produto_codigo idêntico (variantes BB / códigos divergentes).
 * Reservas de vasilhame só batem por chave exata (não entram no soft-match de embalados).
 */
export function reservaMatchesChave(
  reserva,
  chave,
  {
    clienteId = null,
    clienteNome = '',
    produtoId = null,
    produtoNome = '',
    lote = '',
    unidade = '',
  } = {}
) {
  if (!reserva) return false;
  if (chave && reserva.chave === chave) return true;
  // Vasilhame: bloqueia soft-match (lote/cliente) usado só para embalados.
  if (String(reserva.chave || '').startsWith('vasilhame||')) return false;

  const want = chave ? parseReservaChave(chave) : null;
  const have = parseReservaChave(reserva.chave);
  const wantLote = norm(lote) || want?.lote || '';
  const rLote = norm(reserva.lote) || have?.lote || '';
  if (!wantLote || !rLote || rLote !== wantLote) return false;

  const wantUni = normUnidade(unidade || want?.unidade);
  const rUni = normUnidade(reserva.unidade_medida || have?.unidade);
  if (rUni !== wantUni) return false;

  const chaveIsUuid = Boolean(want && UUID_RE.test(want.clientePart));
  const ctxId = clienteId || (chaveIsUuid ? want.clientePart : null);
  const ctxNome =
    clienteNome ||
    (!chaveIsUuid && want?.clientePart ? want.clientePart : '');

  const haveClienteIsUuid = Boolean(have && UUID_RE.test(have.clientePart));
  const reservaAsCliente = {
    cliente_id:
      reserva.cliente_id ||
      (haveClienteIsUuid ? have.clientePart : null),
    cliente_nome:
      reserva.cliente_nome ||
      (!haveClienteIsUuid && have?.clientePart ? have.clientePart : '') ||
      '',
  };

  // Sem cliente na reserva: basta lote+unidade (legado).
  if (!reservaAsCliente.cliente_id && !String(reservaAsCliente.cliente_nome || '').trim()) {
    return true;
  }
  if (!ctxId && !String(ctxNome || '').trim()) return true;

  if (sameClienteReserva(reservaAsCliente, ctxId, ctxNome)) return true;

  // Último recurso: mesmo produto_id/nome + mesmo lote (cliente só na chave).
  if (
    produtoId &&
    reserva.produto_id &&
    String(produtoId) === String(reserva.produto_id)
  ) {
    return true;
  }
  if (
    produtoNome &&
    reserva.produto_nome &&
    norm(produtoNome) === norm(reserva.produto_nome)
  ) {
    return true;
  }
  return false;
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

export function sumBloqueioPendenteChave(
  saidas,
  chave,
  { excludeSaidaId, clienteId = null, clienteNome = '' } = {}
) {
  if (!chave) return 0;
  const parsedKey = parseReservaChave(chave);
  let total = 0;
  for (const saida of saidas || []) {
    if (!saida || !isSaidaPendenteBaixa(saida)) continue;
    if (excludeSaidaId && String(saida.id) === String(excludeSaidaId)) continue;
    for (const item of saida.itens || []) {
      const itemChave = chaveReservaItem(saida, item);
      let sameChave = itemChave === chave;
      if (!sameChave && parsedKey && itemChave) {
        const parsedItem = parseReservaChave(itemChave);
        if (
          parsedItem &&
          parsedItem.produtoCodigo === parsedKey.produtoCodigo &&
          parsedItem.lote === parsedKey.lote &&
          parsedItem.unidade === parsedKey.unidade
        ) {
          // Cliente duplicado: compara a saída (tem nome) com o contexto do lote.
          sameChave = sameClienteRecord(
            saida,
            clienteId ||
              (UUID_RE.test(parsedKey.clientePart) ? parsedKey.clientePart : null),
            clienteNome ||
              (!UUID_RE.test(parsedKey.clientePart) ? parsedKey.clientePart : '')
          );
        }
      }
      if (!sameChave) continue;
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
  lote = '',
  excludeSaidaId = null,
  reservaIdAtual = '',
  clienteId = null,
  clienteNome = '',
  produtoId = null,
  produtoNome = '',
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

  const matchCtx = {
    clienteId,
    clienteNome,
    produtoId,
    produtoNome,
    lote: lote || parseReservaChave(chave)?.lote || '',
    unidade,
  };
  const ativas = (reservas || []).filter(
    (r) =>
      r &&
      r.status === 'ativa' &&
      reservaMatchesChave(r, chave, matchCtx)
  );

  for (const reserva of ativas) {
    const disponivel = saldoDisponivelReserva(reserva, saidas, itens, index, excludeSaidaId);
    const selecionada = reservaIdAtual && String(reserva.id) === String(reservaIdAtual);
    // Mantém na lista mesmo com saldo 0 (ex.: comprometida em outra saída),
    // para o usuário ver a reserva do lote em vez de só "Sem reserva".
    if (disponivel <= 0 && !selecionada && !(Number(reserva.quantidade) > 0)) continue;
    const solicitante = String(reserva.solicitante || reserva.cliente_nome || 'Reserva').trim();
    const uni = String(reserva.unidade_medida || unidade || 'kg').trim();
    const qtd = selecionada ? Math.max(disponivel, 0) : Math.max(disponivel, 0);
    options.push({
      id: reserva.id,
      semReserva: false,
      solicitante,
      disponivel: qtd,
      unidade: uni,
      label: `${solicitante} - ${formatQtyReserva(qtd, uni)} ${uni}`,
      disabled: qtd <= 0 && !selecionada,
    });
  }

  return options;
}

export function reservadoAtivoChave(
  reservas,
  chave,
  {
    clienteId = null,
    clienteNome = '',
    produtoId = null,
    produtoNome = '',
    lote = '',
    unidade = '',
  } = {}
) {
  const matchCtx = {
    clienteId,
    clienteNome,
    produtoId,
    produtoNome,
    lote: lote || parseReservaChave(chave)?.lote || '',
    unidade,
  };
  return roundQty(
    (reservas || []).reduce((sum, r) => {
      if (!r || r.status !== 'ativa') return sum;
      if (!reservaMatchesChave(r, chave, matchCtx)) return sum;
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
        throw new Error(`Item ${index + 1}: a reserva selecionada não está mais ativa.`);
      }
      const usado = acumuladoReserva.get(reserva.id) || 0;
      const disp =
        saldoDisponivelReserva(reserva, saidas, [], -1, excludeSaidaId) - usado;
      if (qtd > disp) {
        const nome = reserva.solicitante || reserva.cliente_nome || 'reserva';
        throw new Error(
          `Item ${index + 1}: a quantidade solicitada excede o saldo da reserva ${nome} (${formatQtyReserva(Math.max(disp, 0), unidade)}).`
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
        // Mesma regra da agregação de lotes: preferir cliente da entrada,
        // com fallback para o cliente selecionado no formulário.
        const eChave = buildChave?.({
          clienteId: e.cliente_id ?? clienteId,
          clienteNome: e.cliente_nome ?? clienteNome,
          produtoCodigo: e.produto_codigo,
          lote: e.lote,
          unidade: e.unidade_medida || unidade,
        });
        if (eChave !== chave) return sum;
        return sum + (Number(e.saldo_atual) || 0);
      }, 0)
    );
    const reservado = reservadoAtivoChave(reservas, chave, {
      clienteId,
      clienteNome,
    });
    const bloqueio = sumBloqueioPendenteChave(saidas, chave, {
      excludeSaidaId,
      clienteId,
      clienteNome,
    });
    const usado = acumuladoExc.get(chave) || 0;
    const disp = saldoExcepcionalDisponivel({
      saldoFisico: fisico,
      reservadoAtivo: reservado,
      bloqueioPendente: bloqueio,
    }) - usado;
    if (qtd > disp) {
      throw new Error(
        `Item ${index + 1}: a quantidade solicitada excede o saldo disponível para saída sem reserva (${formatQtyReserva(Math.max(disp, 0), unidade)}).`
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
  'Execute o script 063_t_assert_saida_reservas_cliente_chave.sql no SQL Editor do ChemFlow para garantir o saldo de reservas com usuários simultâneos.';

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
