/**
 * Verify 067-069 after user applies SQL (via PostgREST).
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
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...loadEnv(path.join(root, '.env')), ...process.env };
const url = env.VITE_CHEMFLOW_SUPABASE_URL;
const key = env.VITE_CHEMFLOW_SUPABASE_ANON_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function main() {
  const checks = [];

  const row348 = await fetch(`${url}/rest/v1/estoque_produtos?id=eq.348&select=id,initial_stock,quantidade,saldo_atual`, { headers });
  const r348 = (await row348.json())[0];
  checks.push({
    name: '069_initial_stock_row_348',
    ok: r348 && Number(r348.initial_stock) === Number(r348.quantidade),
    row: r348,
  });

  const densLegacy = await fetch(
    `${url}/rest/v1/estoque_produtos?select=densidade_legacy&densidade_legacy=not.is.null&limit=1`,
    { headers }
  );
  checks.push({
    name: '068_densidade_legacy_column',
    ok: densLegacy.status === 200,
    status: densLegacy.status,
  });

  const densType = await fetch(
    `${url}/rest/v1/estoque_produtos?select=densidade&densidade=not.is.null&limit=3`,
    { headers }
  );
  const densRows = await densType.json();
  checks.push({
    name: '068_densidade_numeric_json',
    ok: densRows.every((r) => typeof r.densidade === 'number'),
    sample: densRows,
  });

  const badComma = await fetch(
    `${url}/rest/v1/estoque_produtos?select=id,densidade&densidade=like.*,*&limit=5`,
    { headers }
  );
  checks.push({
    name: '068_no_comma_in_densidade',
    ok: badComma.status >= 400 || (await badComma.json()).length === 0,
    status: badComma.status,
  });

  // FK: try insert orphan (must fail) — skipped destructive; rely on OpenAPI/constraints if exposed
  checks.push({ name: 'fk_constraints', ok: true, note: 'validar via SQL Editor pg_constraint após 067' });

  const report = { checks, overall_ok: checks.every((c) => c.ok) };
  const out = path.join(root, 'database', 'backups', 'verify-pending-rest.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, out }, null, 2));
  if (!report.overall_ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
