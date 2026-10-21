/**
 * Apply a SQL file using a Postgres URL from the session or .env.
 * Never logs the connection string.
 *
 * Usage:
 *   $env:DATABASE_URL='postgresql://...'; node scripts/apply-sql-pg.mjs path/to/file.sql
 *   # or put CHEMFLOW_DATABASE_URL / DATABASE_URL in .env (gitignored)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(filePath) {
  const env = {};
  try {
    const text = fs.readFileSync(filePath, 'utf8');
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
    /* ignore */
  }
  return env;
}

const fileEnv = loadEnv(path.join(root, '.env'));
const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.CHEMFLOW_DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DIRECT_URL ||
  fileEnv.DATABASE_URL ||
  fileEnv.CHEMFLOW_DATABASE_URL ||
  fileEnv.SUPABASE_DB_URL ||
  fileEnv.SUPABASE_DATABASE_URL ||
  fileEnv.POSTGRES_URL ||
  fileEnv.DIRECT_URL;

const file = process.argv[2];
if (!databaseUrl) {
  console.error(
    'NO_DATABASE_URL: defina DATABASE_URL (ou CHEMFLOW_DATABASE_URL) na sessão ou no .env, ' +
      'ou execute o SQL no Supabase SQL Editor.'
  );
  process.exit(2);
}
if (!file) {
  console.error('Usage: node scripts/apply-sql-pg.mjs <sql-file>');
  process.exit(2);
}

const sqlPath = path.resolve(file);
const sql = fs.readFileSync(sqlPath, 'utf8');
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  console.log(JSON.stringify({ applying: path.basename(sqlPath), bytes: Buffer.byteLength(sql) }));
  await client.query(sql);
  console.log(JSON.stringify({ ok: true, applied: path.basename(sqlPath) }));
  await client.end();
}

main().catch(async (e) => {
  console.error(e.message || e);
  try {
    await client.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
