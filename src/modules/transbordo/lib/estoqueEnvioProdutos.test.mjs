/**
 * Regressão: consolidado Estoque Envio nunca soma kg+L nem apaga
 * vasilhames reais de outro lote quando existe entrada em massa.
 *
 * Executar: npx vite-node src/modules/transbordo/lib/estoqueEnvioProdutos.test.mjs
 */
const fakeStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
globalThis.document = globalThis.document || { title: "" };
globalThis.window = globalThis.window || {
  location: { href: "http://localhost/", pathname: "/", search: "", hash: "" },
  localStorage: fakeStorage,
  history: { replaceState: () => {} },
  document: globalThis.document,
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.localStorage = globalThis.localStorage || fakeStorage;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function approx(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

const {
  aggregateEstoqueEnvioProdutos,
  collectEstoqueEnvioFontes,
  converterFonteParaUnidade,
  converterQuantidadeEntreUom,
  normalizarGruposComMisturaUom,
  resolveUnidadeCanonicaGrupo,
  suprimirEspelhosVasilhameEmLitros,
} = await import("./estoqueEnvioProdutos.js");

// --- conversão ---
assert(
  approx(converterQuantidadeEntreUom(5212, "kg", "L", 1.31), 3978.626, 0.01),
  "kg→L com densidade 1.31"
);
assert(
  approx(converterQuantidadeEntreUom(3978, "L", "kg", 1.31), 5211.18, 0.02),
  "L→kg com densidade 1.31"
);
assert(
  converterQuantidadeEntreUom(5000, "L", "L", 1.31) === 5000,
  "mesmo eixo volume não altera"
);
assert(
  converterQuantidadeEntreUom(100, "kg", "L", 0) === 0,
  "sem densidade não inventa litros"
);

// --- canônica: volume vence massa ---
assert(
  resolveUnidadeCanonicaGrupo([
    { unidade: "kg" },
    { unidade: "L" },
    { unidade: "kg" },
  ]) === "L",
  "grupo misto → L"
);
assert(
  resolveUnidadeCanonicaGrupo([{ unidade: "kg" }, { unidade: "kg" }]) === "kg",
  "só massa → kg"
);

// --- espelho: só mesmo lote ---
{
  const fontes = [
    {
      codigo: "10081",
      produto: "PROD X",
      cliente_nome: "CLI",
      cliente_id: "c1",
      unidade: "kg",
      lote: "OF-1",
      tipo_recebimento: "granel",
      saldo: 100,
      saldoTanque: 100,
    },
    {
      codigo: "10081",
      produto: "PROD X",
      cliente_nome: "CLI",
      cliente_id: "c1",
      unidade: "L",
      lote: "OF-1",
      tipo_recebimento: "vasilhame",
      saldo: 100,
      saldoTanque: 100,
    },
    {
      codigo: "10081",
      produto: "PROD X",
      cliente_nome: "CLI",
      cliente_id: "c1",
      unidade: "L",
      lote: "OS-OTHER",
      tipo_recebimento: "vasilhame",
      saldo: 5000,
      saldoTanque: 5000,
    },
  ];
  const kept = suprimirEspelhosVasilhameEmLitros(fontes);
  assert(kept.length === 2, "remove só espelho do mesmo lote");
  assert(
    kept.some((f) => f.lote === "OS-OTHER"),
    "mantém vasilhame de lote distinto"
  );
  assert(
    !kept.some((f) => f.lote === "OF-1" && f.unidade === "L"),
    "remove L vasilhame espelho de OF-1"
  );
}

// --- normalização + agregação (cenário tipo SCAVEN, genérico) ---
{
  const dens = 1.31;
  const fontes = [
    {
      codigo: "99999",
      produto: "PRODUTO GENERICO",
      cliente_nome: "CLIENTE A",
      cliente_id: "ca",
      unidade: "L",
      lote: "OS-A",
      tipo_recebimento: "vasilhame",
      densidade: dens,
      saldo: 25000,
      saldoEmbalado: 0,
      saldoTanque: 25000,
      saldoTanka: 0,
      colunasLivro: true,
    },
    {
      codigo: "99999",
      produto: "PRODUTO GENERICO",
      cliente_nome: "CLIENTE A",
      cliente_id: "ca",
      unidade: "L",
      lote: "OF-B",
      tipo_recebimento: "granel",
      densidade: dens,
      saldo: 46022,
      saldoEmbalado: 0,
      saldoTanque: 46022,
      saldoTanka: 8245.601,
      colunasLivro: true,
    },
    {
      codigo: "99999",
      produto: "PRODUTO GENERICO",
      cliente_nome: "CLIENTE A",
      cliente_id: "ca",
      unidade: "kg",
      lote: "OF-C",
      tipo_recebimento: "granel",
      densidade: dens,
      saldo: 5212,
      saldoEmbalado: 0,
      saldoTanque: 5212,
      saldoTanka: 0,
      colunasLivro: true,
    },
  ];

  // Espelhos não devem remover OS-A (lote ≠ OF-C)
  const aposEspelho = suprimirEspelhosVasilhameEmLitros(fontes);
  assert(aposEspelho.length === 3, "nenhuma entrada real removida");

  const norm = normalizarGruposComMisturaUom(aposEspelho);
  assert(
    norm.every((f) => String(f.unidade).toLowerCase() === "l"),
    "após mistura todas as fontes em L"
  );
  const kgConvertida = norm.find((f) => f.lote === "OF-C");
  assert(
    approx(kgConvertida.saldoTanque, 5212 / dens, 0.02),
    "tanque kg convertido para L"
  );

  const [row] = aggregateEstoqueEnvioProdutos(norm);
  assert(row.unidade === "L", "agregado em L");
  assert(
    approx(row.saldoTanque, 25000 + 46022 + 5212 / dens, 0.05),
    `tanque agregado ≈ 75000 (got ${row.saldoTanque})`
  );
  assert(approx(row.saldoTanka, 8245.601, 0.01), "tanka preservada");
}

// --- agregação sozinha já converte (defesa em profundidade) ---
{
  const [row] = aggregateEstoqueEnvioProdutos([
    {
      codigo: "1",
      produto: "P",
      cliente_nome: "C",
      cliente_id: "1",
      unidade: "L",
      densidade: 1.2,
      saldo: 1000,
      saldoTanque: 1000,
      saldoEmbalado: 0,
      saldoTanka: 0,
    },
    {
      codigo: "1",
      produto: "P",
      cliente_nome: "C",
      cliente_id: "1",
      unidade: "kg",
      densidade: 1.2,
      saldo: 240,
      saldoTanque: 240,
      saldoEmbalado: 0,
      saldoTanka: 0,
    },
  ]);
  assert(row.unidade === "L", "agregador força L");
  assert(approx(row.saldoTanque, 1200, 0.02), "1000 L + 240 kg/1.2 = 1200 L");
}

// --- collectEstoqueEnvioFontes (caminho completo) ---
{
  const estoque = [
    {
      produto_codigo: "777",
      produto_nome: "OUTRO PRODUTO",
      cliente_nome: "REP",
      cliente_id: "r1",
      lote: "VAS-1",
      unidade_medida: "L",
      tipo_recebimento: "vasilhame",
      densidade: 1.1,
      locais: { patio: 0, vasilhames: 5000, tankas: 0 },
    },
    {
      produto_codigo: "777",
      produto_nome: "OUTRO PRODUTO",
      cliente_nome: "REP",
      cliente_id: "r1",
      lote: "GR-1",
      unidade_medida: "kg",
      tipo_recebimento: "granel",
      densidade: 1.1,
      locais: { patio: 0, vasilhames: 1100, tankas: 0 },
    },
    {
      produto_codigo: "777",
      produto_nome: "OUTRO PRODUTO",
      cliente_nome: "REP",
      cliente_id: "r1",
      lote: "GR-2",
      unidade_medida: "L",
      tipo_recebimento: "granel",
      densidade: 1.1,
      locais: { patio: 0, vasilhames: 4000, tankas: 100 },
    },
  ];
  const fontes = collectEstoqueEnvioFontes({
    estoque,
    entradas: [],
    indStock: [],
    clientes: [],
    indStockReady: false,
  });
  assert(
    fontes.every((f) => String(f.unidade).toLowerCase() === "l"),
    "collect normaliza grupo misto para L"
  );
  assert(
    fontes.some((f) => f.lote === "VAS-1"),
    "vasilhame de lote distinto permanece no collect"
  );
  const [agg] = aggregateEstoqueEnvioProdutos(fontes);
  assert(approx(agg.saldoTanque, 5000 + 1000 + 4000, 0.05), "5000+1100kg/1.1+4000");
  assert(approx(agg.saldoTanka, 100, 0.01), "tanka do collect");
}

// converterFonte isolada
{
  const out = converterFonteParaUnidade(
    {
      unidade: "kg",
      densidade: 1.25,
      saldo: 125,
      saldoTanque: 125,
      saldoEmbalado: 0,
      saldoTanka: 0,
    },
    "L"
  );
  assert(out.unidade === "L", "fonte convertida para L");
  assert(approx(out.saldoTanque, 100, 0.01), "125 kg / 1.25 = 100 L");
}

// Embalado misto L+kg sem densidade: soma nominal (não zerar kg)
{
  const fontes = [
    {
      codigo: "1015981",
      produto: "GAMAZYME 700 FN - BALDE 12 KG",
      cliente_nome: "VIBRA ENERGIA",
      cliente_id: "vibra",
      unidade: "L",
      tipo_recebimento: "embalado",
      embalado: true,
      densidade: null,
      saldo: 72,
      saldoEmbalado: 72,
      saldoTanque: 0,
      saldoTanka: 0,
      colunasLivro: true,
    },
    {
      codigo: "1015981",
      produto: "GAMAZYME 700 FN - BALDE 12 KG",
      cliente_nome: "VIBRA ENERGIA",
      cliente_id: "vibra",
      unidade: "kg",
      tipo_recebimento: "embalado",
      embalado: true,
      densidade: null,
      saldo: 120,
      saldoEmbalado: 120,
      saldoTanque: 0,
      saldoTanka: 0,
      colunasLivro: true,
    },
  ];
  const norm = normalizarGruposComMisturaUom(fontes);
  assert(
    norm.every((f) => String(f.unidade).toLowerCase() === "l"),
    "embalado misto relabel para L"
  );
  assert(
    approx(
      norm.reduce((s, f) => s + (Number(f.saldo) || 0), 0),
      192,
      0.01
    ),
    "embalado sem densidade preserva 72+120"
  );
  const [row] = aggregateEstoqueEnvioProdutos(norm);
  assert(row.unidade === "L", "GAMAZYME agregado em L");
  assert(approx(row.saldo, 192, 0.01), `GAMAZYME saldo 192 (got ${row.saldo})`);
  assert(
    approx(row.saldoEmbalado, 192, 0.01),
    `GAMAZYME embalado 192 (got ${row.saldoEmbalado})`
  );
}

console.log("estoqueEnvioProdutos.test.mjs: OK");
