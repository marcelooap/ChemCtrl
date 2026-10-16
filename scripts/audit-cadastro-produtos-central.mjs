/**
 * Auditoria somente leitura: t_produtos x ind_lista_receitas
 * Uso: node scripts/audit-cadastro-produtos-central.mjs
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

function norm(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function parseRawMaterials(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function fetchAll(url, key, table, select) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: 'count=exact',
  };
  const pageSize = 1000;
  let offset = 0;
  let total = null;
  const rows = [];
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
    console.error('Configure VITE_CHEMFLOW_SUPABASE_URL e VITE_CHEMFLOW_SUPABASE_ANON_KEY no .env');
    process.exit(2);
  }

  let products = await fetchAll(
    url,
    key,
    'cadastro_produtos',
    'id,codigo,produto,cliente_nome,densidade,controlado,origem'
  );
  if (!products.ok) {
    products = await fetchAll(
      url,
      key,
      't_produtos',
      'id,codigo,produto,cliente_nome,densidade,controlado'
    );
  }

  let recipes = await fetchAll(
    url,
    key,
    'receitas',
    'id,code,product_name,client,density,raw_materials,revision_number'
  );
  if (!recipes.ok) {
    recipes = await fetchAll(
      url,
      key,
      'ind_lista_receitas',
      'id,code,product_name,client,density,raw_materials,revision_number'
    );
  }

  if (!products.ok) {
    console.error('produtos:', products.status, products.error);
  }
  if (!recipes.ok) {
    console.error('receitas:', recipes.status, recipes.error);
  }

  const prods = products.rows || [];
  const recs = recipes.rows || [];

  const prodKey = new Map();
  const byCode = new Map();
  for (const p of prods) {
    const k = `${norm(p.codigo)}|${norm(p.produto)}`;
    if (!prodKey.has(k)) prodKey.set(k, []);
    prodKey.get(k).push(p);
    const ck = norm(p.codigo);
    if (!byCode.has(ck)) byCode.set(ck, []);
    byCode.get(ck).push(p);
  }

  const exactDupes = [...prodKey.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([k, v]) => ({
      key: k,
      count: v.length,
      ids: v.map((x) => x.id),
      codigo: v[0].codigo,
      produto: v[0].produto,
    }));

  const sameCodeDiffName = [...byCode.entries()]
    .filter(([, v]) => new Set(v.map((x) => norm(x.produto))).size > 1)
    .map(([k, v]) => ({
      codigo_norm: k,
      variants: v.map((p) => ({ id: p.id, codigo: p.codigo, produto: p.produto })),
    }));

  const recipeItems = [];
  const missingCode = [];
  for (const r of recs) {
    const code = norm(r.code);
    const name = norm(r.product_name);
    if (!code || !name) {
      if (name || code) {
        missingCode.push({
          type: 'PA',
          code: r.code || null,
          name: r.product_name || null,
          recipe_id: r.id,
          revision_number: r.revision_number,
        });
      }
    } else {
      recipeItems.push({
        type: 'PA',
        code: r.code,
        name: r.product_name,
        key: `${code}|${name}`,
        client: r.client || null,
        density: r.density ?? null,
      });
    }
    for (const m of parseRawMaterials(r.raw_materials)) {
      const mc = norm(m.mp_code);
      const mn = norm(m.mp_name);
      if (!mc || !mn) {
        if (mn || mc) {
          missingCode.push({
            type: 'MP',
            code: m.mp_code || null,
            name: m.mp_name || null,
            recipe_id: r.id,
          });
        }
        continue;
      }
      recipeItems.push({
        type: 'MP',
        code: m.mp_code,
        name: m.mp_name,
        key: `${mc}|${mn}`,
        density: m.mp_density ?? null,
        controlado: Boolean(m.controlado),
        orgao_regulamentador: m.orgao_regulamentador || null,
      });
    }
  }

  const uniq = new Map();
  for (const it of recipeItems) {
    if (!uniq.has(it.key)) uniq.set(it.key, it);
  }

  const ambos = [];
  const toInsert = [];
  const conflicts = [];
  for (const [, it] of uniq) {
    const hits = prodKey.get(it.key) || [];
    if (hits.length === 1) {
      ambos.push({ ...it, produto_id: hits[0].id });
    } else if (hits.length === 0) {
      const codeHits = byCode.get(norm(it.code)) || [];
      if (codeHits.length > 0) {
        conflicts.push({
          reason: 'codigo_igual_nome_diferente',
          item: it,
          candidates: codeHits.map((p) => ({
            id: p.id,
            codigo: p.codigo,
            produto: p.produto,
          })),
        });
      } else {
        toInsert.push(it);
      }
    } else {
      conflicts.push({
        reason: 'duplicata_exata_no_cadastro',
        item: it,
        candidates: hits.map((p) => ({
          id: p.id,
          codigo: p.codigo,
          produto: p.produto,
        })),
      });
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    tables: {
      t_produtos: { ok: products.ok, total: products.total, fetched: prods.length },
      ind_lista_receitas: { ok: recipes.ok, total: recipes.total, fetched: recs.length },
    },
    summary: {
      exact_dupes_codigo_nome: exactDupes.length,
      same_codigo_diff_nome: sameCodeDiffName.length,
      recipe_items_with_code_name: uniq.size,
      recipe_items_missing_code_or_name: missingCode.length,
      match_unique_ambos_candidates: ambos.length,
      to_insert_industrializacao: toInsert.length,
      ambiguous_conflicts: conflicts.length,
    },
    exact_dupes: exactDupes,
    same_codigo_diff_nome: sameCodeDiffName.slice(0, 50),
    missing_code_or_name: missingCode.slice(0, 100),
    ambos_candidates: ambos,
    to_insert: toInsert,
    conflicts,
  };

  const outPath = resolve(root, 'scripts/audit-cadastro-produtos-central-report.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('report:', outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
