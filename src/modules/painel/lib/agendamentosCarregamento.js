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

/** weekday: 1 = segunda … 5 = sexta */
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
  return [0, 1, 2, 3, 4].map((i) => {
    const date = addDays(weekStart, i);
    return {
      date,
      iso: toISODate(date),
      weekday: i + 1,
    };
  });
}

/** Dia útil atual; no fim de semana, próxima segunda. */
export function getDefaultSelectedDate(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  if (day >= 1 && day <= 5) return toISODate(d);
  const monday = startOfWeekMonday(d);
  return toISODate(addDays(monday, 7));
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

export async function listAgendamentosByRange(fromIso, toIso) {
  assertConfigured('t_agendamentos_carregamento.listRange');
  const { data, error } = await chemflowSupabase
    .from('t_agendamentos_carregamento')
    .select('*')
    .eq('status', 'agendado')
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

/** Agrupa os agendamentos ativos por horário. Valor: array de linhas. */
export function indexAgendamentosBySlot(agendamentos = []) {
  const map = new Map();
  for (const row of agendamentos) {
    if (!row || row.status !== 'agendado') continue;
    const key = slotKey(row.data, row.horario);
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return map;
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

export function findAgendamentoBySaida(agendamentos = [], saidaId) {
  if (!saidaId) return null;
  return (
    agendamentos.find(
      (row) => row.status === 'agendado' && String(row.saida_id) === String(saidaId)
    ) || null
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
 */
export async function bookSlotSaidas({
  dateIso,
  horario,
  tipo,
  saidas = [],
  user,
  observacao = '',
  t,
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
  const noSlot = (ativos || []).filter(
    (row) => String(row.data).slice(0, 10) === dateIso && row.horario === horario
  );
  const selectedIds = new Set(selected.map((s) => String(s.id)));
  const existingBySaida = new Map(
    noSlot.map((row) => [String(row.saida_id), row])
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

  const transporte = {
    transportadora: noSlot[0]?.transportadora || null,
    motorista: noSlot[0]?.motorista || null,
    placa: noSlot[0]?.placa || null,
  };

  try {
    for (const row of noSlot) {
      if (!selectedIds.has(String(row.saida_id))) {
        await entities.agendamentosCarregamento.update(row.id, { status: 'cancelado' });
      }
    }

    for (const saida of selected) {
      if (existingBySaida.has(String(saida.id))) continue;
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

  if (!transportadoraNorm) {
    throw new Error(
      t?.('painel.comercial.agendamentos.errors.transportadora') || 'Informe a transportadora.'
    );
  }
  if (!motoristaNorm) {
    throw new Error(t?.('painel.comercial.agendamentos.errors.motorista') || 'Informe o motorista.');
  }
  if (!placaNorm) {
    throw new Error(t?.('painel.comercial.agendamentos.errors.placa') || 'Informe a placa.');
  }

  const patch = {
    transportadora: transportadoraNorm,
    motorista: motoristaNorm,
    placa: placaNorm,
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
 * Conclui o carregamento do(s) agendamento(s) do horário.
 * Libera o slot na grade (status deixa de ser 'agendado').
 */
export async function concluirCarregamento({ bookings, horaCarregamento, user, t }) {
  const list = normalizeBookings(bookings);
  const ids = list.map((row) => row.id).filter(Boolean);
  if (ids.length === 0) throw new Error('Agendamento inválido.');

  const hora = normalizeHoraHHMM(horaCarregamento);
  if (!hora) {
    throw new Error(
      t?.('painel.comercial.agendamentos.errors.horaCarregamento') ||
        'Informe um horário de carregamento válido.'
    );
  }

  const grupoId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : null;

  const patch = {
    status: 'concluido',
    hora_carregamento: hora,
    operador_conclusao_id: toUserIdText(user?.id),
    operador_conclusao_nome:
      user?.nome || user?.full_name || user?.username || user?.email || '—',
    ...(grupoId ? { grupo_conclusao_id: grupoId } : {}),
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
 * Janela do slot: horário agendado até +29 min (ex.: 08:30 → 08:30–08:59).
 * Antes ou dentro da janela = dentro; após = fora.
 * Encaixe não tem janela fixa → considerado dentro.
 */
export function getStatusPontualidade(horarioAgendado, horaCarregamento) {
  if (!horaCarregamento) return 'fora';
  if (horarioAgendado === ENCAIXE_HORARIO) return 'dentro';
  const start = timeToMinutes(horarioAgendado);
  if (!Number.isFinite(start)) return 'fora';
  const windowEnd = start + 29;
  const actual = timeToMinutes(horaCarregamento);
  if (!Number.isFinite(actual)) return 'fora';
  return actual <= windowEnd ? 'dentro' : 'fora';
}

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
    }
  }

  const rows = [...groups.values()].map((group) => ({
    ...group,
    codesLabel: saidasCodigosLabel(group.bookings),
    clientesLabel: clientesLabelFromBookings(group.bookings),
    pontualidade: getStatusPontualidade(group.horario, group.hora_carregamento),
  }));

  rows.sort((a, b) => {
    const dataCmp = String(b.data).localeCompare(String(a.data));
    if (dataCmp !== 0) return dataCmp;
    const ha = timeToMinutes(a.hora_carregamento || '00:00');
    const hb = timeToMinutes(b.hora_carregamento || '00:00');
    return hb - ha;
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
