/**
 * Unifica bombonas / IBC / tambores duplicados em t_vasilhames
 * (mesmo OP + tipo + status) em 1 linha com quantidade total.
 *
 * Ex.: 5× "01 x Bombonas de 200 L" (T221) → "05 x Bombonas de 200 L"
 *
 * Uso:
 *   node scripts/consolidate-unitario-vasilhames.mjs --dry-run
 *   node scripts/consolidate-unitario-vasilhames.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TIPOS = new Set([
  'One Way (IBC)',
  'Bombona de 200 L',
  'Tambor 200 L',
  'Bombona de 50 L',
  'Bombona de 25 L',
  'Bombona de 20 L',
  'Bombona 200 L',
  'bombona de 200 L',
  'tambor 200 L',
  'bombona de 50 L',
  'bombona de 25 L',
  'bombona de 20 L',
]);

const VOLUME_PADRAO = {
  'Bombona de 200 L': 200,
  'Bombona 200 L': 200,
  'bombona de 200 L': 200,
  'Tambor 200 L': 200,
  'tambor 200 L': 200,
  'Bombona de 50 L': 50,
  'bombona de 50 L': 50,
  'Bombona de 25 L': 25,
  'bombona de 25 L': 25,
  'Bombona de 20 L': 20,
  'bombona de 20 L': 20,
};

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

function pluralizeLabel(tipo) {
  const raw = String(tipo || '').trim();
  const lower = raw.toLowerCase();
  if (lower.startsWith('bombona ')) return `Bombonas ${raw.slice(raw.indexOf(' ') + 1)}`;
  if (lower === 'bombona') return 'Bombonas';
  if (lower.startsWith('tambor ')) return `Tambores ${raw.slice(raw.indexOf(' ') + 1)}`;
  if (lower === 'tambor') return 'Tambores';
  if (lower.includes('ibc')) return raw;
  return raw;
}

function buildPlaca(qtd, tipo) {
  const n = String(Math.max(0, Math.round(Number(qtd) || 0))).padStart(2, '0');
  return `${n} x ${pluralizeLabel(tipo)}`;
}

function qtdFromRow(v) {
  const fromComp = (v.composicao || []).find(
    (c) => Number(c.quantidade_embalagens) > 0
  )?.quantidade_embalagens;
  if (fromComp > 0) return Math.round(Number(fromComp));
  const m = String(v.placa || '').match(/^(\d+)\s*x\s*/i);
  if (m) return parseInt(m[1], 10) || 0;
  const padrao = VOLUME_PADRAO[v.tipo];
  const volume = Number(v.volume) || 0;
  if (padrao > 0 && volume > 0) return Math.max(1, Math.round(volume / padrao));
  return 1;
}

function volPorEmbFromRow(v) {
  const fromComp = (v.composicao || []).find(
    (c) => Number(c.volume_por_embalagem) > 0
  )?.volume_por_embalagem;
  if (fromComp > 0) return Number(fromComp);
  return VOLUME_PADRAO[v.tipo] || 0;
}

function opKey(v) {
  return (
    v.transbordo_id ||
    String(v.numero_op || '').trim() ||
    String(v.codigo || '').trim() ||
    ''
  );
}

function statusKey(v) {
  const status = (v.status || 'No Pátio').trim() || 'No Pátio';
  const dataSaida = v.data_saida ? String(v.data_saida).slice(0, 10) : '';
  return `${status}|${dataSaida}`;
}

function densOf(v) {
  return parseFloat(String(v.densidade || '0').replace(',', '.')) || 0;
}

function prepareRow(v) {
  let volume = round3(v.volume || 0);
  let peso = round3(v.peso_liquido || 0);
  const qtd = Math.max(1, qtdFromRow(v));
  const volPorEmb = volPorEmbFromRow(v) || VOLUME_PADRAO[v.tipo] || 0;
  if (volume <= 0) {
    const fromComp = (v.composicao || []).reduce(
      (s, c) => s + (Number(c.quantidade_l) || 0),
      0
    );
    if (fromComp > 0) volume = round3(fromComp);
    else if (volPorEmb > 0) volume = round3(qtd * volPorEmb);
  }
  if (peso <= 0) {
    const fromComp = (v.composicao || []).reduce(
      (s, c) => s + (Number(c.quantidade_kg) || 0),
      0
    );
    if (fromComp > 0) peso = round3(fromComp);
    else {
      const dens = densOf(v);
      if (dens > 0 && volume > 0) peso = round3(volume * dens);
    }
  }
  return { ...v, volume, peso_liquido: peso, _qtd: qtd, _volPorEmb: volPorEmb };
}

async function fetchAll(supabase, table) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const chunk = data || [];
    all.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return all;
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
    console.error(
      'Configure VITE_CHEMFLOW_SUPABASE_URL e VITE_CHEMFLOW_SUPABASE_ANON_KEY no .env'
    );
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const rows = (await fetchAll(supabase, 't_vasilhames')).filter((v) =>
    TIPOS.has(v.tipo || '')
  );
  console.log(`Unitários encontrados: ${rows.length}`);

  const groups = new Map();
  for (const v of rows) {
    const op = opKey(v);
    if (!op) continue;
    const key = `${op}|${String(v.tipo || '').trim()}|${statusKey(v)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }

  const toMerge = [...groups.entries()].filter(([, g]) => g.length > 1);
  console.log(`Grupos a unificar: ${toMerge.length}`);

  if (toMerge.length === 0) {
    console.log('Nada a fazer.');
    return;
  }

  let deleted = 0;
  let mergedGroups = 0;
  const replacements = [];

  for (const [key, group] of toMerge) {
    const sorted = [...group].sort((a, b) => {
      const da = new Date(a.created_at || a.created_date || 0).getTime();
      const db = new Date(b.created_at || b.created_date || 0).getTime();
      if (da !== db) return da - db;
      return String(a.id).localeCompare(String(b.id));
    });
    const [primary, ...others] = sorted;
    const prepared = sorted.map(prepareRow);

    let volume = 0;
    let peso = 0;
    let qtd = 0;
    let volPorEmb = 0;
    const lotes = new Map();
    for (const p of prepared) {
      volume += Number(p.volume) || 0;
      peso += Number(p.peso_liquido) || 0;
      qtd += Number(p._qtd) || 0;
      if (!volPorEmb && p._volPorEmb) volPorEmb = p._volPorEmb;
      for (const c of p.composicao || []) {
        const lote = String(c.lote || '').trim();
        const cur = lotes.get(lote) || {
          lote,
          quantidade_l: 0,
          quantidade_kg: 0,
          transbordo_codigo: c.transbordo_codigo || primary.numero_op || primary.codigo || null,
          data: c.data || null,
        };
        cur.quantidade_l += Number(c.quantidade_l) || 0;
        cur.quantidade_kg += Number(c.quantidade_kg) || 0;
        lotes.set(lote, cur);
      }
    }
    volume = round3(volume);
    peso = round3(peso);
    if (!volPorEmb) volPorEmb = VOLUME_PADRAO[primary.tipo] || 0;
    if (qtd <= 0 && volPorEmb > 0 && volume > 0) {
      qtd = Math.max(1, Math.round(volume / volPorEmb));
    }

    let composicao = [...lotes.values()].map((c) => ({
      ...c,
      quantidade_l: round3(c.quantidade_l),
      quantidade_kg: round3(c.quantidade_kg),
    }));
    if (composicao.length === 0) {
      composicao = [
        {
          lote: primary.lote || '',
          quantidade_l: volume,
          quantidade_kg: peso,
          quantidade_embalagens: qtd,
          volume_por_embalagem: volPorEmb,
          transbordo_codigo: primary.numero_op || primary.codigo || null,
          data: null,
        },
      ];
    } else {
      composicao = composicao.map((c, i) =>
        i === 0
          ? {
              ...c,
              quantidade_embalagens: qtd,
              volume_por_embalagem: volPorEmb,
              quantidade_l: volume,
              quantidade_kg: peso,
            }
          : c
      );
    }

    const placa = buildPlaca(qtd || 1, primary.tipo);
    const tara = Number(primary.tara) || 0;
    const patch = {
      volume,
      peso_liquido: peso,
      peso_bruto: round3(tara + peso),
      placa,
      barril: '',
      lote: primary.lote || composicao[0]?.lote || '',
      status: primary.status || 'No Pátio',
      data_saida:
        primary.data_saida ||
        others.find((o) => o.data_saida)?.data_saida ||
        null,
      composicao,
    };

    console.log(
      `\n[${key}] ${group.length} → 1 | keep=${primary.id} | ${placa} | ${volume} L | ${peso} kg | apagar=${others.length}`
    );

    if (dryRun) {
      deleted += others.length;
      mergedGroups += 1;
      continue;
    }

    const { error: upErr } = await supabase
      .from('t_vasilhames')
      .update(patch)
      .eq('id', primary.id);
    if (upErr) throw new Error(`update ${primary.id}: ${upErr.message}`);

    for (const o of others) {
      replacements.push({ from: o.id, to: primary.id });
      const { error: delErr } = await supabase
        .from('t_vasilhames')
        .delete()
        .eq('id', o.id);
      if (delErr) throw new Error(`delete ${o.id}: ${delErr.message}`);
      deleted += 1;
    }
    mergedGroups += 1;
  }

  if (!dryRun && replacements.length > 0) {
    const saidas = await fetchAll(supabase, 't_saidas');
    const map = new Map(replacements.map((r) => [String(r.from), String(r.to)]));
    let saidasUpdated = 0;
    for (const saida of saidas) {
      let changed = false;
      const itens = (saida.itens || []).map((item) => {
        const next = map.get(String(item?.vasilhame_id || ''));
        if (!next) return item;
        changed = true;
        return { ...item, vasilhame_id: next };
      });
      if (!changed) continue;
      const { error } = await supabase
        .from('t_saidas')
        .update({ itens })
        .eq('id', saida.id);
      if (error) throw new Error(`saida ${saida.id}: ${error.message}`);
      saidasUpdated += 1;
    }
    console.log(`\nSaídas religadas: ${saidasUpdated}`);
  }

  console.log(
    `\n${dryRun ? '[dry-run] ' : ''}Grupos unificados: ${mergedGroups} | linhas removidas: ${deleted}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
