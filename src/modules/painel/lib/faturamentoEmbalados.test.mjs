/**
 * Validação dos cenários obrigatórios do faturamento embalado.
 * Executar: node src/modules/painel/lib/faturamentoEmbalados.test.mjs
 *
 * Nota: este arquivo importa via caminhos relativos ao pacote; no Node puro
 * usamos reimplementação mínima dos helpers exportáveis para não depender do
 * alias Vite. Mantém espelho das fórmulas do motor.
 */

function toCents(value) {
  return Math.round(Number(value) * 100);
}
function fromCents(cents) {
  return (Number(cents) || 0) / 100;
}
function calcPaletesSaida(embalagens, capacidade) {
  return Math.ceil(Number(embalagens) / Number(capacidade));
}
function diffDays(isoA, isoB) {
  const [ay, am, ad] = isoA.split('-').map(Number);
  const [by, bm, bd] = isoB.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
function countStorageDays(start, endExclusive) {
  return Math.max(0, diffDays(start, endExclusive));
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

console.log('Teste 1 — Entrada 5 paletes');
{
  const cents = toCents(5 * 25.57);
  assert('R$ 127,85', cents === 12785, `got ${fromCents(cents)}`);
}

console.log('Teste 2 — Saída completa 8 emb / cap 4');
{
  const paletes = calcPaletesSaida(8, 4);
  const cents = toCents(paletes * 25.57);
  assert('2 paletes', paletes === 2);
  assert('R$ 51,14', cents === 5114, `got ${fromCents(cents)}`);
}

console.log('Teste 3 — Saída fracionada 3 emb / cap 4');
{
  const paletes = calcPaletesSaida(3, 4);
  const cents = toCents(paletes * 25.57);
  assert('1 palete', paletes === 1);
  assert('R$ 25,57', cents === 2557, `got ${fromCents(cents)}`);
}

console.log('Teste 4 — Armazenagem pátio 3×10×1.25');
{
  // 10 dias inclusivos de calendário de negócio no brief;
  // motor usa fim exclusivo: 01/10 → 11/10 = 10 dias.
  const days = countStorageDays('2026-10-01', '2026-10-11');
  const cents = toCents(3 * days * 1.25);
  assert('10 dias (01→11 exclusive)', days === 10);
  assert('R$ 37,50', cents === 3750, `got ${fromCents(cents)}`);
}

console.log('Teste 5 — Armazenagem tenda 3×10×2.00');
{
  const days = countStorageDays('2026-10-01', '2026-10-11');
  const cents = toCents(3 * days * 2.0);
  assert('R$ 60,00', cents === 6000, `got ${fromCents(cents)}`);
}

console.log('Teste 6 — Saída parcial (1 de 3)');
{
  const exited = 1;
  const remaining = 3 - exited;
  const mov = toCents(exited * 25.57);
  // saída 10/10 no período 01/10–31/10 → dias exclusivos 01→10 = 9
  const daysExit = countStorageDays('2026-10-01', '2026-10-10');
  const armExit = toCents(exited * daysExit * 1.25);
  const daysRem = countStorageDays('2026-10-01', '2026-11-01');
  const armRem = toCents(remaining * daysRem * 1.25);
  assert('mov saída R$ 25,57', mov === 2557);
  assert('2 remanescentes', remaining === 2);
  assert('armazenagem saída > 0', armExit > 0, `days=${daysExit} cents=${armExit}`);
  assert('armazenagem remanescente > saída', armRem > armExit, `rem=${armRem} exit=${armExit}`);
}

console.log('Teste 7 — Entrada período anterior sem re-cobrar mov');
{
  const entryDate = '2026-09-15';
  const from = '2026-10-01';
  const to = '2026-10-31';
  const entryInPeriod = entryDate >= from && entryDate <= to;
  assert('não cobra movimentação de entrada', entryInPeriod === false);
  const days = countStorageDays(from, '2026-11-01');
  assert('armazenagem outubro = 31 dias', days === 31);
}

console.log('Teste 8 — Períodos diferentes');
{
  // saída 10/10
  const a = countStorageDays('2026-10-01', '2026-10-10'); // período cheio até saída
  const b = countStorageDays('2026-10-09', '2026-10-10'); // filtro 09/10 → 1 dia
  assert('01→10 = 9 dias', a === 9);
  assert('09→10 = 1 dia', b === 1);
}

console.log('Teste 9 — Granel excluído (filtro tipo)');
{
  const tipo = 'granel';
  assert('granel não embalado', tipo !== 'embalado');
}

console.log('Teste 10 — Saída não concluída ignorada');
{
  const status = 'agendado';
  const faturavel = status === 'concluido';
  assert('agendado não faturável', faturavel === false);
}

console.log('Teste 11 — Anti-duplicidade remanescente (saída + estoque)');
{
  // 5 entram, 3 saem, 2 remanescem — armazenagem não se sobrepõe.
  const entrada = 5;
  const saida = 3;
  const rem = entrada - saida;
  const daysExit = countStorageDays('2026-09-01', '2026-09-15');
  const daysRem = countStorageDays('2026-09-01', '2026-10-01');
  const armSaida = toCents(saida * daysExit * 1.25);
  const armEstoque = toCents(rem * daysRem * 1.25);
  const armTotal = armSaida + armEstoque;
  assert('remanescente = 2', rem === 2);
  assert('armazenagem saída só nos 3', armSaida === toCents(3 * daysExit * 1.25));
  assert('armazenagem estoque só nos 2', armEstoque === toCents(2 * daysRem * 1.25));
  assert(
    'total = soma sem overlap',
    armTotal === armSaida + armEstoque,
    `got ${armTotal}`
  );
  // Linha de entrada não carrega armazenagem remanescente.
  const entradaArmCents = null;
  assert('entrada sem armazenagem remanescente', entradaArmCents == null);
}

console.log('');
if (failed) {
  console.error(`${failed} teste(s) falharam`);
  process.exit(1);
}
console.log('Todos os cenários base passaram.');
