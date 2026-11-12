/**
 * Motor de indicadores do Dashboard Painel — visão Logística.
 * Reutiliza as regras oficiais de pontualidade/agrupamento de
 * `@painel/lib/agendamentosCarregamento` (janela de 29 min, grupos concluídos).
 */

import {
  ENCAIXE_HORARIO,
  formatDateBR,
  formatJustificativaAtrasoMotivo,
  formatJustificativaAtrasoResponsavel,
  groupCarregamentosConcluidos,
  normalizeMotivoAtraso,
} from '@painel/lib/agendamentosCarregamento';

const MONTH_SHORT = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

const SLOT_WINDOW_MINUTES = 29;

function parseISODateParts(iso) {
  const s = String(iso || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

function combineDateAndTime(isoDate, hhmm) {
  const date = String(isoDate || '').slice(0, 10);
  const time = String(hhmm || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}/.test(time)) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

function periodKeyOfGroup(group) {
  return String(group?.data_carregamento || group?.data || '').slice(0, 10);
}

function responsavelDoGrupo(group) {
  for (const booking of group?.bookings || []) {
    const value = String(booking?.justificativa_atraso_responsavel || '').trim();
    if (value) return value;
  }
  return '';
}

function motivoDoGrupo(group) {
  for (const booking of group?.bookings || []) {
    const value = String(booking?.justificativa_atraso_motivo || '').trim();
    if (value) return value;
  }
  return '';
}

/**
 * Minutos de atraso vs horário programado (somente quando fora).
 * Encaixe: diferença em dias × 24h quando atrasado por data.
 */
export function getAtrasoMinutes(group) {
  if (!group || group.pontualidade !== 'fora') return 0;

  if (group.horario === ENCAIXE_HORARIO) {
    const agendada = parseISODateParts(group.data);
    const real = parseISODateParts(group.data_carregamento || group.data);
    if (!agendada || !real) return 0;
    const start = Date.UTC(agendada.year, agendada.month, agendada.day);
    const end = Date.UTC(real.year, real.month, real.day);
    const days = Math.max(0, Math.round((end - start) / 86400000));
    return days * 24 * 60;
  }

  const scheduled = combineDateAndTime(group.data, group.horario);
  const actual = combineDateAndTime(
    group.data_carregamento || group.data,
    group.hora_carregamento
  );
  if (!scheduled || !actual) return 0;
  return Math.max(0, Math.round((actual.getTime() - scheduled.getTime()) / 60000));
}

export function formatAtrasoDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m <= 0) return '0 min';
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h <= 0) return `${min} min`;
  if (min <= 0) return `${h} h`;
  return `${h} h ${min} min`;
}

function emptyMonthBuckets() {
  return Array.from({ length: 12 }, (_, monthIndex) => ({
    monthIndex,
    monthLabel: MONTH_SHORT[monthIndex],
    dentro: 0,
    fora: 0,
    total: 0,
    pontualidadePct: 0,
    atrasosIntertank: 0,
    atrasosCliente: 0,
    atrasosNaoInformado: 0,
  }));
}

function pct(part, total) {
  if (!(total > 0)) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function enrichGroup(group) {
  const responsavel = responsavelDoGrupo(group);
  const motivoRaw = motivoDoGrupo(group);
  const atrasoMinutos = getAtrasoMinutes(group);
  return {
    ...group,
    responsavel: responsavel || null,
    responsavelKey: responsavel || 'nao_informado',
    motivoRaw,
    atrasoMinutos,
    atrasoLabel: formatAtrasoDuration(atrasoMinutos),
    periodDate: periodKeyOfGroup(group),
  };
}

function filterGroupsByPeriod(groups, year, month) {
  return groups.filter((g) => {
    const parts = parseISODateParts(g.periodDate);
    if (!parts || parts.year !== year) return false;
    if (month == null || Number.isNaN(Number(month))) return true;
    return parts.month === Number(month);
  });
}

function buildPeriodTotals(groups) {
  let pontuais = 0;
  let atrasados = 0;
  let atrasosIntertank = 0;
  let atrasosCliente = 0;
  let atrasosNaoInformado = 0;
  let minutosAtraso = 0;
  let atrasosComTempo = 0;

  for (const g of groups) {
    if (g.pontualidade === 'dentro') {
      pontuais += 1;
      continue;
    }
    atrasados += 1;
    if (g.responsavel === 'intertank') atrasosIntertank += 1;
    else if (g.responsavel === 'cliente') atrasosCliente += 1;
    else atrasosNaoInformado += 1;

    if (g.atrasoMinutos > 0) {
      minutosAtraso += g.atrasoMinutos;
      atrasosComTempo += 1;
    }
  }

  const total = pontuais + atrasados;
  return {
    total,
    pontuais,
    atrasados,
    atrasosIntertank,
    atrasosCliente,
    atrasosNaoInformado,
    pontualidadePct: pct(pontuais, total),
    atrasoPct: pct(atrasados, total),
    intertankPctOfAtrasos: pct(atrasosIntertank, atrasados),
    clientePctOfAtrasos: pct(atrasosCliente, atrasados),
    naoInformadoPctOfAtrasos: pct(atrasosNaoInformado, atrasados),
    minutosAtrasoTotal: minutosAtraso,
    horasAtrasoTotal: Math.round((minutosAtraso / 60) * 10) / 10,
    mediaMinutosAtraso:
      atrasosComTempo > 0
        ? Math.round(minutosAtraso / atrasosComTempo)
        : 0,
  };
}

function buildMonthlySeries(groups, year) {
  const buckets = emptyMonthBuckets();
  for (const g of groups) {
    const parts = parseISODateParts(g.periodDate);
    if (!parts || parts.year !== year) continue;
    const b = buckets[parts.month];
    if (!b) continue;
    b.total += 1;
    if (g.pontualidade === 'dentro') b.dentro += 1;
    else {
      b.fora += 1;
      if (g.responsavel === 'intertank') b.atrasosIntertank += 1;
      else if (g.responsavel === 'cliente') b.atrasosCliente += 1;
      else b.atrasosNaoInformado += 1;
    }
  }
  return buckets.map((b) => ({
    ...b,
    pontualidadePct: pct(b.dentro, b.total),
  }));
}

/** Agrega atrasos por justificativa (eixo do gráfico horizontal). */
function buildMotivosResumo(atrasos) {
  const map = new Map();
  for (const row of atrasos) {
    const motivo = row.motivoKey || 'SEM JUSTIFICATIVA INFORMADA';
    const prev = map.get(motivo) || {
      motivo,
      count: 0,
      intertank: 0,
      cliente: 0,
      nao_informado: 0,
    };
    prev.count += 1;
    if (row.responsavel === 'intertank') prev.intertank += 1;
    else if (row.responsavel === 'cliente') prev.cliente += 1;
    else prev.nao_informado += 1;
    map.set(motivo, prev);
  }
  const total = atrasos.length;
  return Array.from(map.values())
    .map((item) => ({
      ...item,
      percent: pct(item.count, total),
      label:
        item.motivo === 'SEM JUSTIFICATIVA INFORMADA'
          ? 'Sem justificativa informada'
          : item.motivo,
    }))
    .sort((a, b) => b.count - a.count || a.motivo.localeCompare(b.motivo));
}

function buildAtrasosRows(groups, t) {
  return groups
    .filter((g) => g.pontualidade === 'fora')
    .map((g) => {
      const horarioAgendado =
        g.horario === ENCAIXE_HORARIO ? 'Encaixe' : g.horario || '—';
      const motivoKey =
        normalizeMotivoAtraso(g.motivoRaw) || 'SEM JUSTIFICATIVA INFORMADA';
      const justificativa = g.motivoRaw
        ? formatJustificativaAtrasoMotivo(g.motivoRaw, t)
        : '';
      const responsavelLabel = g.responsavel
        ? formatJustificativaAtrasoResponsavel(g.responsavel, t)
        : null;
      const bookings =
        Array.isArray(g.bookings) && g.bookings.length > 0 ? g.bookings : [null];

      const saidas = bookings.map((booking, index) => {
        const saidaCodigo =
          booking?.saida_codigo ||
          (g.codesLabel && g.codesLabel !== '—' ? g.codesLabel : null) ||
          '—';
        return {
          id: `${g.id}::${booking?.id || saidaCodigo || index}`,
          saidaCodigo,
          data: g.periodDate || g.data,
          dataLabel: formatDateBR(g.periodDate || g.data),
          cliente: booking?.cliente_nome || g.clientesLabel || '—',
          horarioAgendado,
          horarioReal: g.hora_carregamento || '—',
          atrasoMinutos: g.atrasoMinutos,
          atrasoLabel: g.atrasoLabel,
          operador:
            booking?.operador_conclusao_nome ||
            booking?.usuario_nome ||
            g.operador_nome ||
            '—',
          responsavel: g.responsavelKey,
          responsavelLabel,
          justificativa,
          motivoKey,
        };
      });

      return {
        id: g.id,
        saidaCodigo: g.codesLabel || saidas[0]?.saidaCodigo || '—',
        data: g.periodDate || g.data,
        dataLabel: formatDateBR(g.periodDate || g.data),
        cliente: g.clientesLabel || '—',
        horarioAgendado,
        horarioReal: g.hora_carregamento || '—',
        atrasoMinutos: g.atrasoMinutos,
        atrasoLabel: g.atrasoLabel,
        operador: g.operador_nome || '—',
        responsavel: g.responsavelKey,
        responsavelLabel,
        justificativa,
        motivoKey,
        motivoRaw: g.motivoRaw || '',
        saidas,
      };
    })
    .sort((a, b) => {
      const dc = String(b.data).localeCompare(String(a.data));
      if (dc !== 0) return dc;
      return (b.atrasoMinutos || 0) - (a.atrasoMinutos || 0);
    });
}

function monthDeltaPct(current, previous) {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Consolida indicadores logísticos.
 * @param {object[]} agendamentosConcluidos linhas status=concluido
 * @param {{ year: number, month?: number|null, t?: Function }} opts
 */
export function computePainelLogisticaDashboard(
  agendamentosConcluidos = [],
  { year, month = null, t = (k) => k } = {}
) {
  const enriched = groupCarregamentosConcluidos(agendamentosConcluidos).map(enrichGroup);
  const monthIndex =
    month == null || Number.isNaN(Number(month)) ? null : Number(month);

  const periodGroups = filterGroupsByPeriod(enriched, year, monthIndex);
  const totals = buildPeriodTotals(periodGroups);
  const monthly = buildMonthlySeries(enriched, year);
  const atrasos = buildAtrasosRows(periodGroups, t);
  const motivosResumo = buildMotivosResumo(atrasos);

  // Comparação com mês anterior (estrutura pronta)
  let previousComparison = null;
  if (monthIndex != null) {
    const prevDate = new Date(year, monthIndex, 1);
    prevDate.setMonth(prevDate.getMonth() - 1);
    const prevGroups = filterGroupsByPeriod(
      enriched,
      prevDate.getFullYear(),
      prevDate.getMonth()
    );
    const prevTotals = buildPeriodTotals(prevGroups);
    previousComparison = {
      totalDeltaPct: monthDeltaPct(totals.total, prevTotals.total),
      pontualidadeDeltaPp:
        prevTotals.total > 0
          ? Math.round((totals.pontualidadePct - prevTotals.pontualidadePct) * 10) / 10
          : null,
      atrasosDeltaPct: monthDeltaPct(totals.atrasados, prevTotals.atrasados),
      previous: prevTotals,
    };
  }

  const responsibilityDistribution = [
    {
      key: 'intertank',
      name: 'Intertank',
      value: totals.atrasosIntertank,
      percent: totals.intertankPctOfAtrasos,
      color: '#f59e0b',
    },
    {
      key: 'cliente',
      name: 'Cliente',
      value: totals.atrasosCliente,
      percent: totals.clientePctOfAtrasos,
      color: '#2563eb',
    },
    {
      key: 'nao_informado',
      name: 'Não informado',
      value: totals.atrasosNaoInformado,
      percent: totals.naoInformadoPctOfAtrasos,
      color: '#94a3b8',
    },
  ];

  return {
    year,
    month: monthIndex,
    totals,
    previousComparison,
    monthly,
    monthlyAtrasos: monthly.map((m) => ({
      monthIndex: m.monthIndex,
      monthLabel: m.monthLabel,
      intertank: m.atrasosIntertank,
      cliente: m.atrasosCliente,
      naoInformado: m.atrasosNaoInformado,
      total: m.fora,
    })),
    responsibilityDistribution,
    atrasos,
    motivosResumo,
    meta: {
      groups: periodGroups.length,
      windowMinutes: SLOT_WINDOW_MINUTES,
    },
  };
}
