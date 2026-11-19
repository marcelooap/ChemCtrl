/**
 * Corrige E478 / T207: massa do transbordo não pode exceder o peso líquido.
 *
 * Antes: massa_total 39.240,3 kg (L×dens) com peso líquido 39.240 kg.
 * Depois: massa_total / massa_retirada / pesos dos destinos somam 39.240 kg.
 *
 * Uso:
 *   node scripts/fix-chemflow-e478-massa.mjs --dry-run
 *   node scripts/fix-chemflow-e478-massa.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const TRANSBORDO_ID = '5659a643-6cf7-422c-82bc-75b4ea19112d';
const MASSA_ALVO = 39240;

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

function roundMass(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function alignDestinosMassa(destinos, target) {
  const sum = roundMass(
    destinos.reduce((s, d) => s + (Number(d.peso_liquido) || 0), 0)
  );
  if (!(sum > 0) || Math.abs(sum - target) < 1e-9) return destinos;
  const delta = roundMass(sum - target);
  if (Math.abs(delta) > 1 + 1e-9) {
    throw new Error(
      `Diferença ${delta} kg fora da tolerância residual — abortando`
    );
  }
  let lastIdx = destinos.length - 1;
  for (let i = destinos.length - 1; i >= 0; i -= 1) {
    if ((Number(destinos[i].peso_liquido) || 0) > 0) {
      lastIdx = i;
      break;
    }
  }
  return destinos.map((d, i) => {
    if (i !== lastIdx) return d;
    const peso = roundMass((Number(d.peso_liquido) || 0) - delta);
    return {
      ...d,
      peso_liquido: peso,
      peso_bruto: roundMass((Number(d.tara) || 0) + peso),
    };
  });
}

const env = {
  ...loadEnv(resolve('.env')),
  ...loadEnv(resolve('.env.local')),
};
const url = (
  env.VITE_CHEMFLOW_SUPABASE_URL ||
  env.VITE_SUPABASE_URL ||
  ''
)
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '');
const key =
  env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Configure VITE_CHEMFLOW/VITE_SUPABASE URL+KEY no .env');
  process.exit(1);
}

const sb = createClient(url, key);

const { data: tb, error: tbErr } = await sb
  .from('t_transbordos')
  .select('id,codigo_transbordo,volume_total,massa_total,origens,destinos')
  .eq('id', TRANSBORDO_ID)
  .maybeSingle();

if (tbErr) {
  console.error(tbErr);
  process.exit(1);
}
if (!tb) {
  console.error('Transbordo T207 não encontrado');
  process.exit(1);
}

const sumAntes = roundMass(
  (tb.destinos || []).reduce((s, d) => s + (Number(d.peso_liquido) || 0), 0)
);
console.log('Antes:', {
  codigo: tb.codigo_transbordo,
  volume_total: tb.volume_total,
  massa_total: tb.massa_total,
  massa_retirada: tb.origens?.[0]?.massa_retirada,
  destinos: (tb.destinos || []).map((d) => ({
    tanka: d.tanka_codigo,
    volume: d.volume_total ?? d.volume,
    peso_liquido: d.peso_liquido,
  })),
  sumDestinos: sumAntes,
});

if (Math.abs(Number(tb.massa_total) - MASSA_ALVO) < 1e-9 && Math.abs(sumAntes - MASSA_ALVO) < 1e-9) {
  console.log('Já alinhado a', MASSA_ALVO, 'kg — nada a fazer.');
  process.exit(0);
}

const destinos = alignDestinosMassa(tb.destinos || [], MASSA_ALVO);
const origens = (tb.origens || []).map((o, i) =>
  i === 0 ? { ...o, massa_retirada: MASSA_ALVO } : o
);
const sumDepois = roundMass(
  destinos.reduce((s, d) => s + (Number(d.peso_liquido) || 0), 0)
);

const patch = {
  massa_total: MASSA_ALVO,
  origens,
  destinos,
};

console.log('Depois:', {
  massa_total: patch.massa_total,
  massa_retirada: origens[0]?.massa_retirada,
  destinos: destinos.map((d) => ({
    tanka: d.tanka_codigo,
    volume: d.volume_total ?? d.volume,
    peso_liquido: d.peso_liquido,
  })),
  sumDestinos: sumDepois,
  dryRun: DRY_RUN,
});

if (DRY_RUN) {
  console.log('Dry-run: nenhuma alteração gravada.');
  process.exit(0);
}

const { data: updated, error: updErr } = await sb
  .from('t_transbordos')
  .update(patch)
  .eq('id', TRANSBORDO_ID)
  .select('id,codigo_transbordo,massa_total,origens,destinos')
  .maybeSingle();

if (updErr) {
  console.error('Falha ao atualizar T207:', updErr);
  process.exit(1);
}

console.log('Atualizado:', {
  codigo: updated?.codigo_transbordo,
  massa_total: updated?.massa_total,
  massa_retirada: updated?.origens?.[0]?.massa_retirada,
  destinos: (updated?.destinos || []).map((d) => ({
    tanka: d.tanka_codigo,
    peso_liquido: d.peso_liquido,
  })),
});
