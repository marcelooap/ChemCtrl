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

for (const table of ["t_transbordos", "t_vasilhames", "t_saidas"]) {
  const { count, error } = await sb
    .from(table)
    .select("*", { count: "exact", head: true });
  console.log(table, "count", count, error?.message || "");
}

// Default list without range — how many come back?
const { data: tb } = await sb.from("t_transbordos").select("id,codigo_transbordo");
console.log("default fetch transbordos length", tb?.length);
console.log(
  "has T477?",
  (tb || []).some((t) => t.codigo_transbordo === "T477")
);
console.log(
  "has T449?",
  (tb || []).some((t) => t.codigo_transbordo === "T449")
);

const { data: tb2 } = await sb
  .from("t_transbordos")
  .select("id,codigo_transbordo")
  .order("created_at", { ascending: false });
console.log("ordered desc length", tb2?.length);
console.log(
  "desc has T477?",
  (tb2 || []).some((t) => t.codigo_transbordo === "T477")
);
