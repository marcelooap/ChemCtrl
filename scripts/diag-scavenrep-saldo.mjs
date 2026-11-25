/**
 * Verifica saldos SCAVENREP O2BS (pátio 15×5000 = 75000 L).
 * Uso: npx vite-node scripts/diag-scavenrep-saldo.mjs
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
} = await import("../src/modules/transbordo/lib/estoqueSaldo.js");

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
const sb = createClient(url, key);

async function fetchAll(table, select, apply = (q) => q) {
  const rows = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
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
  "legacy_estoque_id,codigo_estoque,lote,saldo_inicial,unidade_medida,densidade,tipo_recebimento,embalado,legacy_entrada_id,id_entrada,produto_nome,cliente_nome,produto_codigo",
  (q) =>
    q
      .eq("origem", "ARMAZENAGEM")
      .ilike("produto_nome", "%SCAVEN%")
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

const transbordos = await fetchAll(
  "t_transbordos",
  "id,codigo_transbordo,data,created_at,origens,destinos,produto_nome,cliente_nome,densidade"
);
const vasilhames = await fetchAll(
  "t_vasilhames",
  "id,placa,tipo,status,volume,peso_liquido,capacidade,lote,produto_nome,cliente_nome,densidade,composicao,data_saida,barril,fracionado,transbordo_id,numero_op,codigo"
);

let saidas = [];
try {
  saidas = await fetchAll(
    "t_saidas",
    "id,codigo,enviado_ao_fiscal,cancelada,itens,cliente_nome,created_at,origem_modulo"
  );
} catch (e) {
  console.warn("saidas:", e.message);
}

const patio = (vasilhames || []).filter(
  (v) =>
    /scaven/i.test(String(v.produto_nome || "")) &&
    (v.status || "No Pátio") === "No Pátio" &&
    !v.data_saida &&
    (v.tipo || "") !== "Tankagem"
);
const patioVol = patio.reduce((s, v) => s + (Number(v.volume) || 0), 0);

const ctx = createEstoqueSaldoContext(transbordos, saidas, vasilhames, []);
ctx.claimedLitersByVasilhameId.clear();

const results = [];
for (const e of estoques) {
  const quantidade = getEstoqueQuantidade(e);
  const itemOp = { ...e, quantidade, unidade_medida: e.unidade_medida || "L" };
  const saldo = computeEstoqueSaldo(itemOp, transbordos, saidas, vasilhames, ctx);
  const locais = computeEstoqueQuantidadesPorLocal(itemOp, {
    transbordos,
    vasilhames,
    saidas,
    saldo,
    saldoCtx: ctx,
  });
  results.push({
    codigo: e.codigo_estoque,
    lote: e.lote,
    um: e.unidade_medida,
    dens: e.densidade,
    inicial: quantidade,
    saldo,
    embalado: locais.patio,
    tanque: locais.vasilhames,
    tanka: locais.tankas,
    total: locais.total,
  });
}

const sumTanque = results.reduce((s, r) => s + (Number(r.tanque) || 0), 0);
const sumTanka = results.reduce((s, r) => s + (Number(r.tanka) || 0), 0);
const sumEmbalado = results.reduce((s, r) => s + (Number(r.embalado) || 0), 0);
const sumTotal = results.reduce((s, r) => s + (Number(r.total) || 0), 0);

console.log(JSON.stringify(results.filter((r) => (r.tanque || 0) + (r.tanka || 0) + (r.embalado || 0) > 0.5), null, 2));
console.log({
  patioCount: patio.length,
  patioVol,
  sumTanque,
  sumTanka,
  sumEmbalado,
  sumTotal,
  gapTanqueVsPatio: Math.round((sumTanque - patioVol) * 1000) / 1000,
});

writeFileSync(
  resolve("scripts/diag-scavenrep-saldo-out.json"),
  JSON.stringify(
    { results, patioVol, patioCount: patio.length, sumTanque, sumTanka, sumEmbalado, sumTotal },
    null,
    2
  )
);
