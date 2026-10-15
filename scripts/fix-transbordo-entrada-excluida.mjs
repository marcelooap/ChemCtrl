/**
 * Desfaz transbordos cuja origem de estoque já não existe
 * (entrada excluída sem reverter o volume nas tankas).
 *
 *   node scripts/fix-transbordo-entrada-excluida.mjs
 *   node scripts/fix-transbordo-entrada-excluida.mjs --apply
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

function isOrigemDeEstoque(origem) {
  if (!origem?.entrada_id) return false;
  const tipo = origem.tipo_origem;
  return !tipo || tipo === 'entrada' || tipo === 'embalado';
}

async function listAll(sb, table, select) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

const apply = process.argv.includes('--apply');
const env = loadEnv(resolve('.env'));
const url = (env.VITE_CHEMFLOW_SUPABASE_URL || env.VITE_SUPABASE_URL || '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '');
const key = (env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
if (!url || !key) {
  console.error('Credenciais ausentes');
  process.exit(1);
}
const sb = createClient(url, key);

const estoque = await listAll(sb, 't_estoque', 'id');
const estoqueIds = new Set(estoque.map((e) => String(e.id)));
const transbordos = await listAll(
  sb,
  't_transbordos',
  'id,codigo_transbordo,origens,destinos,volume_total'
);

const orfaos = [];
for (const t of transbordos) {
  const origens = t.origens || [];
  const deEstoque = origens.filter(isOrigemDeEstoque);
  if (deEstoque.length === 0) continue;
  const missing = deEstoque.filter((o) => !estoqueIds.has(String(o.entrada_id)));
  if (missing.length === 0) continue;
  const exclusivo = missing.length === origens.length;
  orfaos.push({
    id: t.id,
    codigo: t.codigo_transbordo,
    exclusivo,
    missing: missing.map((o) => ({
      codigo: o.entrada_codigo,
      lote: o.lote,
      vol: o.volume_retirado,
    })),
    destinos: (t.destinos || []).map((d) => ({
      tipo: d.tipo_embalagem,
      tanka: d.tanka_codigo || d.placa || '',
      vol: d.volume_total || d.volume || 0,
    })),
  });
}

console.log(apply ? 'APPLY' : 'DRY-RUN', 'orfaos', orfaos.length);
for (const o of orfaos) console.log(JSON.stringify(o));

const exclusivos = orfaos.filter((o) => o.exclusivo);
const parciais = orfaos.filter((o) => !o.exclusivo);
if (parciais.length > 0) {
  console.error('Ha orfaos parciais; nao aplicar automaticamente.');
  process.exit(1);
}

function norm(v) {
  return String(v || '').trim().toUpperCase();
}
function matchesTank(ref, codigo) {
  return norm(ref?.tanka_codigo) === codigo || norm(ref?.entrada_codigo) === codigo;
}
const removedIds = new Set(exclusivos.map((o) => o.id));
const saldos = new Map();
for (const t of transbordos) {
  if (removedIds.has(t.id)) continue;
  for (const d of t.destinos || []) {
    if (d.tipo_embalagem !== 'Tankagem') continue;
    const codigo = norm(d.tanka_codigo);
    if (!codigo) continue;
    saldos.set(codigo, (saldos.get(codigo) || 0) + Number(d.volume_total || d.volume || 0));
  }
  for (const o of t.origens || []) {
    if (o.tipo_origem !== 'tanka') continue;
    const codigo = norm(o.tanka_codigo || o.entrada_codigo);
    if (!codigo) continue;
    saldos.set(codigo, (saldos.get(codigo) || 0) - Number(o.volume_retirado || 0));
  }
}
const afetadas = new Set();
for (const o of exclusivos) {
  const row = transbordos.find((t) => t.id === o.id);
  for (const d of row?.destinos || []) {
    if (d.tipo_embalagem === 'Tankagem' && d.tanka_codigo) {
      afetadas.add(norm(d.tanka_codigo));
    }
  }
}
const negativos = [...afetadas].filter((codigo) => (saldos.get(codigo) || 0) < -0.001);
console.log('saldos apos exclusao', Object.fromEntries([...afetadas].map((c) => [c, saldos.get(c) || 0])));
if (negativos.length) {
  console.error('Saldo negativo nas tankas afetadas', negativos);
  process.exit(1);
}
const usadoComoOrigem = transbordos.filter(
  (t) =>
    !removedIds.has(t.id) &&
    (t.origens || []).some(
      (o) =>
        o.tipo_origem === 'tanka' &&
        (matchesTank(o, 'TANKA 07') || matchesTank(o, 'TANKA 05'))
    )
);
if (usadoComoOrigem.length) {
  console.error(
    'Tankas ja usadas como origem',
    usadoComoOrigem.map((t) => t.codigo_transbordo)
  );
  process.exit(1);
}

if (!apply) process.exit(0);

for (const o of exclusivos) {
  const vas = await sb.from('t_vasilhames').delete().eq('transbordo_id', o.id).select('id');
  if (vas.error) throw new Error(vas.error.message);
  const fil = await sb.from('t_filtracoes').delete().eq('transbordo_id', o.id).select('id');
  if (fil.error) throw new Error(fil.error.message);
  const est = await sb
    .from('t_estoque')
    .delete()
    .eq('grupo_entrada', `TB:${o.id}`)
    .select('id');
  if (est.error) throw new Error(est.error.message);
  const tr = await sb.from('t_transbordos').delete().eq('id', o.id).select('id');
  if (tr.error) throw new Error(tr.error.message);
  console.log('removido', o.codigo, {
    vasilhames: (vas.data || []).length,
    filtracoes: (fil.data || []).length,
    estoque: (est.data || []).length,
    transbordo: (tr.data || []).length,
  });
}
