/**
 * Audita gap Tanque vs pátio REPCLEAN (só tankaVolume + dados).
 * Uso: npx vite-node scripts/diag-estoque-tanque-gap.mjs
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

const estoques = await fetchAll(
  "estoque_produtos",
  "legacy_estoque_id,codigo_estoque,lote,saldo_inicial,saldo_final,unidade_medida,densidade,tipo_recebimento",
  (q) =>
    q
      .eq("origem", "ARMAZENAGEM")
      .ilike("produto_nome", "%REPCLEAN%")
      .not("legacy_estoque_id", "is", null)
);

const transbordos = await fetchAll(
  "t_transbordos",
  "id,codigo_transbordo,data,created_at,origens,destinos,produto_nome,densidade"
);
const vasilhames = await fetchAll(
  "t_vasilhames",
  "id,placa,tipo,status,volume,peso_liquido,lote,produto_nome,composicao,data_saida,barril,transbordo_id,numero_op"
);

const patio = vasilhames.filter(
  (v) =>
    /repclean/i.test(v.produto_nome || "") &&
    (v.status || "No Pátio") === "No Pátio" &&
    !v.data_saida &&
    (v.tipo || "") !== "Tankagem"
);
const patioVol = patio.reduce((s, v) => s + (Number(v.volume) || 0), 0);
const patioById = new Map(patio.map((v) => [v.id, v]));
const patioByPlaca = new Map(patio.map((v) => [String(v.placa || "").trim().toUpperCase(), v]));
const tbById = new Map(transbordos.map((t) => [t.id, t]));

const shares = computeTankaFifoVasilhameShares(transbordos);

// Index shares → vasilhame_id (mesma lógica do estoqueSaldo)
const byVasId = new Map();
const unresolved = [];
const merge = (vasId, estMap) => {
  if (!vasId) return;
  let t = byVasId.get(vasId);
  if (!t) {
    t = new Map();
    byVasId.set(vasId, t);
  }
  for (const [estId, vol] of estMap) {
    t.set(estId, (t.get(estId) || 0) + (Number(vol) || 0));
  }
};

for (const [destinoKey, estMap] of shares) {
  const [transbordoId, vasExistenteId, placa] = String(destinoKey).split("|");
  if (vasExistenteId && patioById.has(vasExistenteId)) {
    merge(vasExistenteId, estMap);
    continue;
  }
  const t = tbById.get(transbordoId);
  if (!t) {
    unresolved.push({ destinoKey, reason: "no-tb" });
    continue;
  }
  const destino = (t.destinos || []).find(
    (d) => tankaFifoDestinoShareKey(t.id, d) === destinoKey
  );
  if (!destino) {
    unresolved.push({ destinoKey, reason: "no-destino" });
    continue;
  }
  // resolve like estoqueSaldo: placa + same OP
  const placaKey = String(destino.placa || "").trim().toUpperCase();
  let v =
    patio.find(
      (x) =>
        x.transbordo_id === t.id &&
        String(x.placa || "").trim().toUpperCase() === placaKey
    ) || patioByPlaca.get(placaKey);
  if (v) merge(v.id, estMap);
  else unresolved.push({ destinoKey, placa: destino.placa, op: t.codigo_transbordo, reason: "no-vas" });
}

// Soma shares indexadas no pátio
let indexedShareVol = 0;
const ownerOfVas = new Map(); // vasId → [[estId, vol]]
for (const [vasId, byEst] of byVasId) {
  if (!patioById.has(vasId)) continue;
  let sum = 0;
  for (const [, vol] of byEst) sum += vol;
  indexedShareVol += sum;
  ownerOfVas.set(vasId, [...byEst.entries()]);
}

console.log({
  patioCount: patio.length,
  patioVol,
  shareKeys: shares.size,
  indexedVas: byVasId.size,
  indexedShareVol,
  unresolved: unresolved.length,
});
if (unresolved.length) console.log("unresolved sample", unresolved.slice(0, 20));

// Tanques do pátio SEM share FIFO e SEM estoque_id na composição
const orphans = [];
for (const v of patio) {
  const fifo = byVasId.get(v.id);
  const stamps = (v.composicao || []).filter((c) => c.estoque_id || c.entrada_id);
  const fifoVol = fifo
    ? [...fifo.values()].reduce((s, x) => s + x, 0)
    : 0;
  orphans.push({
    placa: v.placa,
    lote: v.lote,
    vol: Number(v.volume) || 0,
    op: v.numero_op,
    fifoVol: Math.round(fifoVol * 1000) / 1000,
    fifoOwners: fifo ? [...fifo.entries()].map(([id, vol]) => {
      const est = estoques.find((e) => e.legacy_estoque_id === id);
      return { codigo: est?.codigo_estoque, lote: est?.lote, vol };
    }) : [],
    stamps: stamps.map((c) => ({
      estoque_id: c.estoque_id,
      lote: c.lote,
      qL: c.quantidade_l,
    })),
    gap: Math.round(((Number(v.volume) || 0) - fifoVol) * 1000) / 1000,
  });
}

const withGap = orphans.filter((o) => o.gap > 1 || o.fifoVol < 1);
console.log("\nTanks with fifo gap or no fifo:");
console.log(JSON.stringify(withGap, null, 2));

const sumFifoOnPatio = orphans.reduce((s, o) => s + o.fifoVol, 0);
const sumGap = orphans.reduce((s, o) => s + Math.max(0, o.gap), 0);
console.log({ sumFifoOnPatio, sumGap, expectPatio: patioVol });

// Remaining tankagem by estoque for REPCLEAN tankas
const tankaIds = new Set();
for (const t of transbordos) {
  for (const d of t.destinos || []) {
    if (d.tipo_embalagem === "Tankagem" && d.tanka_id) tankaIds.add(d.tanka_id);
  }
}
const remByEst = new Map();
for (const tid of tankaIds) {
  const rem = computeTankaRemainingByEstoqueId({
    isotanqueId: tid,
    tankaCodigo: "",
    transbordos,
  });
  for (const [estId, vol] of rem) {
    remByEst.set(estId, (remByEst.get(estId) || 0) + vol);
  }
}

const estMeta = Object.fromEntries(
  estoques.map((e) => [
    e.legacy_estoque_id,
    { codigo: e.codigo_estoque, lote: e.lote, saldo: e.saldo_inicial },
  ])
);

const expectedLocais = [];
for (const e of estoques) {
  const id = e.legacy_estoque_id;
  const tanka = remByEst.get(id) || 0;
  let tanque = 0;
  for (const [, byEst] of byVasId) {
    tanque += byEst.get(id) || 0;
  }
  // também lotes sem fifo: tanques com mesmo lote e sem fifo share
  let legado = 0;
  for (const o of orphans) {
    if (o.fifoVol > 0) continue;
    if (String(o.lote || "").toUpperCase() === String(e.lote || "").toUpperCase()) {
      legado += o.vol;
    }
  }
  const total = tanque + tanka;
  if (total > 0 || legado > 0 || e.saldo_final > 0) {
    expectedLocais.push({
      codigo: e.codigo_estoque,
      lote: e.lote,
      saldo_ini: e.saldo_inicial,
      saldo_fin_db: e.saldo_final,
      tanqueFifo: Math.round(tanque * 1000) / 1000,
      tanqueLegadoLote: legado,
      tanka,
      totalFifo: Math.round((tanque + tanka) * 1000) / 1000,
    });
  }
}

console.log("\nExpected by estoque (FIFO):");
console.log(JSON.stringify(expectedLocais.filter((r) => r.totalFifo > 0 || r.tanqueLegadoLote > 0), null, 2));
const sumTanqueFifo = expectedLocais.reduce((s, r) => s + r.tanqueFifo, 0);
const sumLegado = expectedLocais.reduce((s, r) => s + r.tanqueLegadoLote, 0);
console.log({
  sumTanqueFifo,
  sumLegado,
  sumTanqueIfBoth: sumTanqueFifo + sumLegado,
  patioVol,
  userReportedTanque: 120585.57,
  gapVsUser: 125000 - 120585.57,
});

writeFileSync(
  resolve("scripts/diag-estoque-tanque-gap-out.json"),
  JSON.stringify(
    { patioVol, withGap, expectedLocais, sumTanqueFifo, sumLegado, unresolved },
    null,
    2
  )
);
