/**
 * Post-066 verification via PostgREST (no DATABASE_URL required).
 * Confirms dropped columns are gone and row counts match pre-migration backup.
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
const env = { ...loadEnv(path.join(root, '.env')), ...process.env };
const url = env.VITE_CHEMFLOW_SUPABASE_URL;
const key = env.VITE_CHEMFLOW_SUPABASE_ANON_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function main() {
  const countRes = await fetch(`${url}/rest/v1/estoque_produtos?select=id&limit=1`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  });
  const contentRange = countRes.headers.get('content-range');
  const total = Number((contentRange || '').split('/')[1] || NaN);

  const sampleRes = await fetch(
    `${url}/rest/v1/estoque_produtos?select=*&order=id.asc&limit=1`,
    { headers }
  );
  const sample = (await sampleRes.json())[0] || {};
  const cols = Object.keys(sample).sort();

  const mustBeGone = ['mp_code', 'legacy_mp_id', 'status'];
  const stillPresent = mustBeGone.filter((c) => cols.includes(c));
  const mustRemain = ['produto_codigo', 'legacy_mp_id_text', 'saldo_atual', 'id_entrada'];
  const missing = mustRemain.filter((c) => !cols.includes(c));

  // Public RPC smoke (null token → null)
  const rpcRes = await fetch(`${url}/rest/v1/rpc/get_public_raw_material_info`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: '0000000000000000' }),
  });
  const rpcOk = rpcRes.status === 200;

  // MP filter via produto_codigo
  const mpRes = await fetch(
    `${url}/rest/v1/estoque_produtos?select=id,produto_codigo,origem&origem=eq.MATERIA_PRIMA&limit=3`,
    { headers }
  );
  const mpRows = await mpRes.json();

  // Contagem mínima do backup pré-066; crescimento operacional é esperado.
  const minExpectedRows = 348;
  const report = {
    total_rows: total,
    min_expected_rows: minExpectedRows,
    row_count_ok: Number.isFinite(total) && total >= minExpectedRows,
    columns: cols,
    columns_still_present_should_be_gone: stillPresent,
    columns_missing_should_remain: missing,
    drop_ok: stillPresent.length === 0,
    remain_ok: missing.length === 0,
    rpc_get_public_raw_material_info_status: rpcRes.status,
    rpc_ok: rpcOk,
    mp_sample: mpRows,
    overall_ok:
      Number.isFinite(total) &&
      total >= minExpectedRows &&
      stillPresent.length === 0 &&
      missing.length === 0 &&
      rpcOk,
  };

  const outPath = path.join(root, 'database', 'backups', 'verify-066-rest.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ ...report, outPath }, null, 2));
  if (!report.overall_ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
