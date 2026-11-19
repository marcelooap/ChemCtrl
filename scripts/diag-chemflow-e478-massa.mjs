/**
 * Diagnóstico E478: peso líquido vs massa total do transbordo.
 * Uso: node scripts/diag-chemflow-e478-massa.mjs
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

function isMissing(error) {
  return (
    error &&
    (error.code === 'PGRST205' ||
      error.code === '42P01' ||
      /Could not find the table|schema cache/i.test(error.message || ''))
  );
}

async function firstOk(names, run) {
  let lastError = null;
  for (const name of names) {
    const result = await run(name);
    if (!result.error) return { table: name, data: result.data, error: null };
    lastError = result.error;
    if (!isMissing(result.error)) {
      return { table: name, data: null, error: result.error };
    }
  }
  return { table: null, data: null, error: lastError };
}

console.log('=== TABLES ===');
for (const t of [
  'estoque_produtos',
  't_transbordos',
  'transbordos',
  't_vasilhames',
  'vasilhames',
  'cadastro_tanka',
]) {
  const { error, count } = await sb
    .from(t)
    .select('*', { count: 'exact', head: true });
  console.log(
    t,
    error ? `ERR ${error.code || ''} ${error.message}` : `ok count=${count}`
  );
}

const estoqueProbe = await firstOk(['estoque_produtos'], async (table) =>
  sb
    .from(table)
    .select('*')
    .or('id_entrada.eq.E478,grupo_entrada.eq.E478,legacy_entrada_codigo.eq.E478')
    .limit(20)
);

console.log('=== ESTOQUE E478 via', estoqueProbe.table, '===');
if (estoqueProbe.error) {
  console.error(estoqueProbe.error);
  process.exit(1);
}
const rows = estoqueProbe.data || [];
console.log(
  JSON.stringify(
    rows.map((r) => ({
      id: r.id,
      id_entrada: r.id_entrada,
      grupo_entrada: r.grupo_entrada,
      origem: r.origem,
      produto_nome: r.produto_nome,
      produto_codigo: r.produto_codigo,
      lote: r.lote,
      quantidade: r.quantidade,
      saldo_inicial: r.saldo_inicial,
      saldo_atual: r.saldo_atual,
      saldo_final: r.saldo_final,
      densidade: r.densidade,
      granel_margem: r.granel_margem,
      granel_peso_liquido: r.granel_peso_liquido,
      granel_peso_bruto: r.granel_peso_bruto,
      nota_fiscal: r.nota_fiscal,
      data: r.data,
    })),
    null,
    2
  )
);

const origemIds = new Set(
  rows.flatMap((e) => [e.id, e.legacy_entrada_id, String(e.id)]).filter(Boolean)
);
const grupo = rows[0]?.grupo_entrada;

const tbProbe = await firstOk(['t_transbordos', 'transbordos'], async (table) =>
  sb
    .from(table)
    .select(
      'id,codigo_transbordo,data,densidade,volume_total,massa_total,produto_nome,origens,destinos,created_at'
    )
    .order('created_at', { ascending: false })
    .limit(500)
);

if (tbProbe.error) {
  console.error('transbordos:', tbProbe.error);
  process.exit(1);
}

const related = (tbProbe.data || []).filter((t) =>
  (t.origens || []).some((o) => {
    const eid = String(o.entrada_id || '');
    const cod = String(o.entrada_codigo || '');
    const est = String(o.estoque_id || '');
    return (
      origemIds.has(eid) ||
      origemIds.has(Number(eid)) ||
      origemIds.has(est) ||
      origemIds.has(Number(est)) ||
      /E478/i.test(cod) ||
      (grupo && cod.includes(String(grupo)))
    );
  })
);

console.log(
  '=== TRANSBORDOS RELACIONADOS via',
  tbProbe.table,
  '===',
  related.length
);
for (const t of related) {
  const dens = Number(String(t.densidade || '').replace(',', '.')) || 0;
  const destinos = (t.destinos || []).map((d) => {
    const vol = Number(d.volume_total ?? d.volume) || 0;
    const peso = Number(d.peso_liquido);
    const calc = dens > 0 ? Math.round(vol * dens * 1000) / 1000 : null;
    return {
      tipo: d.tipo_embalagem,
      tanka: d.tanka_codigo,
      tanka_id: d.tanka_id,
      volume: vol,
      peso_liquido: Number.isFinite(peso) ? peso : null,
      calc_vol_x_dens: calc,
    };
  });
  const sumPeso = destinos.reduce(
    (s, d) => s + (Number(d.peso_liquido) || Number(d.calc_vol_x_dens) || 0),
    0
  );
  const sumVol = destinos.reduce((s, d) => s + (Number(d.volume) || 0), 0);
  console.log(
    JSON.stringify(
      {
        id: t.id,
        codigo: t.codigo_transbordo,
        densidade: t.densidade,
        volume_total: t.volume_total,
        massa_total: t.massa_total,
        origens: (t.origens || []).map((o) => ({
          entrada_id: o.entrada_id,
          entrada_codigo: o.entrada_codigo,
          volume_retirado: o.volume_retirado,
          massa_retirada: o.massa_retirada,
        })),
        destinos,
        sumVol,
        sumPeso,
      },
      null,
      2
    )
  );

  const { data: vas, error: vErr } = await sb
    .from('t_vasilhames')
    .select(
      'id,codigo,numero_op,placa,volume,peso_liquido,peso_bruto,status,transbordo_id,tipo,composicao'
    )
    .or(`numero_op.eq.${t.codigo_transbordo},transbordo_id.eq.${t.id}`)
    .limit(20);
  console.log('=== VASILHAMES OP', t.codigo_transbordo, '===');
  if (vErr) console.error(vErr);
  else
    console.log(
      JSON.stringify(
        (vas || []).map((x) => ({
          id: x.id,
          codigo: x.codigo,
          numero_op: x.numero_op,
          placa: x.placa,
          volume: x.volume,
          peso_liquido: x.peso_liquido,
          status: x.status,
          tipo: x.tipo,
          transbordo_id: x.transbordo_id,
          composicao: x.composicao,
        })),
        null,
        2
      )
    );

  for (const d of destinos) {
    if (!d.tanka_id && !d.tanka) continue;
    let q = sb
      .from('t_vasilhames')
      .select(
        'id,codigo,numero_op,placa,volume,peso_liquido,status,tipo,composicao'
      )
      .eq('tipo', 'Tankagem')
      .limit(10);
    if (d.tanka) q = q.ilike('placa', d.tanka);
    const { data: tankRows, error: tankErr } = await q;
    console.log('=== TANKA ROWS', d.tanka, '===');
    if (tankErr) console.error(tankErr);
    else
      console.log(
        JSON.stringify(
          (tankRows || []).map((x) => ({
            id: x.id,
            placa: x.placa,
            volume: x.volume,
            peso_liquido: x.peso_liquido,
            status: x.status,
            numero_op: x.numero_op,
            composicao_len: Array.isArray(x.composicao)
              ? x.composicao.length
              : 0,
            composicao_e478: (x.composicao || []).filter((c) =>
              /E478|3755378|T207/i.test(
                JSON.stringify(c?.transbordo_codigo || c || '')
              )
            ),
          })),
          null,
          2
        )
      );
  }
}
