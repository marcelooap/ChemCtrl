/**
 * Diagnóstico readonly antes da migration 047 (receitas 1 linha por MP).
 * Uso: node scripts/diag-receitas-linhas-mp.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv(filePath) {
  const env = {};
  try {
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[trimmed.slice(0, eq).trim()] = value;
    }
  } catch {
    // ignore
  }
  return env;
}

function parseRawMaterials(raw) {
  if (Array.isArray(raw)) return { shape: 'array', items: raw };
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '[]');
      if (Array.isArray(parsed)) return { shape: 'json_string', items: parsed };
      return { shape: 'json_string_non_array', items: [] };
    } catch {
      return { shape: 'invalid_string', items: [] };
    }
  }
  if (raw && typeof raw === 'object') {
    return { shape: 'object', items: [] };
  }
  return { shape: 'null_or_empty', items: [] };
}

async function fetchAll(url, key, table, select) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: 'count=exact',
  };
  const pageSize = 1000;
  let offset = 0;
  const rows = [];
  let total = null;
  while (true) {
    const qs = new URLSearchParams({
      select,
      limit: String(pageSize),
      offset: String(offset),
    });
    const resp = await fetch(`${url}/rest/v1/${table}?${qs}`, { headers });
    const text = await resp.text();
    if (!resp.ok) {
      return { ok: false, status: resp.status, error: text, rows: [], total: 0 };
    }
    const chunk = text ? JSON.parse(text) : [];
    const cr = resp.headers.get('content-range');
    if (cr && total == null) {
      const m = cr.match(/\/(\d+|\*)/);
      total = m && m[1] !== '*' ? Number(m[1]) : null;
    }
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
    if (total != null && offset >= total) break;
  }
  return { ok: true, status: 200, rows, total: total ?? rows.length };
}

async function main() {
  const env = { ...loadEnv(resolve(root, '.env')), ...process.env };
  const url = (env.VITE_CHEMFLOW_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '');
  const key = (env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) {
    console.error('Credenciais VITE_CHEMFLOW_SUPABASE_* ausentes');
    process.exit(2);
  }

  const recipes = await fetchAll(
    url,
    key,
    'receitas',
    'id,code,product_name,client,revision_number,revision,density,price,raw_materials,necessita_n2'
  );
  const productions = await fetchAll(
    url,
    key,
    'ind_lista_producoes',
    'id,product,recipe_id,recipe_revision'
  );

  const shapeCounts = {};
  let totalMps = 0;
  let revisionsWithMps = 0;
  let revisionsWithoutMps = 0;
  const samples = [];

  for (const r of recipes.rows || []) {
    const parsed = parseRawMaterials(r.raw_materials);
    shapeCounts[parsed.shape] = (shapeCounts[parsed.shape] || 0) + 1;
    const validMps = (parsed.items || []).filter(
      (m) => String(m?.mp_code || '').trim() && String(m?.mp_name || '').trim()
    );
    totalMps += validMps.length;
    if (validMps.length) revisionsWithMps += 1;
    else revisionsWithoutMps += 1;
    if (samples.length < 8) {
      samples.push({
        id: r.id,
        code: r.code,
        product_name: r.product_name,
        revision_number: r.revision_number,
        shape: parsed.shape,
        mp_count: validMps.length,
        mp_codes: validMps.map((m) => m.mp_code),
      });
    }
  }

  const recipeIds = new Set((recipes.rows || []).map((r) => r.id));
  const orphanRecipeIds = (productions.rows || []).filter(
    (p) => p.recipe_id && !recipeIds.has(p.recipe_id)
  );

  const expectedAfter =
    (recipes.rows || []).length +
    Math.max(0, totalMps - revisionsWithMps);

  const report = {
    generated_at: new Date().toISOString(),
    recipes: {
      ok: recipes.ok,
      total: recipes.total,
      fetched: (recipes.rows || []).length,
      shape_counts: shapeCounts,
      revisions_with_valid_mps: revisionsWithMps,
      revisions_without_valid_mps: revisionsWithoutMps,
      valid_mp_items_total: totalMps,
      expected_rows_after_047: expectedAfter,
    },
    productions: {
      ok: productions.ok,
      total: productions.total,
      with_recipe_id: (productions.rows || []).filter((p) => p.recipe_id).length,
      orphan_recipe_id_count: orphanRecipeIds.length,
      orphan_sample: orphanRecipeIds.slice(0, 10),
    },
    samples,
  };

  const out = resolve(root, 'scripts/diag-receitas-linhas-mp-report.json');
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report.recipes, null, 2));
  console.log(
    'productions orphan_recipe_id:',
    report.productions.orphan_recipe_id_count
  );
  console.log('report:', out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
