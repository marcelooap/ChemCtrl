/**
 * Validação dos cenários obrigatórios do faturamento de vasilhames.
 * Executar: node src/modules/painel/lib/faturamentoVasilhames.test.mjs
 *
 * Espelho das fórmulas do motor (sem aliases Vite), no mesmo padrão de
 * faturamentoEmbalados.test.mjs.
 */

function toCents(value) {
  return Math.round(Number(value) * 100);
}

function diffDays(isoA, isoB) {
  const [ay, am, ad] = isoA.split('-').map(Number);
  const [by, bm, bd] = isoB.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

function countStorageDays(start, endExclusive) {
  return Math.max(0, diffDays(start, endExclusive));
}

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(days || 0)));
  return dt.toISOString().slice(0, 10);
}

function rateToNumber(value) {
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function snapCapacidade(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  for (const k of [1000, 1500, 5000]) {
    if (Math.abs(k - n) < 0.5) return k;
  }
  return null;
}

function resolveTarifa(tarifas, capacidade, day) {
  const sorted = tarifas
    .filter((t) => Math.abs(Number(t.capacidade_litros) - Number(capacidade)) < 0.5)
    .filter((t) => t.vigencia_inicio <= day)
    .sort((a, b) => String(b.vigencia_inicio).localeCompare(String(a.vigencia_inicio)));
  return sorted[0] || null;
}

function calcArmazenagem({ capacidade, start, endExclusive, periodFrom, periodTo, tarifas }) {
  const periodStart = periodFrom;
  const periodEndExclusive = addDays(periodTo, 1);
  const segStart = start > periodStart ? start : periodStart;
  const segEnd = endExclusive < periodEndExclusive ? endExclusive : periodEndExclusive;
  if (segStart >= segEnd) return { days: 0, cents: 0, segments: [] };

  const cuts = new Set([segStart, segEnd]);
  for (const t of tarifas) {
    if (Math.abs(Number(t.capacidade_litros) - Number(capacidade)) >= 0.5) continue;
    if (t.vigencia_inicio > segStart && t.vigencia_inicio < segEnd) {
      cuts.add(t.vigencia_inicio);
    }
  }
  const points = [...cuts].sort();
  let exact = 0;
  let days = 0;
  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const d = countStorageDays(a, b);
    if (d <= 0) continue;
    const tarifa = resolveTarifa(tarifas, capacidade, a);
    const part = d * rateToNumber(tarifa?.tarifa_diaria);
    exact += part;
    days += d;
    segments.push({ from: a, toExclusive: b, days: d, part });
  }
  return { days, cents: toCents(exact), segments };
}

function identifyCapacidade({ tank, registry, saidas = [] }) {
  if (registry?.confirmada) {
    return { capacidade: registry.capacidade_litros, origem: 'cadastrada' };
  }
  const capField = snapCapacidade(tank.capacidade);
  const volume = Number(tank.volume) || 0;
  if (capField != null) {
    if (Math.abs(capField - volume) < 0.5 || capField > volume + 0.5) {
      return { capacidade: capField, origem: 'cadastrada' };
    }
  }
  if (snapCapacidade(volume) != null) {
    return { capacidade: snapCapacidade(volume), origem: 'historico' };
  }
  for (const saida of [...saidas].reverse()) {
    for (const item of saida.itens || []) {
      if (String(item.vasilhame_placa || '') !== String(tank.placa || '')) continue;
      const disp = snapCapacidade(item.volume_disponivel);
      if (
        disp != null &&
        Math.abs(Number(item.volume_solicitado) - Number(item.volume_disponivel)) < 1
      ) {
        return { capacidade: disp, origem: 'historico' };
      }
    }
  }
  return { capacidade: null, origem: 'nao_identificada' };
}

let failed = 0;
function assert(name, cond, detail = '') {
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const TARIFAS = [
  { capacidade_litros: 5000, tarifa_diaria: '5.63589476994486', vigencia_inicio: '2000-01-01' },
  { capacidade_litros: 1500, tarifa_diaria: '1.25242105998775', vigencia_inicio: '2000-01-01' },
  { capacidade_litros: 1000, tarifa_diaria: '1.25242105998775', vigencia_inicio: '2000-01-01' },
];

console.log('Teste 1 — Contagem de dias 01/11–10/11 = 10');
{
  assert('10 dias', countStorageDays('2026-11-01', '2026-11-11') === 10);
}

console.log('Teste 2 — Capacidade confirmada tem prioridade');
{
  const id = identifyCapacidade({
    tank: { placa: 'ABC', volume: 500, capacidade: 5000 },
    registry: { confirmada: true, capacidade_litros: 1500 },
  });
  assert('usa 1500 confirmada', id.capacidade === 1500 && id.origem === 'cadastrada');
}

console.log('Teste 3 — Não assume volume parcial como nominal');
{
  const id = identifyCapacidade({
    tank: { placa: 'X', volume: 500, capacidade: null },
    saidas: [],
  });
  assert('não identificada', id.capacidade == null && id.origem === 'nao_identificada');
}

console.log('Teste 4 — Inferência por saída integral histórica 1500 L');
{
  const id = identifyCapacidade({
    tank: { placa: 'PL1', volume: 500, capacidade: null },
    saidas: [
      {
        itens: [
          { vasilhame_placa: 'PL1', volume_disponivel: 1500, volume_solicitado: 1500 },
        ],
      },
    ],
  });
  assert('infere 1500', id.capacidade === 1500 && id.origem === 'historico');
}

console.log('Teste 5 — Inferência 5000 L com saldo 500 L');
{
  const id = identifyCapacidade({
    tank: { placa: 'PL5', volume: 500 },
    saidas: [
      {
        itens: [
          { vasilhame_placa: 'PL5', volume_disponivel: 5000, volume_solicitado: 5000 },
        ],
      },
    ],
  });
  assert('infere 5000', id.capacidade === 5000);
}

console.log('Teste 6 — Cálculo 10 × 5,63589476994486 ≈ R$ 56,36');
{
  const calc = calcArmazenagem({
    capacidade: 5000,
    start: '2026-11-01',
    endExclusive: '2026-11-11',
    periodFrom: '2026-11-01',
    periodTo: '2026-11-10',
    tarifas: TARIFAS,
  });
  assert('dias=10', calc.days === 10, `got ${calc.days}`);
  assert('cents=5636', calc.cents === 5636, `got ${calc.cents}`);
}

console.log('Teste 7 — Cálculo 10 × 1,25242105998775 ≈ R$ 12,52');
{
  const calc = calcArmazenagem({
    capacidade: 1500,
    start: '2026-11-01',
    endExclusive: '2026-11-11',
    periodFrom: '2026-11-01',
    periodTo: '2026-11-10',
    tarifas: TARIFAS,
  });
  assert('dias=10', calc.days === 10);
  assert('cents=1252', calc.cents === 1252, `got ${calc.cents}`);
}

console.log('Teste 8 — Mudança de vigência no período');
{
  const calc = calcArmazenagem({
    capacidade: 5000,
    start: '2026-11-01',
    endExclusive: '2026-11-11',
    periodFrom: '2026-11-01',
    periodTo: '2026-11-10',
    tarifas: [
      { capacidade_litros: 5000, tarifa_diaria: '5', vigencia_inicio: '2000-01-01' },
      { capacidade_litros: 5000, tarifa_diaria: '5.5', vigencia_inicio: '2026-11-06' },
    ],
  });
  assert('2 segmentos', calc.segments.length === 2);
  assert('total R$ 52,50', calc.cents === 5250, `got ${calc.cents}`);
}

console.log('Teste 9 — Envase antes do período, ainda no pátio');
{
  const id = identifyCapacidade({
    tank: { placa: 'PL1', volume: 500, capacidade: 1500 },
  });
  const calc = calcArmazenagem({
    capacidade: id.capacidade,
    start: '2026-10-20',
    endExclusive: '2026-11-11',
    periodFrom: '2026-11-01',
    periodTo: '2026-11-10',
    tarifas: TARIFAS,
  });
  assert('clipa para 10 dias', calc.days === 10);
  assert('total 12,52', calc.cents === 1252);
}

console.log('Teste 10 — Expedido não cobra após saída');
{
  const calc = calcArmazenagem({
    capacidade: 1000,
    start: '2026-11-01',
    endExclusive: '2026-11-05',
    periodFrom: '2026-11-01',
    periodTo: '2026-11-10',
    tarifas: TARIFAS,
  });
  assert('4 dias até saída', calc.days === 4);
}

if (failed > 0) {
  console.error(`\n${failed} teste(s) falharam.`);
  process.exit(1);
}
console.log('\nTodos os testes passaram.');
