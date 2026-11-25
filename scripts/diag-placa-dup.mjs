import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
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

const { data: vas } = await sb
  .from("t_vasilhames")
  .select("id,placa,status,volume,lote,transbordo_id,numero_op,data_saida,produto_nome")
  .ilike("produto_nome", "%REPCLEAN%")
  .limit(500);

const byPlaca = new Map();
for (const v of vas || []) {
  const k = String(v.placa || "").trim().toUpperCase();
  if (!k) continue;
  if (!byPlaca.has(k)) byPlaca.set(k, []);
  byPlaca.get(k).push(v);
}

const dups = [...byPlaca.entries()].filter(([, list]) => list.length > 1);
console.log("Placas com mais de 1 registro:", dups.length);
for (const [placa, list] of dups.slice(0, 30)) {
  console.log(
    placa,
    list.map((v) => ({
      id: v.id.slice(0, 8),
      status: v.status,
      vol: v.volume,
      op: v.numero_op,
      tb: v.transbordo_id?.slice(0, 8),
      saida: v.data_saida,
    }))
  );
}

// Check 29074-6 specifically
console.log("\n29074-6 all:", byPlaca.get("29074-6"));

const { data: tbs } = await sb
  .from("t_transbordos")
  .select("id,codigo_transbordo,origens,destinos,created_at,data,densidade")
  .order("created_at", { ascending: false })
  .limit(2000);

const shares = computeTankaFifoVasilhameShares(tbs || []);
const key = [...shares.keys()].find((k) => k.includes("29074-6"));
console.log("\nShare key 29074-6:", key, shares.get(key));

// Simulate resolveVasilhameFromDestino bug
const t477 = (tbs || []).find((t) => t.codigo_transbordo === "T477");
const destino = (t477?.destinos || []).find((d) => d.placa === "29074-6");
const candidates = byPlaca.get("29074-6") || [];
const buggyPick = candidates.find((v) => {
  if (t477?.id && v.transbordo_id && v.transbordo_id !== t477.id) return false;
  return true;
});
const goodPick = candidates.find(
  (v) =>
    (v.status || "No Pátio") === "No Pátio" &&
    !v.data_saida &&
    (!v.transbordo_id || v.transbordo_id === t477?.id)
);
console.log("\nbuggyPick", buggyPick);
console.log("goodPick", goodPick);
console.log("destino", destino);
