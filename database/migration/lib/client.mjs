/**
 * Clientes Supabase (source/target) para migração de dados ChemCtrl v2.
 * Usa service role keys para bypassar RLS.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(MIGRATION_ROOT, '../..');

function parseEnvFile(filePath) {
  const env = {};
  if (!existsSync(filePath)) return env;
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
  return env;
}

export function loadMigrationEnv() {
  const fromFile = {
    ...parseEnvFile(resolve(REPO_ROOT, '.env')),
    ...parseEnvFile(resolve(MIGRATION_ROOT, '.env.migration')),
  };
  return { ...fromFile, ...process.env };
}

export function getClients() {
  const env = loadMigrationEnv();
  const sourceUrl = env.MIG_SOURCE_URL?.trim();
  const sourceKey = env.MIG_SOURCE_SERVICE_KEY?.trim();
  const targetUrl = env.MIG_TARGET_URL?.trim();
  const targetKey = env.MIG_TARGET_SERVICE_KEY?.trim();

  const missing = [];
  if (!sourceUrl) missing.push('MIG_SOURCE_URL');
  if (!sourceKey) missing.push('MIG_SOURCE_SERVICE_KEY');
  if (!targetUrl) missing.push('MIG_TARGET_URL');
  if (!targetKey) missing.push('MIG_TARGET_SERVICE_KEY');
  if (missing.length) {
    throw new Error(
      `Variáveis ausentes: ${missing.join(', ')}. ` +
        `Preencha database/migration/.env.migration (veja .env.migration.example).`
    );
  }

  const opts = {
    auth: { persistSession: false, autoRefreshToken: false },
  };

  return {
    source: createClient(sourceUrl, sourceKey, opts),
    target: createClient(targetUrl, targetKey, opts),
    env: { sourceUrl, targetUrl },
  };
}

export { MIGRATION_ROOT, REPO_ROOT };
