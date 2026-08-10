/**
 * Renomeia operadores nos transbordos (e responsável em vasilhames) já salvos.
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

/** Nomes antigos → novos (ordem: mais longos primeiro para replace em string). */
const RENAME = [
  ['Francisco Mariano', 'Mariano'],
  ['Adriano Queiroz', 'Adriano Q.'],
  ['Leonardo Souza', 'Leonardo S.'],
  ['Rafael Novais', 'Rafael N.'],
  ['Wandre Costa', 'Wandre C.'],
  ['Ezequiel', 'Ezequiel F.'],
];

const MAP = Object.fromEntries(RENAME);

function renameOperador(nome) {
  const n = String(nome || '').trim();
  if (!n) return n;
  if (MAP[n]) return MAP[n];
  // Já abreviado ou variante
  if (n === 'Ezequiel F.') return n;
  return n;
}

function renameOperadores(list) {
  if (!Array.isArray(list)) return { changed: false, next: list };
  const next = list.map(renameOperador);
  const changed = next.some((v, i) => v !== list[i]);
  return { changed, next };
}

function renameResponsavel(text) {
  if (!text || typeof text !== 'string') return { changed: false, next: text };
  let next = text;
  for (const [from, to] of RENAME) {
    if (from === 'Ezequiel') {
      // Evita "Ezequiel F." → "Ezequiel F. F."
      next = next.replace(/\bEzequiel\b(?!\s*F\.)/g, to);
    } else {
      next = next.split(from).join(to);
    }
  }
  return { changed: next !== text, next };
}

async function main() {
  const { data: transbordos, error: tErr } = await supabase
    .from('t_transbordos')
    .select('id, codigo_transbordo, operadores');
  if (tErr) throw new Error(`t_transbordos: ${tErr.message}`);

  let tUpdated = 0;
  for (const row of transbordos || []) {
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

  const { data: vasilhames, error: vErr } = await supabase
    .from('t_vasilhames')
    .select('id, codigo, placa, responsavel');
  if (vErr) throw new Error(`t_vasilhames: ${vErr.message}`);

  let vUpdated = 0;
  for (const row of vasilhames || []) {
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

  console.log(`\nTransbordos atualizados: ${tUpdated}/${(transbordos || []).length}`);
  console.log(`Vasilhames (responsável) atualizados: ${vUpdated}/${(vasilhames || []).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
