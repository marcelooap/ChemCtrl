/**
 * Diagnóstico SISBRAX SCAVE O-39 + item estoque 335.
 * Uso: npx vite-node scripts/diag-o39-335.mjs
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

const { createClient } = await import("@supabase/supabase-js");
const { readFileSync, writeFileSync } = await import("node:fs");
const { resolve } = await import("node:path");
const {
  createEstoqueSaldoContext,
  computeEstoqueSaldo,
  computeEstoqueQuantidadesPorLocal,
  getEstoqueQuantidade,
  getEstoqueUnidadeEntrada,
} = await import("../src/modules/transbordo/lib/estoqueSaldo.js");
const { isVasilhameLegadoEmbalado } = await import(
  "../src/modules/transbordo/lib/tiposEmbalagem.js"
);

function loadEnv(filePath) {
  const env = {};
  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    // ignore
  }
  return env;
}

const env = {
  ...loadEnv(resolve(".env")),
  ...loadEnv(resolve(".env.local")),
};
const url = (env.VITE_CHEMFLOW_SUPABASE_URL || env.VITE_SUPABASE_URL || "")
  .replace(/\/+$/, "")
  .replace(/\/rest\/v1$/i, "");
const key =
  env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Missing Supabase URL/key");
  process.exit(1);
}
const sb = createClient(url, key);

async function fetchAll(table, select, apply = (q) => q) {
  const rows = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    let q = sb.from(table).select(select).range(offset, offset + 999);
    q = apply(q);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const estoqueRows = await fetchAll(
  "estoque_produtos",
  "legacy_estoque_id,codigo_estoque,lote,saldo_inicial,saldo_final,unidade_medida,densidade,tipo_recebimento,embalado,legacy_entrada_id,id_entrada,produto_nome,cliente_nome,produto_codigo",
  (q) =>
    q
      .eq("origem", "ARMAZENAGEM")
      .or("produto_nome.ilike.%O-39%,produto_nome.ilike.%SCAVE O%,codigo_estoque.eq.335")
      .not("legacy_estoque_id", "is", null)
);

const estoques = estoqueRows
  .map((row) => ({
    id: row.legacy_estoque_id,
    codigo_estoque: row.codigo_estoque,
    entrada_id: row.legacy_entrada_id,
    entrada_codigo: row.id_entrada,
    produto_nome: row.produto_nome,
    produto_codigo: row.produto_codigo,
    cliente_nome: row.cliente_nome,
    lote: row.lote,
    densidade: row.densidade,
    saldo_inicial: row.saldo_inicial,
    saldo_final: row.saldo_final,
    quantidade: row.saldo_inicial,
    unidade_medida: row.unidade_medida,
    embalado: row.embalado,
    tipo_recebimento: row.tipo_recebimento,
    lotes: [
      {
        lote: row.lote,
        densidade: row.densidade,
        quantidade: row.saldo_inicial,
        unidade_medida: row.unidade_medida,
        tipo_recebimento: row.tipo_recebimento,
        embalado: row.embalado,
      },
    ],
  }))
  .sort((a, b) => Number(a.codigo_estoque) - Number(b.codigo_estoque));

const item335 = estoques.filter((e) => Number(e.codigo_estoque) === 335);
const o39 = estoques.filter((e) =>
  /o-39|scave o/i.test(String(e.produto_nome || ""))
);

const transbordos = await fetchAll(
  "t_transbordos",
  "id,codigo_transbordo,data,created_at,origens,destinos,produto_nome,cliente_nome,densidade"
);
const vasilhames = await fetchAll(
  "t_vasilhames",
  "id,placa,tipo,status,volume,peso_liquido,capacidade,lote,produto_nome,cliente_nome,densidade,composicao,data_saida,barril,fracionado,transbordo_id,numero_op,codigo"
);

// Saídas omitidas neste diag rápido — o gap Tanque×pátio e o 0,001 kg
// reproduzem sem o ledger fiscal.
const saidas = [];

const patioO39 = (vasilhames || []).filter(
  (v) =>
    /o-39|scave o/i.test(String(v.produto_nome || "")) &&
    (v.status || "No Pátio") === "No Pátio" &&
    !v.data_saida
);

const patioO39NoTanka = patioO39.filter((v) => (v.tipo || "") !== "Tankagem");
const patioVol = patioO39NoTanka.reduce(
  (s, v) => s + (Number(v.volume) || 0),
  0
);
const patioTanqueVol = patioO39NoTanka
  .filter((v) => !isVasilhameLegadoEmbalado(v.tipo || ""))
  .reduce((s, v) => s + (Number(v.volume) || 0), 0);
const patioBombonaVol = patioO39NoTanka
  .filter((v) => isVasilhameLegadoEmbalado(v.tipo || ""))
  .reduce((s, v) => s + (Number(v.volume) || 0), 0);

const targets = [...new Map([...o39, ...item335].map((e) => [e.id, e])).values()];

// Ordem da tela de Estoque: codigo_estoque ascendente
targets.sort((a, b) => Number(a.codigo_estoque) - Number(b.codigo_estoque));

const ctx = createEstoqueSaldoContext(
  transbordos,
  saidas,
  vasilhames,
  [],
  targets
);
ctx.claimedLitersByVasilhameId.clear();

const results = [];
for (const e of targets) {
  const quantidade = getEstoqueQuantidade(e);
  const itemOp = { ...e, quantidade, unidade_medida: e.unidade_medida || "L" };
  const saldo = computeEstoqueSaldo(itemOp, transbordos, saidas, vasilhames, ctx);
  const claimedBefore = Object.fromEntries(ctx.claimedLitersByVasilhameId);
  const locais = computeEstoqueQuantidadesPorLocal(itemOp, {
    transbordos,
    vasilhames,
    saidas,
    saldo,
    saldoCtx: ctx,
  });
  const claimedAfter = Object.fromEntries(ctx.claimedLitersByVasilhameId);
  const claimedDelta = {};
  for (const [id, lit] of Object.entries(claimedAfter)) {
    const d = (Number(lit) || 0) - (Number(claimedBefore[id]) || 0);
    if (Math.abs(d) > 1e-9) {
      const v = patioO39NoTanka.find((x) => x.id === id);
      claimedDelta[id] = {
        litros: d,
        placa: v?.placa,
        tipo: v?.tipo,
        lote: v?.lote,
        volume: v?.volume,
      };
    }
  }
  results.push({
    codigo: e.codigo_estoque,
    produto: e.produto_nome,
    cliente: e.cliente_nome,
    lote: e.lote,
    um: getEstoqueUnidadeEntrada(e),
    dens: e.densidade,
    tipo: e.tipo_recebimento,
    embaladoFlag: e.embalado,
    inicial: quantidade,
    saldo_final_db: e.saldo_final,
    saldo,
    embalado: locais.patio,
    tanque: locais.vasilhames,
    tanka: locais.tankas,
    total: locais.total,
    claimedDelta,
  });
}

const o39Results = results.filter((r) =>
  /o-39|scave o/i.test(String(r.produto || ""))
);
const sumTanque = o39Results.reduce((s, r) => s + (Number(r.tanque) || 0), 0);
const sumEmbalado = o39Results.reduce((s, r) => s + (Number(r.embalado) || 0), 0);
const sumTanka = o39Results.reduce((s, r) => s + (Number(r.tanka) || 0), 0);

const out = {
  patioO39: {
    count: patioO39NoTanka.length,
    rows: patioO39NoTanka.map((v) => ({
      placa: v.placa,
      tipo: v.tipo,
      volume: v.volume,
      peso: v.peso_liquido,
      lote: v.lote,
      dens: v.densidade,
      op: v.numero_op,
    })),
    patioVol,
    patioTanqueVol,
    patioBombonaVol,
  },
  results,
  o39Summary: {
    sumTanque,
    sumEmbalado,
    sumTanka,
    patioVol,
    patioTanqueVol,
    gapTanqueVsPatioVol: Math.round((sumTanque - patioVol) * 1000) / 1000,
    gapTanqueVsPatioTanque:
      Math.round((sumTanque - patioTanqueVol) * 1000) / 1000,
  },
  item335: results.filter((r) => Number(r.codigo) === 335),
};

console.log(JSON.stringify(out, null, 2));
writeFileSync(resolve("scripts/diag-o39-335-out.json"), JSON.stringify(out, null, 2));
