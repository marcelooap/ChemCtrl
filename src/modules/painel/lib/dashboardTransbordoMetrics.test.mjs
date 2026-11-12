/**
 * Validação dos cenários do Dashboard Transbordo.
 * Executar: node src/modules/painel/lib/dashboardTransbordoMetrics.test.mjs
 */

function roundVolume(v) {
  const n = Number(v) || 0;
  return Math.round(n * 1000) / 1000;
}

function classifyTransbordoDestino(destino, produtoFiltrado) {
  const tipo = String(destino?.tipo_embalagem || '').trim();
  if (tipo === 'Tankagem') return 'convencional';
  if (produtoFiltrado && tipo === 'Vasilhame') return 'filtrado';
  return 'convencional';
}

function expand(transbordo, filtrado) {
  return (transbordo.destinos || []).map((d) => ({
    category: classifyTransbordoDestino(d, filtrado),
    volume: roundVolume(d.volume_total || d.volume || 0),
  }));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const cases = [
  {
    name: 'Granel → Tanka, produto filtrado',
    filtrado: true,
    destinos: [{ tipo_embalagem: 'Tankagem', volume_total: 1000 }],
    expect: 'convencional',
  },
  {
    name: 'Granel → Tanka, produto não filtrado',
    filtrado: false,
    destinos: [{ tipo_embalagem: 'Tankagem', volume_total: 800 }],
    expect: 'convencional',
  },
  {
    name: 'Granel → Vasilhame, produto filtrado',
    filtrado: true,
    destinos: [{ tipo_embalagem: 'Vasilhame', volume_total: 500 }],
    expect: 'filtrado',
  },
  {
    name: 'Granel → Vasilhame, produto não filtrado',
    filtrado: false,
    destinos: [{ tipo_embalagem: 'Vasilhame', volume_total: 500 }],
    expect: 'convencional',
  },
  {
    name: 'Tanka → Vasilhame, produto filtrado',
    filtrado: true,
    destinos: [{ tipo_embalagem: 'Vasilhame', volume_total: 300 }],
    expect: 'filtrado',
  },
  {
    name: 'Tanka → Vasilhame, produto não filtrado',
    filtrado: false,
    destinos: [{ tipo_embalagem: 'Vasilhame', volume_total: 300 }],
    expect: 'convencional',
  },
];

let failed = 0;
for (const c of cases) {
  const slices = expand({ destinos: c.destinos }, c.filtrado);
  const cat = slices[0]?.category;
  try {
    assert(cat === c.expect, `${c.name}: esperado ${c.expect}, obtido ${cat}`);
    console.log(`OK  ${c.name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${e.message}`);
  }
}

// Total = soma categorias (sem duplicar destinos)
{
  const slices = [
    ...expand(
      { destinos: [{ tipo_embalagem: 'Tankagem', volume_total: 1000 }] },
      true
    ),
    ...expand(
      { destinos: [{ tipo_embalagem: 'Vasilhame', volume_total: 400 }] },
      true
    ),
    { category: 'industrializado', volume: 250 },
  ];
  const totals = { convencional: 0, filtrado: 0, industrializado: 0 };
  for (const s of slices) totals[s.category] += s.volume;
  const total = totals.convencional + totals.filtrado + totals.industrializado;
  try {
    assert(totals.convencional === 1000, 'convencional');
    assert(totals.filtrado === 400, 'filtrado');
    assert(totals.industrializado === 250, 'industrializado');
    assert(total === 1650, 'total');
    console.log('OK  Volume Total = soma das categorias');
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${e.message}`);
  }
}

// Bombona de produto filtrado permanece convencional (fora do espelho de filtração)
{
  const cat = classifyTransbordoDestino(
    { tipo_embalagem: 'Bombona de 200 L', volume_total: 200 },
    true
  );
  try {
    assert(cat === 'convencional', `Bombona filtrado → convencional, got ${cat}`);
    console.log('OK  Bombona + produto filtrado = convencional');
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${e.message}`);
  }
}

if (failed) {
  console.error(`\n${failed} falha(s)`);
  process.exit(1);
}
console.log('\nTodos os cenários passaram.');
