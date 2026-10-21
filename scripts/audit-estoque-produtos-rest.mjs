/**
 * Read-only inspection of estoque_produtos via PostgREST (anon key from .env).
 * Limited vs direct SQL (no pg_catalog sizes/indexes/triggers).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function loadEnv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...loadEnv(path.join(root, '.env')),
  ...process.env,
};
const url = env.VITE_CHEMFLOW_SUPABASE_URL;
const key = env.VITE_CHEMFLOW_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing VITE_CHEMFLOW_SUPABASE_URL or VITE_CHEMFLOW_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
};

async function rest(pathname, extraHeaders = {}) {
  return fetch(`${url}${pathname}`, {
    headers: { ...headers, ...extraHeaders },
  });
}

async function countTable(table) {
  const res = await rest(`/rest/v1/${table}?select=*&limit=1`, {
    Prefer: 'count=exact',
    Range: '0-0',
  });
  return {
    status: res.status,
    contentRange: res.headers.get('content-range'),
    ok: res.ok,
  };
}

function isUuid(s) {
  return (
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  );
}

async function main() {
  const out = { preflight: {}, columns: [], by_origem: {}, column_fill: {}, redundancy: {} };

  for (const t of ['estoque_produtos', '_entrada_id_map', 't_estoque', 't_entradas', 'estoque_mp']) {
    out.preflight[t] = await countTable(t);
  }

  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const res = await rest(
      `/rest/v1/estoque_produtos?select=*&order=id.asc&offset=${from}&limit=${pageSize}`
    );
    if (!res.ok) {
      console.error('select failed', res.status, await res.text());
      process.exit(1);
    }
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  out.total_rows = rows.length;

  const colSet = new Set();
  for (const r of rows) {
    for (const k of Object.keys(r)) colSet.add(k);
  }
  const cols = [...colSet].sort();
  out.columns = cols.map((column) => ({ column, type: 'inferred_from_rows' }));

  for (const r of rows) {
    const o = r.origem || '(null)';
    out.by_origem[o] = (out.by_origem[o] || 0) + 1;
  }
  for (const col of cols) {
    let nulls = 0;
    let empty = 0;
    const distinct = new Set();
    for (const r of rows) {
      const v = r[col];
      if (v == null) nulls += 1;
      else if (typeof v === 'string' && v.trim() === '') empty += 1;
      else distinct.add(typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    out.column_fill[col] = {
      nulls,
      empty,
      distinct: distinct.size,
      constant: distinct.size <= 1,
      fill_pct: rows.length ? Number((((rows.length - nulls) / rows.length) * 100).toFixed(2)) : 0,
    };
  }

  let mpCodeSame = 0;
  let mpCodeDiff = 0;
  let mpCodeOnly = 0;
  let produtoOnly = 0;
  let legacyMpMatch = 0;
  let legacyMpMismatch = 0;
  let legacyMpIdNullWithText = 0;
  let legacyMpTextNullWithId = 0;
  let initialEqQtdArm = 0;
  let initialDiffQtdArm = 0;
  let initialEqQtdMp = 0;
  let initialDiffQtdMp = 0;
  let densNonNumeric = 0;
  let statusFilled = 0;
  const statusValues = new Set();
  let legacyEntradaCodigoFilled = 0;
  let legacyMpEntryIdFilled = 0;
  let legacyMpIdFilled = 0;
  let mpCodeFilled = 0;

  for (const r of rows) {
    if (r.mp_code != null && String(r.mp_code).trim() !== '') mpCodeFilled += 1;
    if (r.legacy_mp_id != null) legacyMpIdFilled += 1;
    if (r.legacy_entrada_codigo != null && String(r.legacy_entrada_codigo).trim() !== '') {
      legacyEntradaCodigoFilled += 1;
    }
    if (r.legacy_mp_entry_id != null && String(r.legacy_mp_entry_id).trim() !== '') {
      legacyMpEntryIdFilled += 1;
    }

    if (r.origem === 'MATERIA_PRIMA') {
      if (r.mp_code != null && r.produto_codigo != null) {
        if (String(r.mp_code) === String(r.produto_codigo)) mpCodeSame += 1;
        else mpCodeDiff += 1;
      } else if (r.mp_code != null && r.produto_codigo == null) mpCodeOnly += 1;
      else if (r.mp_code == null && r.produto_codigo != null) produtoOnly += 1;

      if (r.legacy_mp_id != null && r.legacy_mp_id_text != null) {
        if (String(r.legacy_mp_id) === String(r.legacy_mp_id_text)) legacyMpMatch += 1;
        else if (isUuid(r.legacy_mp_id_text) && String(r.legacy_mp_id) !== String(r.legacy_mp_id_text)) {
          legacyMpMismatch += 1;
        } else if (String(r.legacy_mp_id) === String(r.legacy_mp_id_text)) {
          legacyMpMatch += 1;
        } else {
          legacyMpMismatch += 1;
        }
      } else if (r.legacy_mp_id == null && r.legacy_mp_id_text != null) {
        legacyMpIdNullWithText += 1;
      } else if (r.legacy_mp_id != null && r.legacy_mp_id_text == null) {
        legacyMpTextNullWithId += 1;
      }

      if (Number(r.initial_stock) === Number(r.quantidade)) initialEqQtdMp += 1;
      else initialDiffQtdMp += 1;
    } else if (r.origem === 'ARMAZENAGEM') {
      if (Number(r.initial_stock) === Number(r.quantidade)) initialEqQtdArm += 1;
      else initialDiffQtdArm += 1;
    }

    if (r.densidade != null && String(r.densidade).trim() !== '') {
      if (!/^-?[0-9]+([.][0-9]+)?$/.test(String(r.densidade).trim())) densNonNumeric += 1;
    }
    if (r.status != null && String(r.status).trim() !== '') {
      statusFilled += 1;
      statusValues.add(String(r.status));
    }
  }

  out.redundancy = {
    mp_code_same_as_produto_codigo: mpCodeSame,
    mp_code_diff_produto_codigo: mpCodeDiff,
    mp_code_only: mpCodeOnly,
    produto_codigo_only: produtoOnly,
    mp_code_filled: mpCodeFilled,
    legacy_mp_id_filled: legacyMpIdFilled,
    legacy_mp_id_matches_text: legacyMpMatch,
    legacy_mp_id_mismatch_text: legacyMpMismatch,
    legacy_mp_id_null_with_text: legacyMpIdNullWithText,
    legacy_mp_text_null_with_id: legacyMpTextNullWithId,
    initial_eq_quantidade_armazenagem: initialEqQtdArm,
    initial_diff_quantidade_armazenagem: initialDiffQtdArm,
    initial_eq_quantidade_mp: initialEqQtdMp,
    initial_diff_quantidade_mp: initialDiffQtdMp,
    densidade_non_numeric: densNonNumeric,
    status_filled: statusFilled,
    status_values: [...statusValues],
    legacy_entrada_codigo_filled: legacyEntradaCodigoFilled,
    legacy_mp_entry_id_filled: legacyMpEntryIdFilled,
  };

  // Map coverage for historical codes (best-effort via REST)
  const mapRes = await countTable('_entrada_id_map');
  out.entrada_id_map = mapRes;

  const outPath = path.join(root, 'database', 'backups', 'audit-estoque-produtos-rest.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ wrote: outPath, total_rows: out.total_rows, by_origem: out.by_origem, redundancy: out.redundancy, preflight: out.preflight }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
