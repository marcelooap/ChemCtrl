/**
 * Diagnóstico SCAVENREP O2BS — pátio vs FIFO vs saldos.
 * Uso: npx vite-node scripts/diag-scavenrep.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeTankaFifoVasilhameShares,
  computeTankaRemainingByEstoqueId,
  tankaFifoDestinoShareKey,
} from "../src/modules/transbordo/lib/tankaVolume.js";

function loadEnv(filePath) {
  const env = {};
  try {
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      let k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      )
        v = v.slice(1, -1);
      env[k] = v;
    }
  } catch {}
  return env;
}
const env = { ...loadEnv(resolve(".env")), ...loadEnv(resolve(".env.local")) };
const url = (env.VITE_CHEMFLOW_SUPABASE_URL || "")
  .replace(/\/+$/, "")
  .replace(/\/rest\/v1$/i, "");
const sb = createClient(url, env.VITE_CHEMFLOW_SUPABASE_ANON_KEY);

const { data: estoques } = await sb
  .from("estoque_produtos")
  .select(
    "legacy_estoque_id,codigo_estoque,lote,saldo_inicial,saldo_final,unidade_medida,densidade,tipo_recebimento,embalado,produto_nome,cliente_nome,produto_codigo"
  )
  .eq("origem", "ARMAZENAGEM")
  .ilike("produto_nome", "%SCAVEN%")
  .not("legacy_estoque_id", "is", null)
  .order("codigo_estoque", { ascending: false });

console.log(
  "Estoques:",
  (estoques || []).map((e) => ({
    codigo: e.codigo_estoque,
    lote: e.lote,
    ini: e.saldo_inicial,
    fin: e.saldo_final,
    um: e.unidade_medida,
    dens: e.densidade,
    tipo: e.tipo_recebimento,
    prod: e.produto_nome,
  }))
);

const { data: vas } = await sb
  .from("t_vasilhames")
  .select("*")
  .ilike("produto_nome", "%SCAVEN%")
  .limit(500);

const patio = (vas || []).filter(
  (v) =>
    (v.status || "No Pátio") === "No Pátio" &&
    !v.data_saida &&
    (v.tipo || "") !== "Tankagem"
);
const tankagem = (vas || []).filter(
  (v) =>
    (v.tipo || "") === "Tankagem" &&
    (v.status || "No Pátio") === "No Pátio" &&
    !v.data_saida
);

const patioVol = patio.reduce((s, v) => s + (Number(v.volume) || 0), 0);
console.log({
  patioCount: patio.length,
  patioVol,
  tankagemCount: tankagem.length,
  tankagemVol: tankagem.reduce((s, v) => s + (Number(v.volume) || 0), 0),
  byLote: patio.reduce((acc, v) => {
    const l = v.lote || "?";
    acc[l] = acc[l] || { n: 0, vol: 0 };
    acc[l].n += 1;
    acc[l].vol += Number(v.volume) || 0;
    return acc;
  }, {}),
});

const { data: tbs } = await sb
  .from("t_transbordos")
  .select("id,codigo_transbordo,origens,destinos,created_at,data,densidade,produto_nome");

const relevantTb = (tbs || []).filter((t) =>
  /scaven/i.test(JSON.stringify(t))
);
console.log("OPs scaven:", relevantTb.length, relevantTb.map((t) => t.codigo_transbordo));

const shares = computeTankaFifoVasilhameShares(tbs || []);
const tbById = new Map((tbs || []).map((t) => [t.id, t]));
const patioByPlaca = new Map(
  patio.map((v) => [String(v.placa || "").trim().toUpperCase(), v])
);
const byVas = new Map();
const merge = (id, map) => {
  let t = byVas.get(id);
  if (!t) {
    t = new Map();
    byVas.set(id, t);
  }
  for (const [k, v] of map) t.set(k, (t.get(k) || 0) + Number(v) || 0);
};

for (const [key, estMap] of shares) {
  const [tbId, vasEx, placa] = String(key).split("|");
  if (vasEx) {
    merge(vasEx, estMap);
    continue;
  }
  const t = tbById.get(tbId);
  const dest = (t?.destinos || []).find(
    (d) => tankaFifoDestinoShareKey(t.id, d) === key
  );
  const pk = String(dest?.placa || placa || "")
    .trim()
    .toUpperCase();
  const v =
    patio.find(
      (x) =>
        String(x.placa || "").trim().toUpperCase() === pk &&
        (!x.transbordo_id || x.transbordo_id === tbId)
    ) || patioByPlaca.get(pk);
  if (v) merge(v.id, estMap);
}

const estById = Object.fromEntries(
  (estoques || []).map((e) => [e.legacy_estoque_id, e])
);

let fifoPatio = 0;
const perEst = new Map();
for (const [vasId, byEst] of byVas) {
  const v = patio.find((x) => x.id === vasId);
  if (!v) continue;
  for (const [estId, vol] of byEst) {
    fifoPatio += vol;
    perEst.set(estId, (perEst.get(estId) || 0) + vol);
  }
}

// tankagem remaining
const tankaIds = new Set();
for (const t of tbs || []) {
  if (!/scaven/i.test(JSON.stringify(t))) continue;
  for (const d of t.destinos || []) {
    if (d.tipo_embalagem === "Tankagem" && d.tanka_id) tankaIds.add(d.tanka_id);
  }
}
const remTanka = new Map();
for (const tid of tankaIds) {
  const rem = computeTankaRemainingByEstoqueId({
    isotanqueId: tid,
    tankaCodigo: "",
    transbordos: tbs || [],
  });
  for (const [id, vol] of rem) {
    if (!estById[id]) continue;
    remTanka.set(id, (remTanka.get(id) || 0) + vol);
  }
}

const summary = (estoques || []).map((e) => ({
  codigo: e.codigo_estoque,
  lote: e.lote,
  ini: e.saldo_inicial,
  fin: e.saldo_final,
  um: e.unidade_medida,
  dens: e.densidade,
  tanqueFifo: Math.round((perEst.get(e.legacy_estoque_id) || 0) * 1000) / 1000,
  tankaRem: Math.round((remTanka.get(e.legacy_estoque_id) || 0) * 1000) / 1000,
}));

console.log("Per estoque FIFO:", summary);
console.log({
  fifoPatio,
  patioVol,
  gap: patioVol - fifoPatio,
  sumTanqueFifo: summary.reduce((s, r) => s + r.tanqueFifo, 0),
  sumTanka: summary.reduce((s, r) => s + r.tankaRem, 0),
});

// tanks without fifo
const uncovered = patio
  .map((v) => {
    const fifo = byVas.get(v.id);
    const fifoSum = fifo
      ? [...fifo.values()].reduce((s, x) => s + x, 0)
      : 0;
    const stamps = (v.composicao || []).filter((c) => c.estoque_id);
    return {
      placa: v.placa,
      lote: v.lote,
      vol: Number(v.volume) || 0,
      op: v.numero_op,
      fifoSum,
      stamps: stamps.map((c) => ({
        codigo: estById[c.estoque_id]?.codigo_estoque,
        qL: c.quantidade_l,
        lote: c.lote,
      })),
      uncovered: Math.round((Number(v.volume) - fifoSum) * 1000) / 1000,
    };
  })
  .filter((r) => r.uncovered > 1);

console.log("Uncovered:", uncovered);

writeFileSync(
  resolve("scripts/diag-scavenrep-out.json"),
  JSON.stringify({ summary, patioVol, fifoPatio, uncovered, patio, tankagem }, null, 2)
);
