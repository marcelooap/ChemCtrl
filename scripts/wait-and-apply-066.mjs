/**
 * Polls for DATABASE_URL (env or .env) up to N seconds, then applies 066.
 * Usage: node scripts/wait-and-apply-066.mjs [timeoutSeconds=300]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const timeoutSec = Number(process.argv[2] || 300);
const sqlFile = path.join(root, 'src/modules/industrializacao/sql/066_estoque_produtos_otimizacao.sql');
const applyScript = path.join(root, 'scripts/apply-sql-pg.mjs');

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

function resolveUrl() {
  const fileEnv = loadEnv(path.join(root, '.env'));
  return (
    process.env.DATABASE_URL ||
    process.env.CHEMFLOW_DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    fileEnv.DATABASE_URL ||
    fileEnv.CHEMFLOW_DATABASE_URL ||
    fileEnv.SUPABASE_DB_URL ||
    null
  );
}

const started = Date.now();
console.log(JSON.stringify({ waiting_for: 'DATABASE_URL', timeout_sec: timeoutSec }));

while (!resolveUrl()) {
  if ((Date.now() - started) / 1000 > timeoutSec) {
    console.error('TIMEOUT: DATABASE_URL ainda ausente. Aplique 066 no SQL Editor do Supabase.');
    process.exit(2);
  }
  await new Promise((r) => setTimeout(r, 3000));
}

console.log(JSON.stringify({ found_url: true, applying: '066' }));
const result = spawnSync(process.execPath, [applyScript, sqlFile], {
  cwd: root,
  env: process.env,
  encoding: 'utf8',
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
