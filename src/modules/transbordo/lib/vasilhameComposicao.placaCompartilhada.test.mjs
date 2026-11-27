/**
 * Regressão: vários tanques com a mesma placa (ex. "RETORNO IND.") não podem
 * herdar o volume/massa agregados dos destinos uns dos outros na listagem.
 *
 * Executar: npx vite-node src/modules/transbordo/lib/vasilhameComposicao.placaCompartilhada.test.mjs
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
  resolveVasilhameOperacionalPar,
  expectedVolumeFromDestinos,
  scopeTransbordosToVasilhameLinks,
} = await import("./vasilhameComposicao.js");
const { roundVolume } = await import("./format.js");

const dens = 1.11;
const placa = "RETORNO IND.";

const opA = {
  id: "op-a",
  codigo_transbordo: "OP-A",
  densidade: dens,
  destinos: [
    {
      tipo_embalagem: "Vasilhame",
      placa,
      volume: 5000,
      volume_total: 5000,
      peso_liquido: 5550,
      lote: "LOTE-A",
    },
  ],
};
const opB = {
  id: "op-b",
  codigo_transbordo: "OP-B",
  densidade: dens,
  destinos: [
    {
      tipo_embalagem: "Vasilhame",
      placa,
      volume: 7000,
      volume_total: 7000,
      peso_liquido: 7770,
      lote: "LOTE-B",
    },
  ],
};
const opC = {
  id: "op-c",
  codigo_transbordo: "OP-C",
  densidade: dens,
  destinos: [
    {
      tipo_embalagem: "Vasilhame",
      placa,
      volume: 7639.928,
      volume_total: 7639.928,
      peso_liquido: 8480.32,
      lote: "LOTE-C",
    },
  ],
};

const transbordos = [opA, opB, opC];

const tankA = {
  id: "va",
  codigo: "T514",
  tipo: "Vasilhame",
  placa,
  densidade: dens,
  numero_op: "OP-A",
  volume: 5000,
  peso_liquido: 5550,
  composicao: [
    {
      lote: "LOTE-A",
      quantidade_l: 5000,
      quantidade_kg: 5550,
      transbordo_codigo: "OP-A",
    },
  ],
};
const tankB = {
  id: "vb",
  codigo: "T469",
  tipo: "Vasilhame",
  placa,
  densidade: dens,
  numero_op: "OP-B",
  volume: 7000,
  peso_liquido: 7770,
  status: "Expedido",
  data_saida: "2026-11-24",
  composicao: [
    {
      lote: "LOTE-B",
      quantidade_l: 7000,
      quantidade_kg: 7770,
      transbordo_codigo: "OP-B",
    },
  ],
};
const tankC = {
  id: "vc",
  codigo: "T421",
  tipo: "Vasilhame",
  placa,
  densidade: dens,
  numero_op: "OP-C",
  volume: 7639.928,
  peso_liquido: 8480.32,
  status: "Expedido",
  data_saida: "2026-11-17",
  composicao: [
    {
      lote: "LOTE-C",
      quantidade_l: 7639.928,
      quantidade_kg: 8480.32,
      transbordo_codigo: "OP-C",
    },
  ],
};

const scopedA = scopeTransbordosToVasilhameLinks(tankA, transbordos);
assert(scopedA.length === 1 && scopedA[0].id === "op-a", "scope A deve ser só OP-A");

const expectedA = expectedVolumeFromDestinos(tankA, transbordos);
assert(
  Math.abs(roundVolume(expectedA.volume) - 5000) < 0.01,
  `expected A deve ser 5000 L, veio ${expectedA?.volume}`
);

const opARes = resolveVasilhameOperacionalPar(tankA, { transbordos });
const opBRes = resolveVasilhameOperacionalPar(tankB, { transbordos });
const opCRes = resolveVasilhameOperacionalPar(tankC, { transbordos });

assert(
  Math.abs(roundVolume(opARes.volume) - 5000) < 0.01,
  `operacional A deve ser 5000 L, veio ${opARes.volume}`
);
assert(
  Math.abs(roundVolume(opBRes.volume) - 7000) < 0.01,
  `operacional B deve ser 7000 L, veio ${opBRes.volume}`
);
assert(
  Math.abs(roundVolume(opCRes.volume) - 7639.928) < 0.01,
  `operacional C deve ser 7639.928 L, veio ${opCRes.volume}`
);

const somaErrada = 5000 + 7000 + 7639.928;
assert(
  Math.abs(roundVolume(opARes.volume) - somaErrada) > 1,
  "A não pode herdar a soma dos 3 tanques"
);
assert(
  Math.abs(roundVolume(opBRes.volume) - roundVolume(opARes.volume)) > 1,
  "A e B devem ter volumes distintos"
);
assert(
  Math.abs(roundVolume(opCRes.volume) - roundVolume(opBRes.volume)) > 1,
  "B e C devem ter volumes distintos"
);

console.log("ok: placa compartilhada não infla volume/massa operacional");
