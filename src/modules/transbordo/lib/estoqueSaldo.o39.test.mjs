/**
 * Regressão O-39: item 335 não rouba T220 (lote 2606180624) via FIFO
 * inconsistente, e não deixa 0,001 kg em Embalado.
 *
 * Executar: npx vite-node src/modules/transbordo/lib/estoqueSaldo.o39.test.mjs
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
  createEstoqueSaldoContext,
  computeEstoqueSaldo,
  computeEstoqueQuantidadesPorLocal,
} = await import("./estoqueSaldo.js");

const DENS = 1.3;
const ID_335 = "est-335";
const ID_336 = "est-336";
const ID_TANKA = "tanka-46";

const estoque335 = {
  id: ID_335,
  codigo_estoque: 335,
  quantidade: 3724,
  saldo_inicial: 3724,
  unidade_medida: "kg",
  densidade: DENS,
  tipo_recebimento: "granel",
  embalado: false,
  produto_nome: "SISBRAX SCAVE O-39",
  produto_codigo: "1023957",
  cliente_nome: "VIBRA ENERGIA",
  lote: "2609080977",
  lotes: [
    {
      lote: "2609080977",
      densidade: DENS,
      quantidade: 3724,
      unidade_medida: "kg",
      tipo_recebimento: "granel",
    },
  ],
};

const estoque336 = {
  id: ID_336,
  codigo_estoque: 336,
  quantidade: 1950,
  saldo_inicial: 1950,
  // Livro zerado (baixa precoce) — pátio físico ainda No Pátio.
  unidade_medida: "kg",
  densidade: DENS,
  tipo_recebimento: "granel",
  embalado: false,
  produto_nome: "SISBRAX SCAVE O-39",
  produto_codigo: "1023957",
  cliente_nome: "VIBRA ENERGIA",
  lote: "2606180624",
  lotes: [
    {
      lote: "2606180624",
      densidade: DENS,
      quantidade: 1950,
      unidade_medida: "kg",
      tipo_recebimento: "granel",
    },
  ],
};

const tankOwnA = {
  id: "vas-own-a",
  placa: "15669-0",
  tipo: "Vasilhame",
  status: "No Pátio",
  volume: 1500,
  peso_liquido: 1950,
  densidade: DENS,
  lote: "2609080977",
  produto_nome: "SISBRAX SCAVE O-39",
  produto_codigo: "1023957",
  cliente_nome: "VIBRA ENERGIA",
  composicao: [
    {
      lote: "2609080977",
      estoque_id: ID_335,
      entrada_id: ID_335,
      quantidade_l: 1500,
      quantidade_kg: 1950,
    },
  ],
};

const tankOwnB = {
  id: "vas-own-b",
  placa: "15634-2",
  tipo: "Vasilhame",
  status: "No Pátio",
  volume: 1500,
  peso_liquido: 1950,
  densidade: DENS,
  lote: "2609080977",
  produto_nome: "SISBRAX SCAVE O-39",
  produto_codigo: "1023957",
  cliente_nome: "VIBRA ENERGIA",
  composicao: [
    {
      lote: "2609080977",
      estoque_id: ID_335,
      entrada_id: ID_335,
      quantidade_l: 1500,
      quantidade_kg: 1950,
    },
  ],
};

const tankT220 = {
  id: "vas-t220",
  placa: "17748-3",
  tipo: "Vasilhame",
  status: "No Pátio",
  volume: 1500,
  peso_liquido: 1950,
  densidade: DENS,
  lote: "2606180624",
  produto_nome: "SISBRAX SCAVE O-39",
  produto_codigo: "1023957",
  cliente_nome: "VIBRA ENERGIA",
  numero_op: "T220",
  transbordo_id: "op-t220",
  composicao: [
    {
      lote: "2606180624",
      // Stamp de tanka (não é id de estoque) — cenário real O-39.
      estoque_id: ID_TANKA,
      entrada_id: ID_TANKA,
      quantidade_l: 1500,
      quantidade_kg: 1950,
      transbordo_codigo: "T220",
    },
  ],
};

const bombona = {
  id: "vas-bomb",
  placa: "07 x Bombonas de 20 L",
  tipo: "Bombona de 20 L",
  status: "No Pátio",
  volume: 140,
  peso_liquido: 182,
  densidade: DENS,
  lote: "2609080977",
  produto_nome: "SISBRAX SCAVE O-39",
  produto_codigo: "1023957",
  cliente_nome: "VIBRA ENERGIA",
  composicao: [
    {
      lote: "2609080977",
      estoque_id: ID_335,
      entrada_id: ID_335,
      quantidade_l: 140,
      quantidade_kg: 182,
    },
  ],
};

// OP tanka→pátio que gera share FIFO “errado” para 335 no T220.
const transbordos = [
  {
    id: "op-fill",
    codigo_transbordo: "T100",
    created_at: "2026-10-01T10:00:00Z",
    densidade: DENS,
    origens: [
      {
        entrada_id: ID_335,
        estoque_id: ID_335,
        tipo_origem: "embalado",
        volume_retirado: 3000,
        massa_retirada: 3900,
        lote: "2609080977",
      },
      {
        entrada_id: ID_336,
        estoque_id: ID_336,
        tipo_origem: "embalado",
        volume_retirado: 1500,
        massa_retirada: 1950,
        lote: "2606180624",
      },
    ],
    destinos: [
      {
        tipo_embalagem: "Tankagem",
        tanka_id: ID_TANKA,
        tanka_codigo: "TANKA 46",
        volume: 4500,
        peso_liquido: 5850,
      },
    ],
  },
  {
    id: "op-t220",
    codigo_transbordo: "T220",
    created_at: "2026-10-29T10:00:00Z",
    densidade: DENS,
    origens: [
      {
        entrada_id: ID_TANKA,
        tipo_origem: "tanka",
        tanka_codigo: "TANKA 46",
        volume_retirado: 1500,
        massa_retirada: 1950,
        lote: "2609080977",
        lotes_retirados: [
          { lote: "2609080977", volume_retirado: 1500 },
        ],
      },
    ],
    destinos: [
      {
        placa: "17748-3",
        tipo_embalagem: "Vasilhame",
        volume: 1500,
        volume_total: 1500,
        peso_liquido: 1950,
        vasilhame_existente_id: "vas-t220",
      },
    ],
  },
];

const vasilhames = [tankOwnA, tankOwnB, tankT220, bombona];
const estoques = [estoque335, estoque336];

const ctx = createEstoqueSaldoContext(transbordos, [], vasilhames, [], estoques);
ctx.claimedLitersByVasilhameId.clear();

// 335: saldo livro 3724 — só os próprios tanques (não T220).
{
  const saldo = computeEstoqueSaldo(estoque335, transbordos, [], vasilhames, ctx);
  const locais = computeEstoqueQuantidadesPorLocal(estoque335, {
    transbordos,
    vasilhames,
    saidas: [],
    saldo,
    saldoCtx: ctx,
  });
  assert(
    Math.abs(locais.patio - 0.001) > 1e-9,
    `335 embalado residual 0,001 kg (veio ${locais.patio})`
  );
  // 2 tanques próprios (3900) ± bombona em embalado — sem T220 (1950 extra).
  assert(
    locais.vasilhames <= 3900 + 1,
    `335 tanque acima dos 2 tanques próprios: ${locais.vasilhames}`
  );
  assert(
    locais.vasilhames + locais.patio < 3900 + 182 + 1950 - 10,
    `335 suspeito de incluir T220: tanque=${locais.vasilhames} embalado=${locais.patio}`
  );
  console.log("335 ok", locais);
}

// 336: livro 0, mas T220 No Pátio com seu lote → Saldo Tanque 1950.
{
  const item336 = { ...estoque336, quantidade: 1950 };
  const saldo = 0;
  const locais = computeEstoqueQuantidadesPorLocal(item336, {
    transbordos,
    vasilhames,
    saidas: [],
    saldo,
    saldoCtx: ctx,
  });
  assert(
    Math.abs(locais.vasilhames - 1950) < 0.05,
    `336 deve ter Saldo Tanque 1950 (T220); veio ${locais.vasilhames}`
  );
  assert(locais.patio === 0, `336 embalado deve ser 0; veio ${locais.patio}`);
  console.log("336 ok", locais);
}

console.log("estoqueSaldo.o39.test.mjs: OK");
