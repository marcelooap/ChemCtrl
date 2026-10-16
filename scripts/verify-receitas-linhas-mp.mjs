/**
 * Verifica pós-047 via REST (somente leitura + RPC smoke).
 * Uso: node scripts/verify-receitas-linhas-mp.mjs
 */
import { readFileSync } from 'node:fs';
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

async function main() {
  const env = { ...loadEnv(resolve(root, '.env')), ...process.env };
  const url = (env.VITE_CHEMFLOW_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '');
  const key = (env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) {
    console.error('Credenciais ausentes');
    process.exit(2);
  }
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: 'count=exact',
  };

  let recResp = await fetch(
    `${url}/rest/v1/receitas?select=id,receita_id,revision_number,mp_code,linha_ordem&limit=10000`,
    { headers }
  );
  let recText = await recResp.text();
  if (!recResp.ok && /receita_id does not exist|42703/i.test(recText)) {
    console.error(
      'FAIL: colunas da 047 ausentes. Aplique 047_receitas_linhas_mp.sql apos autorizacao explicita.'
    );
    process.exit(1);
  }
  if (!recResp.ok) {
    console.error('FAIL receitas:', recResp.status, recText.slice(0, 200));
    process.exit(1);
  }
  const rows = JSON.parse(recText || '[]');
  const withMp = rows.filter((r) => r.mp_code);
  const withReceitaId = rows.filter((r) => r.receita_id);
  const revKeys = new Set(
    rows.map((r) => `${r.receita_id || r.id}:${r.revision_number || 1}`)
  );

  console.log({
    rows: rows.length,
    with_mp_code: withMp.length,
    with_receita_id: withReceitaId.length,
    distinct_revisions: revKeys.size,
  });

  const rpcResp = await fetch(`${url}/rest/v1/rpc/receitas_salvar_revisao`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_receita_id: null,
      p_revision_number: 1,
      p_header: {},
      p_mps: [],
      p_mode: 'create',
    }),
  });
  const rpcText = await rpcResp.text();
  const rpcPresent =
    rpcResp.status !== 404 && !/PGRST202|Could not find the function/i.test(rpcText);
  console.log('rpc receitas_salvar_revisao present:', rpcPresent, 'status:', rpcResp.status);

  if (withReceitaId.length < rows.length * 0.5 || !rpcPresent) {
    console.error(
      'FAIL: migration 047 aparentemente nao aplicada. Aplique 047_receitas_linhas_mp.sql apos autorizacao.'
    );
    process.exit(1);
  }
  console.log('OK: modelo de linhas por MP aparente');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
