/**
 * Verifica saldos REPCLEAN após correção FIFO tanka→pátio.
 * Uso: npx vite-node scripts/diag-estoque-repclean-saldo.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createEstoqueSaldoContext,
  computeEstoqueSaldo,
  computeEstoqueQuantidadesPorLocal,
  getEstoqueQuantidade,
} from "../src/modules/transbordo/lib/estoqueSaldo.js";

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

const targetCodes = new Set([625, 578, 549, 531, 522, 514, 194]);
const estoqueRows = await fetchAll(
  "estoque_produtos",
  "legacy_estoque_id,codigo_estoque,lote,saldo_inicial,unidade_medida,densidade,tipo_recebimento,embalado,legacy_entrada_id,id_entrada,produto_nome,cliente_nome,produto_codigo",
  (q) =>
    q
      .eq("origem", "ARMAZENAGEM")
      .ilike("produto_nome", "%REPCLEAN%")
      .not("legacy_estoque_id", "is", null)
);

const estoques = estoqueRows
  .filter((e) => targetCodes.has(Number(e.codigo_estoque)))
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
const sumTotal = results.reduce((s, r) => s + (Number(r.total) || 0), 0);
const row625 = results.find((r) => r.codigo === 625);

console.log(JSON.stringify(results, null, 2));
console.log({ sumTanque, sumTanka, sumTotal });
console.log("625:", row625);
console.log(
  "625 total≈31094?",
  row625 && Math.abs(Number(row625.total) - 31094) < 1
);
console.log("tanque≈125000?", Math.abs(sumTanque - 125000) < 2);

writeFileSync(
  resolve("scripts/diag-estoque-repclean-saldo-out.json"),
  JSON.stringify({ results, sumTanque, sumTanka, sumTotal, row625 }, null, 2)
);
