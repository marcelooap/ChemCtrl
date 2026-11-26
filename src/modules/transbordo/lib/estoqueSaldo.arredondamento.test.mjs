/**
 * Regressão: baixa total de embalado 1.000 kg @ 1,09 (917 L) não deixa
 * residual 0,47 kg na tela de Estoque (mesmo critério do relatório fiscal).
 *
 * Executar: npx vite-node src/modules/transbordo/lib/estoqueSaldo.arredondamento.test.mjs
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

const {
  computeEstoqueSaldo,
  computeEstoqueQuantidadesPorLocal,
  resolveMassaVasilhameParaBaixa,
  quantidadeFifoOperacional,
} = await import("./estoqueSaldo.js");
const {
  litrosFromMassaKg,
  massaKgFromLitrosOperacionais,
  roundMass,
} = await import("./format.js");

const DENS = 1.09;
const MASSA = 1000;
const LITROS = litrosFromMassaKg(MASSA, DENS);

assert(LITROS === 917, `esperado 917 L, veio ${LITROS}`);
assert(
  massaKgFromLitrosOperacionais(LITROS, DENS) === 1000,
  "massaKgFromLitrosOperacionais deve recuperar 1000 kg"
);
assert(
  roundMass(LITROS * DENS) === 999.53,
  `L×dens residual esperado 999,53, veio ${roundMass(LITROS * DENS)}`
);

// Baixa por vasilhame com peso residual L×dens gravado
{
  const massa = resolveMassaVasilhameParaBaixa(
    {
      id: "v1",
      volume: LITROS,
      peso_liquido: roundMass(LITROS * DENS),
      densidade: DENS,
      status: "Expedido",
      data_saida: "2026-11-01",
      composicao: [
        {
          quantidade_l: LITROS,
          quantidade_kg: roundMass(LITROS * DENS),
          estoque_id: "e1",
        },
      ],
    },
    []
  );
  assert(massa === 1000, `resolveMassaVasilhameParaBaixa: esperado 1000, veio ${massa}`);
}

// Fatia FIFO com volume em L e peso residual
{
  const qtd = quantidadeFifoOperacional(
    { volume: LITROS, pesoLiq: roundMass(LITROS * DENS), densidade: DENS },
    {
      id: "e1",
      quantidade: MASSA,
      unidade_medida: "kg",
      densidade: DENS,
      tipo_recebimento: "granel",
      lotes: [{ densidade: DENS, quantidade: MASSA }],
    }
  );
  assert(qtd === 1000, `quantidadeFifoOperacional: esperado 1000, veio ${qtd}`);
}

// Estoque embalado 1000 kg totalmente expedido via saída convencional
{
  const estoqueItem = {
    id: "e-bu3604",
    quantidade: MASSA,
    saldo_inicial: MASSA,
    unidade_medida: "kg",
    densidade: DENS,
    embalado: true,
    tipo_recebimento: "embalado",
    lotes: [
      {
        embalado: true,
        tipo_recebimento: "embalado",
        densidade: DENS,
        quantidade: MASSA,
        unidade_medida: "kg",
      },
    ],
  };

  const vasilhame = {
    id: "v-bu",
    volume: LITROS,
    peso_liquido: roundMass(LITROS * DENS),
    densidade: DENS,
    status: "Expedido",
    data_saida: "2026-11-20",
    tipo: "Vasilhame",
    composicao: [
      {
        quantidade_l: LITROS,
        quantidade_kg: roundMass(LITROS * DENS),
        estoque_id: "e-bu3604",
        entrada_id: "e-bu3604",
      },
    ],
  };

  const transbordos = [
    {
      id: "t1",
      densidade: DENS,
      origens: [
        {
          entrada_id: "e-bu3604",
          estoque_id: "e-bu3604",
          tipo_origem: "embalado",
          embalado: true,
          unidade_medida: "kg",
          volume_retirado: MASSA,
          massa_retirada: MASSA,
        },
      ],
      destinos: [
        {
          vasilhame_existente_id: "v-bu",
          volume: LITROS,
          peso_liquido: roundMass(LITROS * DENS),
          tipo_embalagem: "Vasilhame",
        },
      ],
    },
  ];

  const saidas = [
    {
      status: "validado",
      origem_modulo: "transbordo",
      itens: [
        {
          tipo: "convencional",
          vasilhame_id: "v-bu",
          validado: true,
          volume_solicitado: LITROS,
          // Residual clássico — tela deve recuperar 1000 e zerar saldo
          quantidade_solicitada: roundMass(LITROS * DENS),
          peso_liquido: roundMass(LITROS * DENS),
        },
      ],
    },
  ];

  const saldo = computeEstoqueSaldo(
    estoqueItem,
    transbordos,
    saidas,
    [vasilhame]
  );
  assert(
    saldo === 0,
    `computeEstoqueSaldo após baixa total: esperado 0, veio ${saldo}`
  );

  const locais = computeEstoqueQuantidadesPorLocal(estoqueItem, {
    transbordos,
    vasilhames: [vasilhame],
    saidas,
    saldo,
  });
  assert(
    locais.patio === 0,
    `saldo embalado (pátio): esperado 0, veio ${locais.patio}`
  );
  assert(
    locais.total === 0,
    `saldo atual: esperado 0, veio ${locais.total}`
  );
}

console.log("estoqueSaldo.arredondamento.test.mjs: OK");
