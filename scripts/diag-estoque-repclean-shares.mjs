/**
 * Verifica computeTankaFifoVasilhameShares.
 * Uso: npx vite-node scripts/diag-estoque-repclean-shares.mjs
 */
globalThis.window = globalThis.window || {
  location: { href: "http://localhost/", pathname: "/" },
};
globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeTankaFifoVasilhameShares,
  computeTankaRemainingByEstoqueId,
} from "../src/modules/transbordo/lib/tankaVolume.js";

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

async function fetchAll(table, select) {
  const rows = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const { data, error } = await sb
      .from(table)
      .select(select)
      .range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const transbordos = await fetchAll(
  "t_transbordos",
  "id,codigo_transbordo,data,created_at,origens,destinos,produto_nome,densidade"
);

const ID625 = "2ee7ca48-a5b7-456b-ba9f-ecef893c8e69";
const ID578 = "e2ab057f-1e55-4a62-b883-675a7837e168";
const TANKA_32 = "23fec488-0726-4c02-8d8f-dbb2b069c0f6";
const TANKA_34 = "f4663c05-19c8-47da-8099-544fcc35b6b7";

const rem32 = computeTankaRemainingByEstoqueId({
  isotanqueId: TANKA_32,
  tankaCodigo: "TANKA 32",
  transbordos,
});
const rem34 = computeTankaRemainingByEstoqueId({
  isotanqueId: TANKA_34,
  tankaCodigo: "TANKA 34",
  transbordos,
});

const shares = computeTankaFifoVasilhameShares(transbordos);
const shares625 = [];
const shares578 = [];
for (const [key, byEst] of shares) {
  for (const [estId, vol] of byEst) {
    if (estId === ID625 && vol > 0) shares625.push({ key, vol });
    if (estId === ID578 && vol > 0) shares578.push({ key, vol });
  }
}

const tanka625 =
  (rem32.get(ID625) || 0) + (rem34.get(ID625) || 0);
const patio625 = shares625.reduce((s, x) => s + x.vol, 0);
const patio578 = shares578.reduce((s, x) => s + x.vol, 0);

console.log("Tanka remaining 625:", tanka625);
console.log("Patio shares 625:", patio625, shares625);
console.log("625 tanka+patio:", tanka625 + patio625, "(esperado 31094)");
console.log("Patio shares 578 total:", patio578);

const key29074 = [...shares.keys()].find((k) => k.includes("29074-6"));
console.log("Shares on 29074-6:", key29074, [...(shares.get(key29074) || [])]);

writeFileSync(
  resolve("scripts/diag-estoque-repclean-shares-out.json"),
  JSON.stringify(
    {
      tanka625,
      patio625,
      total625: tanka625 + patio625,
      shares625,
      patio578,
      rem32: [...rem32.entries()],
      rem34: [...rem34.entries()],
    },
    null,
    2
  )
);
