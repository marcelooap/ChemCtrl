/**
 * Aplica 047_receitas_linhas_mp.sql no Postgres.
 * NÃO imprime credenciais.
 *
 * Uso: node scripts/apply-receitas-linhas-mp.mjs
 * Requer DATABASE_URL (ou CHEMFLOW_DATABASE_URL / SUPABASE_DB_URL).
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
      'Sem URL de Postgres. Defina DATABASE_URL no .env ou execute ' +
        'src/modules/industrializacao/sql/047_receitas_linhas_mp.sql no SQL Editor.'
    );
    process.exit(2);
  }

  const sql = readFileSync(
    resolve(root, 'src/modules/industrializacao/sql/047_receitas_linhas_mp.sql'),
    'utf8'
  );

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM receitas) AS receitas_rows,
        (SELECT COUNT(DISTINCT receita_id || ':' || revision_number::text)::int FROM receitas) AS revisions,
        (SELECT COUNT(*)::int FROM receitas WHERE mp_code IS NOT NULL AND btrim(mp_code) <> '') AS with_mp,
        (SELECT COUNT(*)::int FROM _chemctrl_047_receitas_backup) AS backup_rows
    `);
    const report = await client.query(`
      SELECT status, COUNT(*)::int AS n
      FROM _chemctrl_047_receitas_report
      GROUP BY status
      ORDER BY status
    `);
    console.log('047_receitas_linhas_mp: ok');
    console.log(counts.rows[0]);
    console.log(
      'report:',
      report.rows.map((r) => `${r.status}=${r.n}`).join(', ')
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
