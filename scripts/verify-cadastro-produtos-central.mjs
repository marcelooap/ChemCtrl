/**
 * Verifica pós-migration 046 via REST (somente leitura + RPC smoke).
 * Uso: node scripts/verify-cadastro-produtos-central.mjs
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
    console.error('Credenciais VITE_CHEMFLOW_SUPABASE_* ausentes');
    process.exit(2);
  }
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: 'count=exact',
  };

  async function probe(table) {
    const resp = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, {
      headers,
    });
    const cr = resp.headers.get('content-range');
    return { table, status: resp.status, ok: resp.ok, range: cr };
  }

  const tables = await Promise.all(
    [
      'cadastro_produtos',
      'receitas',
      't_produtos',
      'ind_lista_receitas',
    ].map(probe)
  );

  console.log('tables:');
  for (const t of tables) {
    console.log(`  ${t.table}: status=${t.status} ok=${t.ok} range=${t.range}`);
  }

  const origemResp = await fetch(
    `${url}/rest/v1/cadastro_produtos?select=origem&limit=10000`,
    { headers }
  );
  if (origemResp.ok) {
    const rows = await origemResp.json();
    const counts = {};
    for (const r of rows) {
      counts[r.origem || 'NULL'] = (counts[r.origem || 'NULL'] || 0) + 1;
    }
    console.log('origem counts:', counts);
  } else {
    console.log('origem: table cadastro_produtos indisponivel');
  }

  // Chamada inválida de propósito: confirma existência da RPC sem inserir linha.
  const rpcResp = await fetch(
    `${url}/rest/v1/rpc/cadastro_produtos_registrar_uso`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_codigo: '',
        p_nome: '',
        p_modulo: 'ARMAZENAGEM',
        p_attrs: {},
      }),
    }
  );
  const rpcText = await rpcResp.text();
  console.log('rpc registrar_uso (expect validation error):', rpcResp.status, rpcText.slice(0, 240));

  const renamed =
    tables.find((t) => t.table === 'cadastro_produtos')?.ok &&
    tables.find((t) => t.table === 'receitas')?.ok &&
    !tables.find((t) => t.table === 't_produtos')?.ok &&
    !tables.find((t) => t.table === 'ind_lista_receitas')?.ok;

  const rpcPresent =
    rpcResp.status !== 404 &&
    !/Could not find the function|PGRST202/i.test(rpcText);

  if (!renamed) {
    console.error(
      'FAIL: renomeacao incompleta. Aplique src/modules/transbordo/sql/046_cadastro_produtos_central.sql'
    );
    process.exit(1);
  }
  if (!rpcPresent) {
    console.error('FAIL: RPC cadastro_produtos_registrar_uso indisponivel');
    process.exit(1);
  }
  console.log('OK: migration 046 aparente no projeto');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
