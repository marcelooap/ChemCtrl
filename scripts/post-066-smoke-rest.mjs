/**
 * Smoke checks after 066 via PostgREST (anon).
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
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
};

async function rest(pathname, init = {}) {
  const res = await fetch(`${url}${pathname}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, contentRange: res.headers.get('content-range') };
}

async function main() {
  const checks = [];

  const count = await rest('/rest/v1/estoque_produtos?select=id&limit=1', {
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  const total = Number((count.contentRange || '').split('/')[1] || NaN);
  checks.push({ name: 'row_count', ok: total >= 348, total });

  const byOrigem = await rest(
    '/rest/v1/estoque_produtos?select=origem&limit=1000'
  );
  const origemMap = {};
  for (const r of byOrigem.body || []) {
    origemMap[r.origem] = (origemMap[r.origem] || 0) + 1;
  }
  // paginate for accurate count
  let from = 0;
  const origemAccurate = {};
  for (;;) {
    const page = await rest(
      `/rest/v1/estoque_produtos?select=origem,id&order=id.asc&offset=${from}&limit=1000`
    );
    const rows = page.body || [];
    for (const r of rows) origemAccurate[r.origem] = (origemAccurate[r.origem] || 0) + 1;
    if (rows.length < 1000) break;
    from += 1000;
  }
  checks.push({
    name: 'by_origem',
    ok: (origemAccurate.MATERIA_PRIMA || 0) >= 250 && (origemAccurate.ARMAZENAGEM || 0) >= 98,
    origemAccurate,
  });

  // Dropped columns must 400/fail when selected
  for (const col of ['mp_code', 'legacy_mp_id', 'status']) {
    const r = await rest(`/rest/v1/estoque_produtos?select=${col}&limit=1`);
    checks.push({
      name: `column_gone_${col}`,
      ok: r.status >= 400,
      status: r.status,
    });
  }

  // Remaining keys
  for (const col of ['produto_codigo', 'legacy_mp_id_text', 'saldo_atual']) {
    const r = await rest(`/rest/v1/estoque_produtos?select=${col}&limit=1`);
    checks.push({ name: `column_ok_${col}`, ok: r.status === 200, status: r.status });
  }

  // Uniqueness soft checks
  const legacyEstoque = await rest(
    '/rest/v1/estoque_produtos?select=legacy_estoque_id&origem=eq.ARMAZENAGEM&legacy_estoque_id=not.is.null&limit=1000'
  );
  const ids = (legacyEstoque.body || []).map((r) => r.legacy_estoque_id);
  checks.push({
    name: 'legacy_estoque_id_unique_sample',
    ok: new Set(ids).size === ids.length,
    sample: ids.length,
  });

  // Public RPCs
  const rpcMp = await rest('/rest/v1/rpc/get_public_raw_material_info', {
    method: 'POST',
    body: JSON.stringify({ p_token: '0000000000000000' }),
  });
  checks.push({
    name: 'rpc_get_public_raw_material_info',
    ok: rpcMp.status === 200,
    status: rpcMp.status,
    body: rpcMp.body,
  });

  const tokenRes = await rest(
    '/rest/v1/estoque_produtos?select=public_token&origem=eq.MATERIA_PRIMA&public_token=not.is.null&limit=1'
  );
  const realToken = tokenRes.body?.[0]?.public_token;
  if (realToken) {
    const rpcReal = await rest('/rest/v1/rpc/get_public_raw_material_info', {
      method: 'POST',
      body: JSON.stringify({ p_token: realToken }),
    });
    checks.push({
      name: 'rpc_get_public_raw_material_info_real',
      ok: rpcReal.status === 200 && rpcReal.body && rpcReal.body.mp_code != null,
      status: rpcReal.status,
      has_mp_code: Boolean(rpcReal.body?.mp_code),
      has_mp_name: Boolean(rpcReal.body?.mp_name),
    });
  } else {
    checks.push({ name: 'rpc_get_public_raw_material_info_real', ok: true, skipped: true });
  }

  const entradaTokenRes = await rest(
    '/rest/v1/estoque_produtos?select=public_token_entrada&public_token_entrada=not.is.null&limit=1'
  );
  const entradaToken = entradaTokenRes.body?.[0]?.public_token_entrada;
  if (entradaToken) {
    const rpcEnt = await rest('/rest/v1/rpc/get_public_entrada_info', {
      method: 'POST',
      body: JSON.stringify({ p_token: entradaToken }),
    });
    checks.push({
      name: 'rpc_get_public_entrada_info_real',
      ok: rpcEnt.status === 200,
      status: rpcEnt.status,
      has_codigo: Boolean(rpcEnt.body?.codigo),
    });
  } else {
    checks.push({ name: 'rpc_get_public_entrada_info_real', ok: true, skipped: 'no token' });
  }

  // Entity-shaped read: MP list fields used by app
  const mpList = await rest(
    '/rest/v1/estoque_produtos?select=id,produto_codigo,produto_nome,saldo_atual,legacy_mp_id_text,origem&origem=eq.MATERIA_PRIMA&limit=5'
  );
  checks.push({
    name: 'mp_list_shape',
    ok:
      mpList.status === 200 &&
      (mpList.body || []).every((r) => r.produto_codigo && r.legacy_mp_id_text),
    sample: (mpList.body || []).length,
  });

  const overall = checks.every((c) => c.ok);
  const report = { overall_ok: overall, checks };
  const outPath = path.join(root, 'database', 'backups', 'post-066-smoke-rest.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ ...report, outPath }, null, 2));
  if (!overall) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
