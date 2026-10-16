/**
 * Aplica 046_cadastro_produtos_central.sql no Postgres do ChemCtrl.
 * Não imprime credenciais.
 *
 * Uso: node scripts/apply-cadastro-produtos-central.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv(filePath) {
  const env = {};
  try {
    const text = readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    // .env ausente
  }
  return env;
}

function resolveConnectionString(env) {
  const candidates = [
    env.DATABASE_URL,
    env.CHEMFLOW_DATABASE_URL,
    env.SUPABASE_DB_URL,
    env.POSTGRES_URL,
    env.DIRECT_URL,
    env.SUPABASE_DATABASE_URL,
  ];
  return candidates.find((v) => typeof v === 'string' && v.trim())?.trim() || '';
}

async function main() {
  const env = { ...loadEnv(resolve(root, '.env')), ...process.env };
  const connectionString = resolveConnectionString(env);
  if (!connectionString) {
    console.error(
      'Sem URL de Postgres. Defina DATABASE_URL (ou CHEMFLOW_DATABASE_URL / SUPABASE_DB_URL) no .env, ' +
        'ou execute src/modules/transbordo/sql/046_cadastro_produtos_central.sql no SQL Editor do Supabase.'
    );
    process.exit(2);
  }

  const sql = readFileSync(
    resolve(root, 'src/modules/transbordo/sql/046_cadastro_produtos_central.sql'),
    'utf8'
  );

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    const tables = await client.query(`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname IN ('receitas', 'cadastro_produtos', 'ind_lista_receitas', 't_produtos')
      ORDER BY 1
    `);
    const origem = await client.query(`
      SELECT origem, count(*)::int AS n
      FROM cadastro_produtos
      GROUP BY origem
      ORDER BY origem
    `);
    console.log('046_cadastro_produtos_central: ok');
    console.log(
      'tables:',
      tables.rows.map((r) => r.relname).join(', ')
    );
    console.log(
      'origem:',
      origem.rows.map((r) => `${r.origem}=${r.n}`).join(', ')
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
