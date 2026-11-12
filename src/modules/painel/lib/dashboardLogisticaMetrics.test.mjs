/**
 * Validação dos cenários do Dashboard Logística.
 * Executar: node src/modules/painel/lib/dashboardLogisticaMetrics.test.mjs
 *
 * Espelha as regras oficiais de pontualidade (janela de 29 min) e
 * as agregações de responsabilidade / justificativa.
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function combineDateAndTime(isoDate, hhmm) {
  const date = String(isoDate || '').slice(0, 10);
  const time = String(hhmm || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}/.test(time)) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

function getStatusPontualidade(horarioAgendado, horaCarregamento, { dataAgendada, dataCarregamento } = {}) {
  const dataAgendadaIso = String(dataAgendada || '').slice(0, 10);
  const dataCarregamentoIso = String(dataCarregamento || dataAgendada || '').slice(0, 10);

  if (horarioAgendado === 'encaixe') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataAgendadaIso) || !/^\d{4}-\d{2}-\d{2}$/.test(dataCarregamentoIso)) {
      return 'dentro';
    }
    return dataCarregamentoIso > dataAgendadaIso ? 'fora' : 'dentro';
  }

  if (!horaCarregamento) return 'fora';

  const scheduledStart = combineDateAndTime(dataAgendadaIso, horarioAgendado);
  const actual = combineDateAndTime(dataCarregamentoIso || dataAgendadaIso, horaCarregamento);
  if (scheduledStart && actual) {
    const windowEnd = new Date(scheduledStart.getTime() + 29 * 60 * 1000);
    return actual.getTime() <= windowEnd.getTime() ? 'dentro' : 'fora';
  }
  return 'fora';
}

function pct(part, total) {
  if (!(total > 0)) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function groupKey(row) {
  return (
    row.grupo_conclusao_id ||
    `${row.data}|${row.horario}|${row.hora_carregamento || ''}|${row.transportadora || ''}|${row.motorista || ''}|${row.placa || ''}`
  );
}

function groupConcluidos(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row.status !== 'concluido') continue;
    const key = groupKey(row);
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        data: row.data,
        horario: row.horario,
        hora_carregamento: row.hora_carregamento,
        data_carregamento: row.data_carregamento || row.data,
        responsavel: null,
        motivo: '',
      });
    }
    const g = map.get(key);
    if (!g.responsavel && row.justificativa_atraso_responsavel) {
      g.responsavel = row.justificativa_atraso_responsavel;
    }
    if (!g.motivo && row.justificativa_atraso_motivo) {
      g.motivo = row.justificativa_atraso_motivo;
    }
  }
  return [...map.values()].map((g) => ({
    ...g,
    pontualidade: getStatusPontualidade(g.horario, g.hora_carregamento, {
      dataAgendada: g.data,
      dataCarregamento: g.data_carregamento,
    }),
    responsavelKey: g.responsavel || 'nao_informado',
  }));
}

function summarize(groups) {
  let pontuais = 0;
  let atrasados = 0;
  let intertank = 0;
  let cliente = 0;
  let naoInformado = 0;
  for (const g of groups) {
    if (g.pontualidade === 'dentro') {
      pontuais += 1;
      continue;
    }
    atrasados += 1;
    if (g.responsavelKey === 'intertank') intertank += 1;
    else if (g.responsavelKey === 'cliente') cliente += 1;
    else naoInformado += 1;
  }
  return {
    total: pontuais + atrasados,
    pontuais,
    atrasados,
    intertank,
    cliente,
    naoInformado,
    pontualidadePct: pct(pontuais, pontuais + atrasados),
  };
}

const base = {
  status: 'concluido',
  data: '2026-03-10',
  data_carregamento: '2026-03-10',
  horario: '10:00',
  transportadora: 'T1',
  motorista: 'M1',
  placa: 'ABC1D23',
};

const rows = [
  { ...base, id: 1, hora_carregamento: '10:15' }, // pontual (dentro 29 min)
  { ...base, id: 2, hora_carregamento: '10:45', justificativa_atraso_responsavel: 'intertank', justificativa_atraso_motivo: 'EMPILHADEIRA', placa: 'AAA1A11' },
  { ...base, id: 3, hora_carregamento: '11:00', justificativa_atraso_responsavel: 'cliente', justificativa_atraso_motivo: 'NOTA FISCAL', placa: 'BBB2B22' },
  { ...base, id: 4, hora_carregamento: '11:30', placa: 'CCC3C33' }, // atraso sem justificativa
  { ...base, id: 5, status: 'agendado', hora_carregamento: null, placa: 'DDD4D44' }, // pendente — ignora
  { ...base, id: 6, status: 'cancelado', hora_carregamento: '10:00', placa: 'EEE5E55' }, // cancelado — ignora
  // duplicata do mesmo carregamento (mesmo grupo)
  {
    ...base,
    id: 7,
    hora_carregamento: '10:45',
    justificativa_atraso_responsavel: 'intertank',
    justificativa_atraso_motivo: 'EMPILHADEIRA',
    placa: 'AAA1A11',
    saida_codigo: 'S2',
  },
];

let failed = 0;
function run(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}

run('pontual dentro da janela de 29 min', () => {
  assert(
    getStatusPontualidade('10:00', '10:15', {
      dataAgendada: '2026-03-10',
      dataCarregamento: '2026-03-10',
    }) === 'dentro',
    'esperado dentro'
  );
});

run('atraso após a janela', () => {
  assert(
    getStatusPontualidade('10:00', '10:45', {
      dataAgendada: '2026-03-10',
      dataCarregamento: '2026-03-10',
    }) === 'fora',
    'esperado fora'
  );
});

run('pendente e cancelado não entram; duplicata não dobra', () => {
  const groups = groupConcluidos(rows);
  const s = summarize(groups);
  assert(s.total === 4, `total esperado 4, obtido ${s.total}`);
  assert(s.pontuais === 1, `pontuais esperado 1, obtido ${s.pontuais}`);
  assert(s.atrasados === 3, `atrasados esperado 3, obtido ${s.atrasados}`);
  assert(s.intertank === 1, `intertank esperado 1, obtido ${s.intertank}`);
  assert(s.cliente === 1, `cliente esperado 1, obtido ${s.cliente}`);
  assert(s.naoInformado === 1, `naoInformado esperado 1, obtido ${s.naoInformado}`);
  assert(s.pontuais + s.atrasados === s.total, 'total != pontuais + atrasados');
  assert(
    s.intertank + s.cliente + s.naoInformado === s.atrasados,
    'atrasos != intertank + cliente + naoInformado'
  );
});

run('sem justificativa permanece vazia', () => {
  const groups = groupConcluidos(rows);
  const found = groups.find((g) => g.id.includes('CCC3C33'));
  assert(found, 'grupo sem justificativa não encontrado');
  assert(found.pontualidade === 'fora', 'deveria ser fora');
  assert(found.responsavelKey === 'nao_informado', 'responsavel deveria ser nao_informado');
  assert(!found.motivo, 'motivo não deveria ser inventado');
});

run('percentual de pontualidade', () => {
  const s = summarize(groupConcluidos(rows));
  assert(s.pontualidadePct === 25, `esperado 25%, obtido ${s.pontualidadePct}`);
});

if (failed > 0) {
  console.error(`\n${failed} teste(s) falharam`);
  process.exit(1);
}
console.log('\nTodos os cenários Logística OK');
