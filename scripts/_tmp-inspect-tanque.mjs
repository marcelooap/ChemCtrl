import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

const clientSrc = readFileSync(
  "src/modules/industrializacao/api/supabaseClient.js",
  "utf8"
);
const url = clientSrc.match(/const supabaseUrl = '([^']+)'/)?.[1];
const anonKey = clientSrc.match(/const supabaseAnonKey = '([^']+)'/)?.[1];
const sb = createClient(url, anonKey, { auth: { persistSession: false } });

const ids = [
  "467e2803-b7b1-46ce-ba24-ea9c6369f9e2",
  "9802cf25-7f09-4234-8fb6-ecc6bcaebb6b",
];

const { data: est, error: e1 } = await sb
  .from("estoque_produtos")
  .select(
    "id,codigo_estoque,legacy_estoque_id,legacy_entrada_id,id_entrada,lote,data_fabricacao,data_validade,produto_codigo,origem,saldo_inicial,saldo_final"
  )
  .in("legacy_estoque_id", ids);

const { data: byLote, error: e3 } = await sb
  .from("estoque_produtos")
  .select("id,codigo_estoque,lote,data_fabricacao,data_validade,produto_codigo,origem")
  .or("lote.eq.BRAC902054,lote.eq.BRAC902522");

const { data: byJson, error: e4 } = await sb
  .from("estoque_produtos")
  .select("id,codigo_estoque,lote,produto_codigo,lotes")
  .or("lotes.cs.[{\"lote\":\"BRAC902054\"}],lotes.cs.[{\"lote\":\"BRAC902522\"}]");

const { data: tbs, error: e2 } = await sb
  .from("t_transbordos")
  .select("id,codigo_transbordo,data,origens,destinos")
  .in("codigo_transbordo", ["T280", "T308"]);

const destinos = [];
for (const t of tbs || []) {
  (t.destinos || []).forEach((d, i) => {
    const s = JSON.stringify(d);
    if (s.includes("1412342010") || s.includes("807280")) {
      destinos.push({
        codigo: t.codigo_transbordo,
        id: t.id,
        data: t.data,
        index: i,
        destino: d,
      });
    }
  });
}

const origens = (tbs || []).map((t) => ({
  codigo: t.codigo_transbordo,
  id: t.id,
  data: t.data,
  origens: (t.origens || []).map((o) => ({
    tipo: o.tipo_origem,
    lote: o.lote,
    entrada_id: o.entrada_id,
    vol: o.volume_retirado,
    massa: o.massa_retirada,
    codigo: o.entrada_codigo,
  })),
}));

const out = {
  estoqueErr: e1,
  byLoteErr: e3,
  byJsonErr: e4,
  tbErr: e2,
  estoque: est,
  byLote,
  byJson,
  origens,
  destinos,
};
writeFileSync("scripts/_tmp-inspect-tanque.json", JSON.stringify(out, null, 2));
console.log("ok", {
  est: est?.length,
  byLote: byLote?.length,
  byJson: byJson?.length,
  tbs: tbs?.length,
  destinos: destinos.length,
  e1,
  e2,
  e3,
  e4,
});
