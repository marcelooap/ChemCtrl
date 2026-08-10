/**
 * Atualiza todos os isotanques: capacidade 26000 L, início locação 2026-07-01.
 * Uso: node src/modules/transbordo/sql/update_isotanques_capacidade.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../../..');

function loadEnv(filePath) {
  const env = {};
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

const env = loadEnv(resolve(root, '.env'));
const url = (env.VITE_CHEMFLOW_SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
const key = (env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || '').trim();

if (!url || !key) {
  console.error('Credenciais VITE_CHEMFLOW_SUPABASE_* ausentes no .env');
  process.exit(1);
}

const supabase = createClient(url, key);

const CAPACIDADE = 26000;
const INICIO_LOCACAO = '2026-07-01';

async function main() {
  const { data: rows, error: listErr } = await supabase
    .from('t_isotanques')
    .select('id, tanka, codigo_itku, capacidade, inicio_locacao');
  if (listErr) throw new Error(`list: ${listErr.message}`);

  const list = rows || [];
  console.log(`Isotanques encontrados: ${list.length}`);
  if (list.length === 0) {
    console.log('Nada a atualizar.');
    return;
  }

  const ids = list.map((r) => r.id);
  const { data: updated, error: updErr } = await supabase
    .from('t_isotanques')
    .update({ capacidade: CAPACIDADE, inicio_locacao: INICIO_LOCACAO })
    .in('id', ids)
    .select('id, tanka, codigo_itku, capacidade, inicio_locacao');
  if (updErr) throw new Error(`update: ${updErr.message}`);

  console.log(`Atualizados: ${updated?.length || 0}`);
  for (const r of updated || []) {
    console.log(`  ${r.tanka || r.codigo_itku}: ${r.capacidade} L | ${r.inicio_locacao}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
