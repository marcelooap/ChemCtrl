/**
 * Unifica os vasilhames "One Way (IBC)" do PROSOLV HS 8785 (T002 + T003)
 * em uma única linha com o volume total somado (34.700 L).
 *
 * Mantém a primeira linha (barril 1/34) e apaga as demais.
 * A composição é somada por lote; peso líquido/bruto recalculados pela densidade.
 *
 * Uso:
 *   node scripts/merge-chemflow-ibc-vasilhames.mjs --dry-run
 *   node scripts/merge-chemflow-ibc-vasilhames.mjs
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

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const root = resolve(process.cwd());
  const env = {
    ...loadEnv(resolve(root, '.env')),
    ...loadEnv(resolve(root, '.env.local')),
    ...process.env,
  };
  const url = (env.VITE_CHEMFLOW_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '');
  const key = (env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) {
    console.error('Configure VITE_CHEMFLOW_SUPABASE_URL e VITE_CHEMFLOW_SUPABASE_ANON_KEY no .env');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const { data: rows, error } = await supabase
    .from('vasilhames')
    .select('*')
    .ilike('tipo', '%IBC%')
    .eq('produto_codigo', '24051603')
    .eq('status', 'No Pátio');
  if (error) throw new Error(error.message);

  if (!rows || rows.length < 2) {
    console.log(`Nada a unificar (${rows?.length || 0} linha(s) IBC encontradas).`);
    return;
  }

  // Ordena para manter determinístico: barril 1/34 primeiro
  rows.sort((a, b) => {
    const na = parseInt(a.barril, 10) || 0;
    const nb = parseInt(b.barril, 10) || 0;
    if (a.numero_op !== b.numero_op) return a.numero_op < b.numero_op ? -1 : 1;
    return na - nb;
  });
  const keeper = rows[0];
  const others = rows.slice(1);

  // Soma volumes e composição agrupada por lote
  let totalVolume = 0;
  const compByLote = new Map();
  for (const v of rows) {
    totalVolume += Number(v.volume) || 0;
    for (const c of v.composicao || []) {
      const lote = (c.lote || '').trim();
      const cur = compByLote.get(lote) || {
        lote,
        origem_index: c.origem_index ?? 0,
        quantidade_l: 0,
        quantidade_kg: 0,
      };
      cur.quantidade_l += Number(c.quantidade_l) || 0;
      cur.quantidade_kg += Number(c.quantidade_kg) || 0;
      compByLote.set(lote, cur);
    }
  }
  const composicao = [...compByLote.values()].map((c) => ({
    ...c,
    quantidade_l: Math.round(c.quantidade_l),
    quantidade_kg: Math.round(c.quantidade_kg),
  }));

  const densidade = parseFloat(keeper.densidade) || 0;
  const tara = Number(keeper.tara) || 0;
  const pesoLiquido = Math.round(totalVolume * densidade);
  const patch = {
    barril: '1/1',
    volume: totalVolume,
    peso_liquido: pesoLiquido,
    peso_bruto: pesoLiquido + tara,
    composicao,
    fracionado: false,
  };

  console.log(`Linhas IBC encontradas: ${rows.length}`);
  console.log(`Manter: ${keeper.id} (op ${keeper.numero_op}, barril ${keeper.barril})`);
  console.log(`Novo estado: volume=${totalVolume} L, peso_liquido=${pesoLiquido} kg`);
  console.log(`Composição unificada: ${JSON.stringify(composicao)}`);
  console.log(`Apagar: ${others.length} linha(s)`);

  if (dryRun) {
    console.log('\n[dry-run] Nenhuma escrita realizada.');
    return;
  }

  const { error: upErr } = await supabase
    .from('vasilhames')
    .update(patch)
    .eq('id', keeper.id);
  if (upErr) throw new Error(`update keeper: ${upErr.message}`);

  const { error: delErr } = await supabase
    .from('vasilhames')
    .delete()
    .in('id', others.map((v) => v.id));
  if (delErr) throw new Error(`delete: ${delErr.message}`);

  console.log(`\nConcluído: 1 linha mantida com ${totalVolume} L, ${others.length} apagadas.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
