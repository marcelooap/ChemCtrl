import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
const { data, error } = await sb
  .from("estoque_produtos")
  .select(
    "codigo_estoque,lote,unidade_medida,tipo_recebimento,embalado,densidade,saldo_inicial,saldo_final,produto_codigo,produto_nome"
  )
  .eq("origem", "ARMAZENAGEM")
  .ilike("produto_nome", "%SCAVENREP O2BS%")
  .not("legacy_estoque_id", "is", null)
  .order("codigo_estoque");
if (error) throw error;
console.log(JSON.stringify(data, null, 2));
