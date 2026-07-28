/**
 * Remove de `filtracoes` registros que não são tipo Vasilhame (ex.: Tankagem).
 * Uso: node scripts/cleanup-chemflow-filtracoes-nao-vasilhame.mjs
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
    console.error('Configure VITE_CHEMFLOW_SUPABASE_URL e VITE_CHEMFLOW_SUPABASE_ANON_KEY');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const { data: filtracoes, error: errF } = await supabase
    .from('filtracoes')
    .select('id, vasilhame_id, placa, codigo');
  if (errF) throw new Error(errF.message);

  const ids = (filtracoes || []).map((f) => f.vasilhame_id).filter(Boolean);
  if (ids.length === 0) {
    console.log('Nenhuma filtração.');
    return;
  }

  const { data: vasilhames, error: errV } = await supabase
    .from('vasilhames')
    .select('id, tipo, placa')
    .in('id', ids);
  if (errV) throw new Error(errV.message);

  const byId = Object.fromEntries((vasilhames || []).map((v) => [v.id, v]));
  const toDelete = (filtracoes || []).filter((f) => {
    const v = byId[f.vasilhame_id];
    return !v || v.tipo !== 'Vasilhame';
  });

  console.log(`Filtrações totais: ${(filtracoes || []).length}`);
  console.log(`Remover (não Vasilhame): ${toDelete.length}`);
  for (const f of toDelete) {
    console.log(`  - ${f.codigo || '-'} | ${f.placa || '-'} | tipo=${byId[f.vasilhame_id]?.tipo || '?'}`);
  }

  if (toDelete.length === 0) return;

  const { error } = await supabase
    .from('filtracoes')
    .delete()
    .in(
      'id',
      toDelete.map((f) => f.id)
    );
  if (error) throw new Error(error.message);
  console.log(`Removidos: ${toDelete.length}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
