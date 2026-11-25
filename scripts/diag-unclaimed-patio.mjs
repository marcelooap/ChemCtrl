/**
 * Lista tanques REPCLEAN no pátio e quanto o FIFO/claim deveria cobrir.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeTankaFifoVasilhameShares,
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
  .select("legacy_estoque_id,codigo_estoque,lote,saldo_inicial,saldo_final")
  .eq("origem", "ARMAZENAGEM")
  .ilike("produto_nome", "%REPCLEAN%")
  .not("legacy_estoque_id", "is", null);

const estById = Object.fromEntries(
  (estoques || []).map((e) => [e.legacy_estoque_id, e])
);

const { data: vas } = await sb
  .from("t_vasilhames")
  .select("*")
  .ilike("produto_nome", "%REPCLEAN%")
  .limit(500);

const patio = (vas || []).filter(
  (v) =>
    (v.status || "No Pátio") === "No Pátio" &&
    !v.data_saida &&
    (v.tipo || "") !== "Tankagem"
);

const { data: tbs } = await sb
  .from("t_transbordos")
  .select("id,codigo_transbordo,origens,destinos,created_at,data,densidade");

const shares = computeTankaFifoVasilhameShares(tbs || []);
const tbById = new Map((tbs || []).map((t) => [t.id, t]));
const byVas = new Map();
const merge = (id, map) => {
  let t = byVas.get(id);
  if (!t) {
    t = new Map();
    byVas.set(id, t);
  }
  for (const [k, v] of map) t.set(k, (t.get(k) || 0) + v);
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
  const placaKey = String(dest?.placa || placa || "")
    .trim()
    .toUpperCase();
  const v = patio.find(
    (x) =>
      String(x.placa || "").trim().toUpperCase() === placaKey &&
      (!x.transbordo_id || x.transbordo_id === tbId)
  ) || patio.find((x) => String(x.placa || "").trim().toUpperCase() === placaKey);
  if (v) merge(v.id, estMap);
}

const rows = patio.map((v) => {
  const fifo = byVas.get(v.id);
  const fifoSum = fifo
    ? [...fifo.values()].reduce((s, x) => s + x, 0)
    : 0;
  const stamps = (v.composicao || []).filter((c) => c.estoque_id);
  const stampSum = stamps.reduce((s, c) => s + (Number(c.quantidade_l) || 0), 0);
  const owners = fifo
    ? [...fifo.entries()].map(([id, vol]) => ({
        codigo: estById[id]?.codigo_estoque,
        loteEst: estById[id]?.lote,
        saldoFin: estById[id]?.saldo_final,
        vol: Math.round(vol * 1000) / 1000,
      }))
    : [];
  return {
    placa: v.placa,
    loteLabel: v.lote,
    vol: Number(v.volume) || 0,
    op: v.numero_op,
    fifoSum: Math.round(fifoSum * 1000) / 1000,
    stampSum,
    stampIds: stamps.map((c) => estById[c.estoque_id]?.codigo_estoque || c.estoque_id),
    owners,
    uncovered: Math.round(((Number(v.volume) || 0) - fifoSum) * 1000) / 1000,
  };
});

const uncovered = rows.filter((r) => r.uncovered > 1);
console.log("Uncovered tanks:", uncovered.length);
console.log(JSON.stringify(uncovered, null, 2));
console.log(
  "Total uncovered L:",
  uncovered.reduce((s, r) => s + r.uncovered, 0)
);
console.log(
  "Total fifo on patio:",
  rows.reduce((s, r) => s + r.fifoSum, 0)
);
console.log(
  "Total stamp-only (no fifo):",
  rows.filter((r) => r.fifoSum < 1).reduce((s, r) => s + r.vol, 0)
);

writeFileSync(
  resolve("scripts/diag-unclaimed-patio-out.json"),
  JSON.stringify({ rows, uncovered }, null, 2)
);
