/**
 * Corrige entrada_codigo em origens de transbordo desalinhado do índice E00N real.
 * Ex.: T003 gravado como "E005" mas o estoque de origem pertence à E004.
 *
 * Uso:
 *   node scripts/fix-chemflow-entrada-codigo-origens.mjs
 *   node scripts/fix-chemflow-entrada-codigo-origens.mjs --dry-run
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');

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

function createdTs(row) {
  return new Date(row?.created_at || row?.created_date || 0).getTime();
}

function buildEntradaCodigoById(entradasList = []) {
  const map = {};
  [...entradasList]
    .sort((a, b) => createdTs(a) - createdTs(b))
    .forEach((e, i) => {
      if (e?.id) map[e.id] = `E${String(i + 1).padStart(3, '0')}`;
    });
  return map;
}

function extractPrefix(codigo) {
  const m = String(codigo || '')
    .trim()
    .toUpperCase()
    .match(/^(E\d{3})\b/);
  return m ? m[1] : '';
}

function replacePrefix(codigo, newPrefix) {
  const raw = String(codigo || '');
  if (!raw) return `${newPrefix}`;
  if (/^E\d{3}\b/i.test(raw)) {
    return raw.replace(/^E\d{3}/i, newPrefix);
  }
  return `${newPrefix} - ${raw}`;
}

const env = {
  ...loadEnv(resolve(process.cwd(), '.env')),
  ...loadEnv(resolve(process.cwd(), '.env.local')),
};
const url = (
  env.VITE_CHEMFLOW_SUPABASE_URL ||
  env.VITE_SUPABASE_URL ||
  'https://cpzibnwytukcgxeamfhp.supabase.co'
)
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '');
const key =
  env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!key) {
  console.error('Credenciais Supabase não encontradas no .env');
  process.exit(1);
}

const sb = createClient(url, key);

const [{ data: entradas, error: eErr }, { data: estoque, error: sErr }, { data: tbs, error: tErr }] =
  await Promise.all([
    sb.from('entradas').select('id,produto_nome,lote,created_at').order('created_at'),
    sb.from('estoque').select('id,entrada_id,produto_nome,lote,grupo_entrada'),
    sb.from('transbordos').select('id,codigo_transbordo,origens'),
  ]);

if (eErr || sErr || tErr) {
  console.error(eErr || sErr || tErr);
  process.exit(1);
}

const codigoByEntrada = buildEntradaCodigoById(entradas || []);
const estoqueById = new Map((estoque || []).map((e) => [e.id, e]));

let fixed = 0;
for (const t of tbs || []) {
  const origens = parseArr(t.origens);
  let changed = false;
  const nextOrigens = origens.map((o) => {
    if (!o?.entrada_id || (o.tipo_origem && o.tipo_origem !== 'entrada' && o.tipo_origem !== 'embalado')) {
      return o;
    }
    const row = estoqueById.get(o.entrada_id);
    const parentEntradaId = row?.entrada_id || null;
    // Também aceita origem apontando direto para entrada.id
    const entradaId = parentEntradaId || (codigoByEntrada[o.entrada_id] ? o.entrada_id : null);
    if (!entradaId || !codigoByEntrada[entradaId]) return o;

    const expected = codigoByEntrada[entradaId];
    const current = extractPrefix(o.entrada_codigo);
    if (current === expected) return o;

    changed = true;
    console.log(
      `${t.codigo_transbordo}: origem "${o.entrada_codigo}" → prefixo ${expected} (entrada ${entradaId})`
    );
    return {
      ...o,
      entrada_codigo: replacePrefix(o.entrada_codigo, expected),
    };
  });

  if (!changed) continue;
  fixed += 1;
  if (DRY_RUN) continue;

  const { error } = await sb
    .from('transbordos')
    .update({ origens: nextOrigens })
    .eq('id', t.id);
  if (error) {
    console.error(`Falha ao atualizar ${t.codigo_transbordo}:`, error.message);
    process.exit(1);
  }
}

console.log(
  DRY_RUN
    ? `[dry-run] ${fixed} transbordo(s) precisariam de correção`
    : `Corrigidos ${fixed} transbordo(s)`
);
