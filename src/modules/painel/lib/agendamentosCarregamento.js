import {
  chemflowSupabase,
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';
import { entities } from '@transbordo/services/entities';

export const ENCAIXE_HORARIO = 'encaixe';
export const SLOT_STEP_MINUTES = 30;
export const MORNING_START = '07:30';
export const MORNING_END = '11:30';
export const LUNCH_START = '12:00';
export const LUNCH_END = '13:00';
export const AFTERNOON_START = '13:00';
export const AFTERNOON_END_MON_THU = '16:30';
export const AFTERNOON_END_FRI = '15:30';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertConfigured(context) {
  if (!isChemFlowConfigured || !chemflowSupabase) {
    throw new Error(`[ChemFlow:${context}] ${CHEMFLOW_CONFIG_ERROR}`);
  }
}

function toUuidOrNull(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return UUID_RE.test(s) ? s : null;
}

function toUserIdText(value) {
  if (value == null || value === '') return null;
  return String(value).trim() || null;
}

export function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function buildTimeRange(start, end, step = SLOT_STEP_MINUTES) {
  const times = [];
  for (let t = timeToMinutes(start); t <= timeToMinutes(end); t += step) {
    times.push(minutesToTime(t));
  }
  return times;
}

/** Semana operacional: segunda (1) a sábado (6). */
export const WEEKDAY_COUNT = 6;

/** weekday: 1 = segunda … 6 = sábado; sexta fecha 15:30. */
export function getAfternoonEnd(weekday) {
  return weekday === 5 ? AFTERNOON_END_FRI : AFTERNOON_END_MON_THU;
}

export function getSlotsForWeekday(weekday) {
  return {
    morning: buildTimeRange(MORNING_START, MORNING_END),
    afternoon: buildTimeRange(AFTERNOON_START, getAfternoonEnd(weekday)),
    lunch: { start: LUNCH_START, end: LUNCH_END },
  };
}

export function startOfWeekMonday(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isSameISODate(a, b) {
  return String(a) === String(b);
}

export function getWeekDays(weekStart) {
  return Array.from({ length: WEEKDAY_COUNT }, (_, i) => {
    const date = addDays(weekStart, i);
    return {
      date,
      iso: toISODate(date),
      weekday: i + 1,
    };
  });
}

/** Dia operacional atual (seg–sáb); no domingo, próxima segunda. */
export function getDefaultSelectedDate(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  if (day >= 1 && day <= 6) return toISODate(d);
  const monday = startOfWeekMonday(d);
  return toISODate(addDays(monday, 7));
}

/**
 * Data da grade a partir da saída (prioriza data programada).
 * Domingo cai na segunda seguinte (fora da semana operacional).
 */
export function resolveScheduleDateFromSaida(saida) {
  const raw = String(saida?.data_programada || saida?.data_solicitacao || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = parseISODate(raw);
  if (Number.isNaN(date.getTime())) return null;
  const adjusted = date.getDay() === 0 ? addDays(date, 1) : date;
  return {
    iso: toISODate(adjusted),
    weekStart: startOfWeekMonday(adjusted),
  };
}

export function todayISO(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return toISODate(d);
}

export function produtosLabel(saida) {
  const itens = saida?.itens || [];
  const distinct = new Map();
  for (const item of itens) {
    const key = item.produto_id || item.produto_nome;
    if (!key) continue;
    if (!distinct.has(key)) {
      distinct.set(key, item.produto_nome || '—');
    }
  }
  const count = distinct.size;
  if (count === 0) return '—';
  if (count === 1) return [...distinct.values()][0];
  return `${String(count).padStart(2, '0')} produtos`;
}

/** Agendados e concluídos — a grade mantém o horário preenchido após o carregamento. */
export async function listAgendamentosByRange(fromIso, toIso) {
  assertConfigured('t_agendamentos_carregamento.listRange');
  const { data, error } = await chemflowSupabase
    .from('t_agendamentos_carregamento')
    .select('*')
    .in('status', ['agendado', 'concluido'])
    .gte('data', fromIso)
    .lte('data', toIso)
    .order('data', { ascending: true })
    .order('horario', { ascending: true });

  if (error) {
    throw new Error(
      `[ChemFlow:t_agendamentos_carregamento.listRange] ${error.message || 'Erro desconhecido'}`
    );
  }
  return data || [];
}

export function slotKey(data, horario) {
  return `${String(data).slice(0, 10)}|${horario}`;
}

/** Agrupa agendamentos (ativos e concluídos) por horário. Valor: array de linhas. */
export function indexAgendamentosBySlot(agendamentos = []) {
  const map = new Map();
  for (const row of agendamentos) {
    if (!row || (row.status !== 'agendado' && row.status !== 'concluido')) continue;
    const key = slotKey(row.data, row.horario);
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

/** Slot já confirmado pela logística (carregamento concluído). */
export function isCarregado(bookings) {
  const list = normalizeBookings(bookings);
  if (list.length === 0) return false;
  return list.every((row) => row.status === 'concluido');
}

/** Checklist preenchido e validado para todas as linhas do carregamento. */
export function isChecklistValidado(bookings) {
  const list = normalizeBookings(bookings);
  if (list.length === 0) return false;
  return list.every((row) => Boolean(row.checklist_validado_em));
}

/**
 * Progresso parcial do checklist por item (não marca como validado
 * a menos que todos os itens estejam aprovados).
 */
export async function saveCarregamentoChecklistProgress({
  bookings,
  payload,
  user,
  t,
  markValidated = false,
}) {
  const list = normalizeBookings(bookings);
  const ids = list.map((row) => row.id).filter(Boolean);
  if (ids.length === 0) throw new Error('Agendamento inválido.');

  if (!payload || typeof payload !== 'object') {
    throw new Error(
      t?.('painel.comercial.agendamentos.checklist.submitError') ||
        'Não foi possível salvar o checklist.'
    );
  }

  const allApproved =
    markValidated ||
    (Array.isArray(payload.items) &&
      payload.items.length > 0 &&
      payload.items.every((it) => it.status === 'aprovado'));

  const patch = {
    checklist_respostas: payload,
    checklist_operador_id: toUserIdText(user?.id),
    checklist_operador_nome:
      user?.nome || user?.full_name || user?.username || user?.email || '—',
  };

  if (allApproved) {
    patch.checklist_validado_em = new Date().toISOString();
  } else {
    patch.checklist_validado_em = null;
  }

  await Promise.all(ids.map((id) => entities.agendamentosCarregamento.update(id, patch)));
  return { validated: allApproved };
}

export function normalizeBookings(bookings) {
  if (!bookings) return [];
  return Array.isArray(bookings) ? bookings.filter(Boolean) : [bookings];
}

export function summarizeSlotBookings(bookings) {
  const list = normalizeBookings(bookings);
  const codes = [
    ...new Set(list.map((b) => b.saida_codigo).filter(Boolean)),
  ];
  const clientes = [
    ...new Set(list.map((b) => b.cliente_nome).filter(Boolean)),
  ];
  const first = list[0] || null;
  return {
    bookings: list,
    count: list.length,
    codes,
    clientes,
    codesLabel: codes.join(', ') || '—',
    clientesLabel: clientes.join(', ') || '—',
    first,
    transportadora: first?.transportadora || null,
    motorista: first?.motorista || null,
    placa: first?.placa || null,
  };
}

function clienteGroupKey(row) {
  if (row?.cliente_id) return `id:${row.cliente_id}`;
  const nome = String(row?.cliente_nome || '')
    .trim()
    .toLowerCase();
  if (nome) return `nome:${nome}`;
  return `saida:${row?.saida_id || row?.id || '—'}`;
}

/**
 * No Encaixe, cada cliente vira um carregamento independente.
 * Horários regulares permanecem um único grupo por slot.
 */
export function groupSlotCarregamentos(bookings = [], { splitByCliente = false } = {}) {
  const list = normalizeBookings(bookings);
  if (list.length === 0) return [];
  if (!splitByCliente) {
    return [
      {
        key: 'all',
        bookings: list,
        summary: summarizeSlotBookings(list),
      },
    ];
  }

  const map = new Map();
  for (const row of list) {
    const key = clienteGroupKey(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.entries()].map(([key, groupBookings]) => ({
    key,
    bookings: groupBookings,
    summary: summarizeSlotBookings(groupBookings),
  }));
}

export function findAgendamentoBySaida(agendamentos = [], saidaId) {
  if (!saidaId) return null;
  return (
    agendamentos.find(
      (row) => row.status === 'agendado' && String(row.saida_id) === String(saidaId)
    ) || null
  );
}

/** Agendamento ativo ou concluído (para exibição em listagens). */
export function findAgendamentoDisplayBySaida(agendamentos = [], saidaId) {
  if (!saidaId) return null;
  const matches = (agendamentos || []).filter(
    (row) =>
      String(row.saida_id) === String(saidaId) &&
      row.status !== 'cancelado'
  );
  return (
    matches.find((row) => row.status === 'agendado') ||
    matches.find((row) => row.status === 'concluido') ||
    matches[0] ||
    null
  );
}

function bookingPayload({ dateIso, horario, tipo, saida, user, observacao }) {
  return {
    data: dateIso,
    horario,
    tipo: tipo === 'encaixe' ? 'encaixe' : 'regular',
    saida_id: toUuidOrNull(saida?.id),
    saida_codigo: saida?.codigo || null,
    cliente_id: toUuidOrNull(saida?.cliente_id),
    cliente_nome: saida?.cliente_nome || null,
    status: 'agendado',
    usuario_id: toUserIdText(user?.id),
    usuario_nome: user?.nome || user?.full_name || user?.username || user?.email || '—',
    observacao: observacao || null,
  };
}

function isUniqueViolation(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('duplicate') || msg.includes('unique') || msg.includes('uq_t_agendamentos');
}

/**
 * Sincroniza as saídas de um horário (permite várias no mesmo slot).
 * Cada saída permanece exclusiva de um único horário ativo.
 *
 * `scopeSaidaIds`:
 * - `null` (padrão): sincroniza o horário inteiro (horários regulares).
 * - `Set`: no Encaixe, edita só esse carregamento e preserva os demais clientes.
 * - `Set` vazio: adiciona um novo carregamento sem alterar os já agendados.
 */
export async function bookSlotSaidas({
  dateIso,
  horario,
  tipo,
  saidas = [],
  user,
  observacao = '',
  t,
  scopeSaidaIds = null,
}) {
  if (!dateIso || !horario) throw new Error('Horário inválido.');
  const selected = (saidas || []).filter((s) => s?.id);
  if (selected.length === 0) {
    throw new Error(
      t?.('painel.comercial.agendamentos.errors.selectSaida') ||
        'Selecione ao menos uma saída.'
    );
  }

  const ativos = await entities.agendamentosCarregamento.filter({ status: 'agendado' });
  const concluidosNoSlot = (
    (await entities.agendamentosCarregamento.filter({
      status: 'concluido',
      data: dateIso,
      horario,
    })) || []
  ).filter((row) => String(row.data).slice(0, 10) === dateIso && row.horario === horario);

  // Horário regular já carregado permanece ocupado (não reagenda).
  // No Encaixe, outros clientes podem continuar sendo adicionados.
  if (!(scopeSaidaIds instanceof Set) && concluidosNoSlot.length > 0) {
    throw new Error(
      t?.('painel.comercial.agendamentos.errors.slotCarregado') ||
        'Este horário já foi carregado e não pode ser reagendado.'
    );
  }

  const noSlot = (ativos || []).filter(
    (row) => String(row.data).slice(0, 10) === dateIso && row.horario === horario
  );
  const selectedIds = new Set(selected.map((s) => String(s.id)));
  const scoped =
    scopeSaidaIds instanceof Set
      ? noSlot.filter((row) => scopeSaidaIds.has(String(row.saida_id)))
      : noSlot;
  const existingBySaida = new Map(
    scoped.map((row) => [String(row.saida_id), row])
  );

  for (const saida of selected) {
    const other = (ativos || []).find(
      (row) =>
        String(row.saida_id) === String(saida.id) &&
        !(String(row.data).slice(0, 10) === dateIso && row.horario === horario)
    );
    if (other) {
      throw new Error(
        t?.('painel.comercial.agendamentos.errors.saidaAssigned', {
          codigo: saida.codigo || '',
          slot: formatSlotRef(other),
        }) ||
          `A saída ${saida.codigo || ''} já está agendada em ${formatSlotRef(other)}.`
      );
    }
  }

  // Transporte só herda do mesmo carregamento (escopo); no Encaixe novo, começa vazio.
  const transporteSource = scoped[0] || (scopeSaidaIds instanceof Set ? null : noSlot[0]);
  const transporte = {
    transportadora: transporteSource?.transportadora || null,
    motorista: transporteSource?.motorista || null,
    placa: transporteSource?.placa || null,
  };

  try {
    for (const row of scoped) {
      if (!selectedIds.has(String(row.saida_id))) {
        await entities.agendamentosCarregamento.update(row.id, { status: 'cancelado' });
      }
    }

    for (const saida of selected) {
      if (existingBySaida.has(String(saida.id))) continue;
      // Já estava no slot em outro carregamento do Encaixe? Não duplicar.
      const alreadyInSlot = noSlot.find(
        (row) => String(row.saida_id) === String(saida.id)
      );
      if (alreadyInSlot) continue;
      await entities.agendamentosCarregamento.create({
        ...bookingPayload({ dateIso, horario, tipo, saida, user, observacao }),
        ...transporte,
      });
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error(
        t?.('painel.comercial.agendamentos.errors.conflict') ||
          'Este horário ou saída acabou de ser ocupado. Atualize a grade e tente novamente.'
      );
    }
    throw err;
  }
}

export async function releaseSlotBookings(bookings) {
  const list = normalizeBookings(bookings);
  if (list.length === 0) throw new Error('Agendamento inválido.');
  await Promise.all(
    list.map((row) =>
      entities.agendamentosCarregamento.update(row.id, { status: 'cancelado' })
    )
  );
}

export function normalizePlaca(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function hasTransporte(booking) {
  if (!booking) return false;
  return Boolean(
    String(booking.transportadora || '').trim() ||
      String(booking.motorista || '').trim() ||
      String(booking.placa || '').trim()
  );
}

export async function updateTransporte({
  bookings,
  agendamentoId,
  transportadora,
  motorista,
  placa,
  t,
}) {
  const list = normalizeBookings(bookings);
  const ids = list.map((row) => row.id).filter(Boolean);
  if (agendamentoId && !ids.includes(agendamentoId)) ids.push(agendamentoId);
  if (ids.length === 0) throw new Error('Agendamento inválido.');

  const transportadoraNorm = String(transportadora || '').trim();
  const motoristaNorm = String(motorista || '').trim();
  const placaNorm = normalizePlaca(placa);

  // Campos opcionais: permite limpar e salvar vazio para corrigir dados.
  const patch = {
    transportadora: transportadoraNorm || null,
    motorista: motoristaNorm || null,
    placa: placaNorm || null,
  };
  await Promise.all(ids.map((id) => entities.agendamentosCarregamento.update(id, patch)));
}

/** Horário atual em America/Sao_Paulo no formato HH:MM. */
export function nowBrasiliaHHMM(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  // en-GB pode retornar "24" em meia-noite em alguns ambientes
  const h = hour === '24' ? '00' : hour;
  return `${h}:${minute}`;
}

export function normalizeHoraHHMM(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Data YYYY-MM-DD no fuso America/Sao_Paulo.
 */
export function isoDateInBrasilia(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

function combineDateAndTime(isoDate, hhmm) {
  const date = String(isoDate || '').slice(0, 10);
  const time = normalizeHoraHHMM(hhmm);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

/**
 * Conclui o carregamento do(s) agendamento(s) do horário.
 * O horário permanece na grade como "carregado" (status = concluido).
 */
export async function concluirCarregamento({
  bookings,
  horaCarregamento,
  dataCarregamento,
  justificativa,
  user,
  t,
}) {
  const list = normalizeBookings(bookings);
  const ids = list.map((row) => row.id).filter(Boolean);
  if (ids.length === 0) throw new Error('Agendamento inválido.');

  if (!isChecklistValidado(list)) {
    throw new Error(
      t?.('painel.comercial.agendamentos.checklist.concluirBlockedHint') ||
        'Preencha e valide o checklist antes de concluir o carregamento.'
    );
  }

  const hora = normalizeHoraHHMM(horaCarregamento);
  if (!hora) {
    throw new Error(
      t?.('painel.comercial.agendamentos.errors.horaCarregamento') ||
        'Informe um horário de carregamento válido.'
    );
  }

  const dataIso = String(dataCarregamento || list[0]?.data || todayISO()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) {
    throw new Error(
      t?.('painel.comercial.agendamentos.errors.dataCarregamento') ||
        'Informe uma data de carregamento válida.'
    );
  }

  const dataAgendada = String(list[0]?.data || '').slice(0, 10);
  const atrasado = isCarregamentoAtrasado({
    horarioAgendado: list[0]?.horario,
    horaCarregamento: hora,
    dataAgendada,
    dataCarregamento: dataIso,
  });

  if (atrasado) {
    const responsavel = String(justificativa?.responsavel || '').trim();
    const motivo = String(justificativa?.motivo || '').trim();
    const responsavelOk = JUSTIFICATIVA_ATRASO_RESPONSAVEIS.some((o) => o.value === responsavel);
    const motivoOk = JUSTIFICATIVA_ATRASO_MOTIVOS.some((o) => o.value === motivo);
    if (!responsavelOk || !motivoOk) {
      throw new Error(
        t?.('painel.comercial.agendamentos.justificativa.required') ||
          'Informe a justificativa do atraso.'
      );
    }
  }

  const grupoId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : null;

  const patch = {
    status: 'concluido',
    hora_carregamento: hora,
    data_carregamento: dataIso,
    operador_conclusao_id: toUserIdText(user?.id),
    operador_conclusao_nome:
      user?.nome || user?.full_name || user?.username || user?.email || '—',
    justificativa_atraso_responsavel: atrasado
      ? String(justificativa.responsavel).trim()
      : null,
    justificativa_atraso_motivo: atrasado ? String(justificativa.motivo).trim() : null,
    ...(grupoId ? { grupo_conclusao_id: grupoId } : {}),
  };
  await Promise.all(ids.map((id) => entities.agendamentosCarregamento.update(id, patch)));
}

export async function submitCarregamentoChecklist({ bookings, respostas, user, t }) {
  // Aceita payload v2 ({ version, items }) ou array legado
  const payload =
    respostas && typeof respostas === 'object' && !Array.isArray(respostas)
      ? respostas
      : Array.isArray(respostas) && respostas.length > 0
        ? { version: 1, items: [], legacy_answers: respostas }
        : null;

  if (!payload) {
    throw new Error(
      t?.('painel.comercial.agendamentos.checklist.submitError') ||
        'Não foi possível salvar o checklist.'
    );
  }

  return saveCarregamentoChecklistProgress({
    bookings,
    payload,
    user,
    t,
    markValidated: payload.version === 1 || (payload.items || []).every((it) => it.status === 'aprovado'),
  });
}

/**
 * Reverte a expedição: apaga horário/operador de carregamento e volta o slot
 * para "agendado" (card deixa de aparecer como carregado; saída volta a ser editável).
 */
export async function reverterCarregamento({ bookings }) {
  const list = normalizeBookings(bookings);
  const ids = list.map((row) => row.id).filter(Boolean);
  if (ids.length === 0) throw new Error('Agendamento inválido.');

  const patch = {
    status: 'agendado',
    hora_carregamento: null,
    data_carregamento: null,
    operador_conclusao_id: null,
    operador_conclusao_nome: null,
    grupo_conclusao_id: null,
    checklist_respostas: null,
    checklist_validado_em: null,
    checklist_operador_id: null,
    checklist_operador_nome: null,
    justificativa_atraso_responsavel: null,
    justificativa_atraso_motivo: null,
  };
  await Promise.all(ids.map((id) => entities.agendamentosCarregamento.update(id, patch)));
}

export async function listAgendamentosConcluidos() {
  assertConfigured('t_agendamentos_carregamento.listConcluidos');
  const { data, error } = await chemflowSupabase
    .from('t_agendamentos_carregamento')
    .select('*')
    .eq('status', 'concluido')
    .order('data', { ascending: false })
    .order('hora_carregamento', { ascending: false });

  if (error) {
    throw new Error(
      `[ChemFlow:t_agendamentos_carregamento.listConcluidos] ${error.message || 'Erro desconhecido'}`
    );
  }
  return data || [];
}

/**
 * @deprecated Prefer `@transbordo/lib/saidaExpedicao` — reexport para compatibilidade.
 */
export {
  listSaidaIdsExpedidas,
  isSaidaExpedida,
} from '@transbordo/lib/saidaExpedicao';

/**
 * Limite do agendamento = data + horário do slot (+29 min da janela).
 * Carregar antes ou dentro da janela = dentro; depois = fora.
 * Encaixe: sem horário fixo — atraso só pela data (data carregamento > data agendada).
 */
export function getStatusPontualidade(
  horarioAgendado,
  horaCarregamento,
  { dataAgendada, dataCarregamento } = {}
) {
  const dataAgendadaIso = String(dataAgendada || '').slice(0, 10);
  const dataCarregamentoIso = String(dataCarregamento || dataAgendada || '').slice(0, 10);

  if (horarioAgendado === ENCAIXE_HORARIO) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataAgendadaIso) || !/^\d{4}-\d{2}-\d{2}$/.test(dataCarregamentoIso)) {
      return 'dentro';
    }
    return dataCarregamentoIso > dataAgendadaIso ? 'fora' : 'dentro';
  }

  if (!horaCarregamento) return 'fora';

  const scheduledStart = combineDateAndTime(dataAgendadaIso, horarioAgendado);
  const actual = combineDateAndTime(
    dataCarregamentoIso || dataAgendadaIso,
    horaCarregamento
  );

  if (scheduledStart && actual) {
    const windowEnd = new Date(scheduledStart.getTime() + 29 * 60 * 1000);
    return actual.getTime() <= windowEnd.getTime() ? 'dentro' : 'fora';
  }

  const start = timeToMinutes(horarioAgendado);
  if (!Number.isFinite(start)) return 'fora';
  const windowEnd = start + 29;
  const actualMins = timeToMinutes(horaCarregamento);
  if (!Number.isFinite(actualMins)) return 'fora';
  return actualMins <= windowEnd ? 'dentro' : 'fora';
}

/** True quando o carregamento informado está em atraso em relação ao agendamento. */
export function isCarregamentoAtrasado({
  horarioAgendado,
  horaCarregamento,
  dataAgendada,
  dataCarregamento,
} = {}) {
  return (
    getStatusPontualidade(horarioAgendado, horaCarregamento, {
      dataAgendada,
      dataCarregamento,
    }) === 'fora'
  );
}

export const JUSTIFICATIVA_ATRASO_RESPONSAVEIS = [
  { value: 'cliente', labelKey: 'painel.comercial.agendamentos.justificativa.responsaveis.cliente' },
  { value: 'intertank', labelKey: 'painel.comercial.agendamentos.justificativa.responsaveis.intertank' },
];

export const JUSTIFICATIVA_ATRASO_MOTIVOS = [
  { value: 'nota_fiscal', labelKey: 'painel.comercial.agendamentos.justificativa.motivos.notaFiscal' },
  {
    value: 'divergencias_conferencia',
    labelKey: 'painel.comercial.agendamentos.justificativa.motivos.divergencias',
  },
  { value: 'empilhadeira', labelKey: 'painel.comercial.agendamentos.justificativa.motivos.empilhadeira' },
  {
    value: 'aguardando_carreta',
    labelKey: 'painel.comercial.agendamentos.justificativa.motivos.aguardandoCarreta',
  },
];

/** Contagem de produtos distintos: "01 produto", "02 produtos". */
export function produtosCountLabel(saidas = [], t) {
  const distinct = new Map();
  for (const saida of saidas || []) {
    for (const item of saida?.itens || []) {
      const key = item.produto_id || item.produto_nome;
      if (!key) continue;
      if (!distinct.has(key)) distinct.set(key, true);
    }
  }
  const count = distinct.size;
  if (count === 0) return '—';
  const padded = String(count).padStart(2, '0');
  if (count === 1) {
    return t?.('painel.logistica.carregamentos.produtoCountOne', { count: padded }) || `${padded} produto`;
  }
  return (
    t?.('painel.logistica.carregamentos.produtoCountMany', { count: padded }) ||
    `${padded} produtos`
  );
}

export function saidasCodigosLabel(bookings = []) {
  const codes = [
    ...new Set(
      normalizeBookings(bookings)
        .map((b) => b.saida_codigo)
        .filter(Boolean)
    ),
  ];
  if (codes.length === 0) return '—';
  return codes.join(' - ');
}

export function clientesLabelFromBookings(bookings = []) {
  const names = [
    ...new Set(
      normalizeBookings(bookings)
        .map((b) => b.cliente_nome)
        .filter(Boolean)
    ),
  ];
  if (names.length === 0) return '—';
  return names.join(' · ');
}

/**
 * Agrupa linhas concluídas do mesmo carregamento (mesmo grupo / slot + horário).
 * @returns {Array<{ id: string, bookings: object[], data: string, horario: string, hora_carregamento: string, transportadora: string|null, motorista: string|null, placa: string|null, operador_nome: string, pontualidade: 'dentro'|'fora' }>}
 */
export function groupCarregamentosConcluidos(agendamentos = []) {
  const groups = new Map();

  for (const row of agendamentos || []) {
    if (!row || row.status !== 'concluido') continue;
    const data = String(row.data).slice(0, 10);
    const key =
      row.grupo_conclusao_id ||
      `${data}|${row.horario}|${row.hora_carregamento || ''}|${row.transportadora || ''}|${row.motorista || ''}|${row.placa || ''}`;

    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        bookings: [],
        data,
        horario: row.horario,
        hora_carregamento: row.hora_carregamento || null,
        data_carregamento:
          (row.data_carregamento && String(row.data_carregamento).slice(0, 10)) ||
          isoDateInBrasilia(row.updated_at) ||
          data,
        transportadora: row.transportadora || null,
        motorista: row.motorista || null,
        placa: row.placa || null,
        operador_nome: row.operador_conclusao_nome || row.usuario_nome || '—',
        updated_at: row.updated_at || null,
      });
    }
    const group = groups.get(key);
    group.bookings.push(row);
    if (!group.operador_nome || group.operador_nome === '—') {
      group.operador_nome = row.operador_conclusao_nome || row.usuario_nome || '—';
    }
    if (row.updated_at && (!group.updated_at || row.updated_at > group.updated_at)) {
      group.updated_at = row.updated_at;
      if (!row.data_carregamento) {
        group.data_carregamento = isoDateInBrasilia(row.updated_at) || group.data_carregamento;
      }
    }
    if (row.data_carregamento) {
      group.data_carregamento = String(row.data_carregamento).slice(0, 10);
    }
  }

  const rows = [...groups.values()].map((group) => ({
    ...group,
    codesLabel: saidasCodigosLabel(group.bookings),
    clientesLabel: clientesLabelFromBookings(group.bookings),
    pontualidade: getStatusPontualidade(group.horario, group.hora_carregamento, {
      dataAgendada: group.data,
      dataCarregamento: group.data_carregamento,
    }),
  }));

  rows.sort((a, b) => {
    // Mais recente primeiro: data/hora reais do carregamento
    const dataA = String(a.data_carregamento || a.data || '').slice(0, 10);
    const dataB = String(b.data_carregamento || b.data || '').slice(0, 10);
    const dataCmp = dataB.localeCompare(dataA);
    if (dataCmp !== 0) return dataCmp;

    const ha = timeToMinutes(a.hora_carregamento || '00:00');
    const hb = timeToMinutes(b.hora_carregamento || '00:00');
    if (Number.isFinite(hb) && Number.isFinite(ha) && hb !== ha) return hb - ha;

    // Desempate: conclusão mais recente no banco
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  });

  return rows;
}

export function formatSlotRef(row) {
  if (!row) return '—';
  const data = formatDateBR(row.data);
  const hora = row.horario === ENCAIXE_HORARIO ? 'Encaixe' : row.horario;
  return `${data} ${hora}`;
}

export function formatDateBR(iso) {
  if (!iso) return '—';
  const d = parseISODate(iso);
  return d.toLocaleDateString('pt-BR');
}
