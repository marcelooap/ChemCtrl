/**
 * Alinha nomes abreviados do histórico ao cadastro atual (t_operadores).
 * Corrige duplicatas no dashboard (ex.: "Joelson A." + "Joelson Alves").
 *
 * Uso: node src/modules/transbordo/sql/update_operadores_nomes.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../../..');

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

const env = loadEnv(resolve(root, '.env'));
const url = (env.VITE_CHEMFLOW_SUPABASE_URL || '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '');
const key = (env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || '').trim();

if (!url || !key) {
  console.error('Credenciais VITE_CHEMFLOW_SUPABASE_* ausentes no .env');
  process.exit(1);
}

const supabase = createClient(url, key);

/**
 * Nomes antigos (histórico) → nomes atuais do cadastro.
 * Mais específicos primeiro quando houver risco de overlap.
 */
const RENAME = [
  ['Adriano Q.', 'Adriano Queiroz'],
  ['Joelson A.', 'Joelson Alves'],
  ['Everton N.', 'Everton Nascimento'],
  ['Ezequiel F.', 'Ezekiel da Silva'],
  ['Leonardo S.', 'Leonardo Sousa'],
  ['Rafael N.', 'Rafael Novais'],
  ['Rafael S.', 'Rafael Santos'],
  ['F. Mariano', 'Francisco Mariano'],
  ['Wandre C.', 'Wandre Costa'],
  ['Mariano', 'Francisco Mariano'],
];

const MAP = Object.fromEntries(
  RENAME.map(([from, to]) => [from.toLowerCase(), to])
);

function renameOperador(nome) {
  const n = String(nome || '').trim();
  if (!n) return n;
  return MAP[n.toLowerCase()] || n;
}

function renameOperadores(list) {
  if (!Array.isArray(list)) return { changed: false, next: list };
  const next = list.map(renameOperador);
  const changed = next.some((v, i) => v !== list[i]);
  return { changed, next };
}

function renameResponsavel(text) {
  if (!text || typeof text !== 'string') return { changed: false, next: text };
  const parts = text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return { changed: false, next: text };
  const nextParts = parts.map(renameOperador);
  const changed = nextParts.some((v, i) => v !== parts[i]);
  return { changed, next: nextParts.join(', ') };
}

async function fetchAll(table, columns) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function main() {
  const transbordos = await fetchAll('t_transbordos', 'id, codigo_transbordo, operadores');
  let tUpdated = 0;
  for (const row of transbordos) {
    const { changed, next } = renameOperadores(row.operadores);
    if (!changed) continue;
    const { error } = await supabase
      .from('t_transbordos')
      .update({ operadores: next })
      .eq('id', row.id);
    if (error) {
      throw new Error(
        `update transbordo ${row.codigo_transbordo || row.id}: ${error.message}`
      );
    }
    tUpdated += 1;
    console.log(
      `  OP ${row.codigo_transbordo || row.id}: ${(row.operadores || []).join(', ')} → ${next.join(', ')}`
    );
  }

  const vasilhames = await fetchAll('t_vasilhames', 'id, codigo, placa, responsavel');
  let vUpdated = 0;
  for (const row of vasilhames) {
    const { changed, next } = renameResponsavel(row.responsavel);
    if (!changed) continue;
    const { error } = await supabase
      .from('t_vasilhames')
      .update({ responsavel: next })
      .eq('id', row.id);
    if (error) {
      throw new Error(
        `update vasilhame ${row.codigo || row.placa || row.id}: ${error.message}`
      );
    }
    vUpdated += 1;
    console.log(
      `  Vasilhame ${row.placa || row.codigo || row.id}: "${row.responsavel}" → "${next}"`
    );
  }

  console.log(`\nTransbordos atualizados: ${tUpdated}/${transbordos.length}`);
  console.log(`Vasilhames (responsável) atualizados: ${vUpdated}/${vasilhames.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
