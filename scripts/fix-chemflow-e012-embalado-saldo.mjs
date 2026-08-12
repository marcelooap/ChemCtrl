/**
 * Corrige E012 (IDOS 143 AGA): expedido 500 L, estoque atual 1500 L.
 * Só o tanque T008 (placa 1, Expedido) deve baixar; o 08240-4 permanece No Pátio.
 *
 * Uso:
 *   node scripts/fix-chemflow-e012-embalado-saldo.mjs
 *   node scripts/fix-chemflow-e012-embalado-saldo.mjs --dry-run
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const EST_ID = '5c29db4c-9b4f-4860-910e-8582b3291c2c';
const QTD = 2000;
const EXPEDIDO = 500;
const SALDO = QTD - EXPEDIDO; // 1500

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

const env = {
  ...loadEnv(resolve('.env')),
  ...loadEnv(resolve('.env.local')),
};
const url = (env.VITE_CHEMFLOW_SUPABASE_URL || '')
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '');
const key = env.VITE_CHEMFLOW_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Configure VITE_CHEMFLOW_SUPABASE_URL/ANON_KEY no .env');
  process.exit(1);
}

const sb = createClient(url, key);

const { data: est, error } = await sb
  .from('t_estoque')
  .select('id,quantidade,saldo_atual,unidade_medida,lote,produto_nome')
  .eq('id', EST_ID)
  .maybeSingle();
if (error) throw error;
if (!est) {
  console.error('E012 estoque não encontrado');
  process.exit(1);
}

console.log('Antes:', est);
console.log('Depois:', {
  quantidade: QTD,
  saldo_atual: SALDO,
  unidade_medida: 'L',
  expedido: EXPEDIDO,
});

if (DRY_RUN) {
  console.log('[dry-run] Nenhuma alteração persistida.');
  process.exit(0);
}

const { error: uErr } = await sb
  .from('t_estoque')
  .update({
    quantidade: QTD,
    saldo_atual: SALDO,
    unidade_medida: 'L',
  })
  .eq('id', EST_ID);
if (uErr) throw uErr;

console.log('OK: E012 — expedido 500 L, estoque atual 1500 L.');
