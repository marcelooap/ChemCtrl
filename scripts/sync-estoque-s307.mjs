/**
 * Sincroniza saldo_final do estoque afetado pelos vasilhames da S307.
 * Uso: node scripts/sync-estoque-s307.mjs
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

const VAS_IDS = [
  '0ce122ed-98b0-42c1-81d6-6051dd636fb9',
  '9a66cdaf-ff97-4e9d-8988-0e204a9aa8d6',
  'f9945b7d-a7f9-4e2e-86a7-6728ec1bf033',
];

const { data: vas, error: vErr } = await sb
  .from('t_vasilhames')
  .select('id,placa,status,volume,peso_liquido,data_saida,lote,produto_nome,composicao')
  .in('id', VAS_IDS);
if (vErr) throw vErr;

console.log('=== VASILHAMES ATUAIS ===');
console.log(
  vas.map((v) => ({
    placa: v.placa,
    status: v.status,
    volume: v.volume,
    data_saida: v.data_saida,
    lote: v.lote,
    composicao: v.composicao,
  }))
);

const estIds = new Set();
for (const v of vas || []) {
  for (const c of v.composicao || []) {
    if (c?.estoque_id) estIds.add(String(c.estoque_id));
    if (c?.entrada_id) estIds.add(String(c.entrada_id));
  }
}

console.log('\n=== COMPOSICAO ===');
for (const v of vas || []) {
  console.log(v.placa, JSON.stringify(v.composicao, null, 2));
}

// Fallback: estoque do mesmo lote METANOL
const { data: estByLote, error: eErr } = await sb
  .from('estoque_produtos')
  .select('id,codigo_estoque,produto_nome,lote,saldo_inicial,saldo_final,unidade_medida,origem')
  .eq('lote', 'PA26-00936.001')
  .ilike('produto_nome', '%METANOL%');
if (eErr) throw eErr;

console.log('\n=== ESTOQUE LOTE PA26-00936.001 ===');
console.log(estByLote);

for (const e of estByLote || []) estIds.add(String(e.id));

// Quantos vasilhames No Pátio ainda têm esse lote?
const { data: patio, error: pErr } = await sb
  .from('t_vasilhames')
  .select('id,placa,status,volume,peso_liquido,lote,produto_nome')
  .eq('lote', 'PA26-00936.001')
  .eq('status', 'No Pátio');
if (pErr) throw pErr;

const patioVol = (patio || []).reduce((s, v) => s + (Number(v.volume) || 0), 0);
const patioPeso = (patio || []).reduce((s, v) => s + (Number(v.peso_liquido) || 0), 0);

console.log('\n=== PÁTIO RESTANTE LOTE ===');
console.log({
  count: patio?.length || 0,
  volume_total: patioVol,
  peso_total: patioPeso,
  placas: (patio || []).map((v) => `${v.placa}:${v.volume}L/${v.peso_liquido}kg`),
});

console.log('\n=== ESTOQUE IDS COLETADOS ===', [...estIds]);

// Baixa persistida: 6336 kg (peso total S307). Se houver 1 registro de estoque
// do lote, recalcula saldo_final = max(0, saldo_inicial - expedido_patio_kg).
// Aqui só reportamos; a baixa visual no pátio já está correta (Expedido).
const baixadoKg = 3960 + 1188 + 1188;
console.log('\n=== BAIXA S307 (kg) ===', baixadoKg);
for (const e of estByLote || []) {
  const inicial = Number(e.saldo_inicial) || 0;
  const atual = Number(e.saldo_final) || 0;
  console.log({
    id: e.id,
    codigo: e.codigo_estoque,
    saldo_inicial: inicial,
    saldo_final_atual: atual,
    esperado_se_unico_lote: Math.max(0, inicial - baixadoKg),
  });
}