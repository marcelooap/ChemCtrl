/**
 * Parte 2: transbordos, tankagem e atribuição de vasilhames REPCLEAN.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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

const ESTOQUE_ID_625 = "2ee7ca48-a5b7-456b-ba9f-ecef893c8e69";
const ENTRADA_625 = "19756465-fef7-4ffc-bb96-d213930df52f";
const LOTE_625 = "OF-1504-26";

const targetCodes = [625, 578, 549, 531, 522, 514, 194];
const { data: estoques } = await sb
  .from("estoque_produtos")
  .select(
    "legacy_estoque_id,codigo_estoque,lote,saldo_inicial,saldo_final,unidade_medida,densidade,tipo_recebimento,legacy_entrada_id,id_entrada"
  )
  .eq("origem", "ARMAZENAGEM")
  .ilike("produto_nome", "%REPCLEAN%")
  .in("codigo_estoque", targetCodes);

const legacyByCode = Object.fromEntries(
  (estoques || []).map((e) => [e.codigo_estoque, e])
);
const legacyIds = (estoques || []).map((e) => String(e.legacy_estoque_id));
const lotes = (estoques || []).map((e) => e.lote);

console.log("estoques", legacyByCode);

// Vasilhames pátio
const { data: vas } = await sb
  .from("t_vasilhames")
  .select("*")
  .ilike("produto_nome", "%REPCLEAN%")
  .limit(300);

const patio = (vas || []).filter(
  (v) =>
    (v.status || "No Pátio") === "No Pátio" &&
    (v.data_saida == null || String(v.data_saida).trim() === "")
);

const byLote = {};
for (const v of patio) {
  const l = v.lote || "?";
  byLote[l] = byLote[l] || { count: 0, vol: 0, placas: [] };
  byLote[l].count += 1;
  byLote[l].vol += Number(v.volume) || 0;
  byLote[l].placas.push(v.placa);
}
console.log("\nVasilhames por lote:", byLote);
console.log(
  "Total pátio",
  patio.length,
  patio.reduce((s, v) => s + (Number(v.volume) || 0), 0)
);

// Tankagens
const { data: tankas } = await sb
  .from("t_vasilhames")
  .select("*")
  .eq("tipo", "Tankagem")
  .ilike("produto_nome", "%REPCLEAN%")
  .limit(100);
console.log(
  "\nTankagens REPCLEAN:",
  (tankas || []).map((t) => ({
    placa: t.placa,
    status: t.status,
    volume: t.volume,
    lote: t.lote,
    data_saida: t.data_saida,
    composicao: t.composicao,
  }))
);

// Transbordos — page through
const allTb = [];
for (let offset = 0; offset < 5000; offset += 1000) {
  const { data, error } = await sb
    .from("t_transbordos")
    .select("id,codigo_transbordo,data,created_at,origens,destinos,produto_nome,cliente_nome")
    .order("created_at", { ascending: false })
    .range(offset, offset + 999);
  if (error) {
    console.error("tb error", error);
    break;
  }
  allTb.push(...(data || []));
  if (!data || data.length < 1000) break;
}

const relevant = allTb.filter((t) => {
  const blob = JSON.stringify(t);
  if (/repclean/i.test(blob)) return true;
  if (blob.includes(ESTOQUE_ID_625) || blob.includes(ENTRADA_625)) return true;
  if (blob.includes(LOTE_625)) return true;
  return legacyIds.some((id) => blob.includes(id)) || lotes.some((l) => blob.includes(l));
});

const for625 = allTb.filter((t) => {
  const blob = JSON.stringify(t);
  return (
    blob.includes(ESTOQUE_ID_625) ||
    blob.includes(ENTRADA_625) ||
    blob.includes(LOTE_625)
  );
});

console.log("\nTB total scanned", allTb.length, "relevant", relevant.length, "for625", for625.length);

function summarizeTb(t) {
  return {
    codigo: t.codigo_transbordo,
    data: t.data || t.created_at,
    origens: (t.origens || []).map((o) => ({
      tipo: o.tipo || o.tipo_origem || o.tipo_embalagem,
      estoque_id: o.estoque_id,
      entrada_id: o.entrada_id,
      lote: o.lote,
      vol: o.volume_retirado ?? o.volume,
      lotes_retirados: o.lotes_retirados,
      tanka: o.tanka_codigo || o.placa,
    })),
    destinos: (t.destinos || []).map((d) => ({
      tipo: d.tipo_embalagem,
      placa: d.placa || d.tanka_codigo,
      vol: d.volume_total ?? d.volume,
      vas_id: d.vasilhame_existente_id,
      tanka_id: d.tanka_id,
      fracionado: d.fracionado,
    })),
  };
}

console.log("\n=== TB 625 ===");
console.log(JSON.stringify(for625.map(summarizeTb), null, 2));

// Saídas
const allSaidas = [];
for (let offset = 0; offset < 5000; offset += 1000) {
  const { data, error } = await sb
    .from("t_saidas")
    .select(
      "id,codigo_saida,enviado_ao_fiscal,cancelada,cancelamento_em,itens,cliente_nome,created_at"
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + 999);
  if (error) {
    console.error("saida error", error);
    break;
  }
  allSaidas.push(...(data || []));
  if (!data || data.length < 1000) break;
}

const saidas625 = allSaidas.filter((s) => {
  const blob = JSON.stringify(s);
  return (
    blob.includes(ESTOQUE_ID_625) ||
    blob.includes(LOTE_625) ||
    /repclean/i.test(blob)
  );
});

console.log("\n=== SAIDAS REPCLEAN/625 ===", saidas625.length);
console.log(
  JSON.stringify(
    saidas625.map((s) => ({
      codigo: s.codigo_saida,
      fiscal: s.enviado_ao_fiscal,
      cancelada: s.cancelada,
      itens: (s.itens || []).map((i) => ({
        tipo: i.tipo,
        lote: i.lote,
        produto: i.produto_nome,
        vol: i.volume_solicitado,
        qtd: i.quantidade_solicitada,
        vas: i.vasilhame_id || i.placa,
        validado: i.validado,
        estoque_id: i.estoque_id,
        estoque_ids: i.estoque_ids,
      })),
    })),
    null,
    2
  )
);

// cadastro_tanka?
const { data: isotanques, error: isoErr } = await sb
  .from("cadastro_tanka")
  .select("id,codigo,capacidade,produto_nome,cliente_nome,status")
  .ilike("produto_nome", "%REPCLEAN%")
  .limit(50);
console.log("\nisotanques err", isoErr?.message);
console.log("isotanques", isotanques);

const out = {
  legacyByCode,
  byLote,
  patioCount: patio.length,
  patioVol: patio.reduce((s, v) => s + (Number(v.volume) || 0), 0),
  tankas: tankas || [],
  for625: for625.map(summarizeTb),
  relevantCount: relevant.length,
  saidas625,
};
writeFileSync(
  resolve("scripts/diag-estoque-repclean2-out.json"),
  JSON.stringify(out, null, 2)
);
console.log("\nWrote diag-estoque-repclean2-out.json");
