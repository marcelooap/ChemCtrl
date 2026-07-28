/**
 * Aplica/verifica migration 007 (elementos_filtrantes).
 * DDL precisa ser executado no SQL Editor do Supabase ChemFlow.
 * Este script apenas valida se a tabela e colunas já existem.
 *
 * Uso: node scripts/check-chemflow-elementos-filtrantes.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv(filePath) {
  const env = {};
  try {
    const raw = readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
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
    // ignore
  }
  return env;
}

function normalizeSupabaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
}

async function main() {
  const root = resolve(process.cwd());
  const env = {
    ...loadEnv(resolve(root, '.env')),
    ...loadEnv(resolve(root, '.env.local')),
    ...process.env,
  };
  const url = normalizeSupabaseUrl(env.VITE_CHEMFLOW_SUPABASE_URL || '');
  const key = (env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) {
    console.error('Env ChemFlow ausente');
    process.exit(1);
  }
  const sb = createClient(url, key);

  const { error: e1 } = await sb.from('elementos_filtrantes').select('id').limit(1);
  const { error: e2 } = await sb.from('filtracoes').select('filtro_id, filtro_codigo').limit(1);

  if (e1) {
    console.log('PENDENTE: rode sql/007_elementos_filtrantes.sql no Supabase ChemFlow');
    console.log('  elementos_filtrantes:', e1.message);
  } else {
    console.log('OK: elementos_filtrantes');
  }
  if (e2) {
    console.log('PENDENTE: colunas filtro_* em filtracoes');
    console.log('  filtracoes:', e2.message);
  } else {
    console.log('OK: filtracoes.filtro_id / filtro_codigo');
  }

  if (e1 || e2) process.exit(2);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
