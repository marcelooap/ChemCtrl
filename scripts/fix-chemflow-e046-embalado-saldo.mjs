/**
 * Corrige estoque E046 (ENERC ACD CL-IN) após transbordo embalado T011.
 * Baixa deve usar a UOM da entrada (644 kg), saldo atual = 1150 - 644 = 506.
 *
 * Uso:
 *   node scripts/fix-chemflow-e046-embalado-saldo.mjs
 *   node scripts/fix-chemflow-e046-embalado-saldo.mjs --dry-run
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const EST_ID = 'ee81403a-81fe-46b0-b647-759c8baa9112';
const T011_ID = 'd17409f2-cc12-41bc-b0ad-a750fd5d9cfb';
const VAS_ID = '5eb0b057-6b23-4b29-bc2a-de511ba129db';
const QTD_ENTRADA = 1150;
const QTD_TRANSFERIDA = 644;
const SALDO_ESPERADO = QTD_ENTRADA - QTD_TRANSFERIDA; // 506

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

function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
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

const { data: estoque, error: eErr } = await sb
  .from('t_estoque')
  .select('*')
  .eq('id', EST_ID)
  .maybeSingle();
if (eErr) throw eErr;
if (!estoque) {
  console.error('Estoque E046 não encontrado');
  process.exit(1);
}

const { data: t011, error: tErr } = await sb
  .from('t_transbordos')
  .select('*')
  .eq('id', T011_ID)
  .maybeSingle();
if (tErr) throw tErr;

const { data: vas, error: vErr } = await sb
  .from('t_vasilhames')
  .select('*')
  .eq('id', VAS_ID)
  .maybeSingle();
if (vErr) throw vErr;

console.log('Antes:', {
  estoque: {
    quantidade: estoque.quantidade,
    saldo_atual: estoque.saldo_atual,
    unidade: estoque.unidade_medida,
  },
  t011: t011 && {
    volume_total: t011.volume_total,
    massa_total: t011.massa_total,
    origens: parseArr(t011.origens),
    destinos: parseArr(t011.destinos),
  },
  vasilhame: vas && {
    volume: vas.volume,
    peso_liquido: vas.peso_liquido,
    composicao: vas.composicao,
    status: vas.status,
  },
});

const origens = parseArr(t011?.origens).map((o) => ({
  ...o,
  unidade_medida: o.unidade_medida || 'kg',
  embalado: true,
  volume_retirado: QTD_TRANSFERIDA,
  massa_retirada: QTD_TRANSFERIDA,
  saldo_restante: SALDO_ESPERADO,
  saldo_disponivel: o.saldo_disponivel ?? QTD_ENTRADA,
}));

const destinos = parseArr(t011?.destinos).map((d) => ({
  ...d,
  volume: QTD_TRANSFERIDA,
  volume_total: QTD_TRANSFERIDA,
  peso_liquido: QTD_TRANSFERIDA,
  peso_bruto: QTD_TRANSFERIDA + (Number(d.tara) || 0),
}));

const composicao = (Array.isArray(vas?.composicao) ? vas.composicao : []).map(
  (c, i) =>
    i === 0
      ? {
          ...c,
          quantidade_l: QTD_TRANSFERIDA,
          quantidade_kg: QTD_TRANSFERIDA,
        }
      : c
);

const estoquePatch = {
  saldo_atual: SALDO_ESPERADO,
  unidade_medida: 'kg',
  quantidade: QTD_ENTRADA,
};

const t011Patch = {
  volume_total: QTD_TRANSFERIDA,
  massa_total: QTD_TRANSFERIDA,
  origens,
  destinos,
};

const vasPatch = {
  volume: QTD_TRANSFERIDA,
  peso_liquido: QTD_TRANSFERIDA,
  peso_bruto: QTD_TRANSFERIDA + (Number(vas?.tara) || 0),
  composicao:
    composicao.length > 0
      ? composicao
      : [
          {
            lote: estoque.lote || '1504092581',
            quantidade_l: QTD_TRANSFERIDA,
            quantidade_kg: QTD_TRANSFERIDA,
            origem_index: 0,
            transbordo_codigo: 'T011',
            data: '2026-08-12',
          },
        ],
};

console.log('Depois (previsto):', {
  estoque: estoquePatch,
  t011: { volume_total: t011Patch.volume_total, massa_total: t011Patch.massa_total, origens, destinos },
  vasilhame: vasPatch,
  expedido: QTD_TRANSFERIDA,
  saldo_atual: SALDO_ESPERADO,
});

if (DRY_RUN) {
  console.log('[dry-run] Nenhuma alteração persistida.');
  process.exit(0);
}

const { error: u1 } = await sb.from('t_estoque').update(estoquePatch).eq('id', EST_ID);
if (u1) throw u1;

if (t011) {
  const { error: u2 } = await sb.from('t_transbordos').update(t011Patch).eq('id', T011_ID);
  if (u2) throw u2;
}

if (vas) {
  const { error: u3 } = await sb.from('t_vasilhames').update(vasPatch).eq('id', VAS_ID);
  if (u3) throw u3;
}

console.log('OK: E046 ajustado — expedido 644 kg, estoque atual 506 kg.');
