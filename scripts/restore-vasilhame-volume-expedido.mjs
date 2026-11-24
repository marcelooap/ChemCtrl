/**
 * Restaura volume/peso de vasilhames Expedido que foram zerados no legado,
 * a partir da composição (ou volume informado).
 *
 * Uso:
 *   node scripts/restore-vasilhame-volume-expedido.mjs --dry-run
 *   node scripts/restore-vasilhame-volume-expedido.mjs --op T469
 *   node scripts/restore-vasilhame-volume-expedido.mjs --ids id1,id2
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const opArg = process.argv.find((a) => a.startsWith('--op='));
const idsArg = process.argv.find((a) => a.startsWith('--ids='));
const OP = opArg ? opArg.slice(5) : process.argv.includes('--op')
  ? process.argv[process.argv.indexOf('--op') + 1]
  : null;
const IDS = idsArg
  ? idsArg.slice(6).split(',').map((s) => s.trim()).filter(Boolean)
  : null;

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

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

const env = {
  ...loadEnv(resolve('.env')),
  ...loadEnv(resolve('.env.local')),
};
const url = (env.VITE_CHEMFLOW_SUPABASE_URL || env.VITE_SUPABASE_URL || '')
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '');
const key =
  env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const sb = createClient(url, key);

if (!OP && !IDS?.length) {
  console.error('Informe --op T469 ou --ids=id1,id2 (evita restore em massa).');
  process.exit(1);
}

let query = sb
  .from('t_vasilhames')
  .select(
    'id,numero_op,placa,status,volume,peso_liquido,peso_bruto,tara,densidade,data_saida,composicao,produto_nome'
  );

if (OP) query = query.eq('numero_op', OP);
if (IDS?.length) query = query.in('id', IDS);

const { data: rows, error } = await query;
if (error) throw error;

const targets = (rows || []).filter((v) => {
  const expedido =
    String(v.status || '') === 'Expedido' ||
    (v.data_saida != null && String(v.data_saida).trim() !== '');
  if (!expedido) return false;
  const vol = Number(v.volume) || 0;
  return vol <= 0;
});

if (!targets.length) {
  console.log('Nenhum vasilhame expedido com volume zerado encontrado.');
  process.exit(0);
}

for (const v of targets) {
  const fromCompL = (v.composicao || []).reduce(
    (s, c) => s + (Number(c?.quantidade_l) || 0),
    0
  );
  const fromCompKg = (v.composicao || []).reduce(
    (s, c) => s + (Number(c?.quantidade_kg) || 0),
    0
  );
  const dens =
    parseFloat(String(v.densidade || '0').replace(',', '.')) || 0;
  let newVol = fromCompL > 0 ? round3(fromCompL) : 0;
  let newPeso =
    fromCompKg > 0
      ? round3(fromCompKg)
      : dens > 0 && newVol > 0
        ? round3(newVol * dens)
        : 0;
  if (newVol <= 0 && newPeso <= 0) {
    console.log('SKIP (sem composição):', {
      id: v.id,
      op: v.numero_op,
      placa: v.placa,
    });
    continue;
  }
  if (newVol <= 0 && dens > 0 && newPeso > 0) {
    newVol = round3(newPeso / dens);
  }
  const patch = {
    volume: newVol,
    peso_liquido: newPeso,
    peso_bruto: round3((Number(v.tara) || 0) + newPeso),
  };
  console.log({
    id: v.id,
    op: v.numero_op,
    placa: v.placa,
    produto: v.produto_nome,
    before: { volume: v.volume, peso_liquido: v.peso_liquido },
    after: patch,
  });
  if (!DRY_RUN) {
    const { error: uErr } = await sb
      .from('t_vasilhames')
      .update(patch)
      .eq('id', v.id);
    if (uErr) throw uErr;
  }
}

console.log(
  DRY_RUN
    ? `\n[dry-run] ${targets.length} candidato(s).`
    : `\nOK: volumes restaurados.`
);
