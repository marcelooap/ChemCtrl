/**
 * Atualiza isotanques ChemFlow:
 * - PROSOLV HS 6765 → PROSOLV HS 8785 (produto_id + produto_nome + cliente)
 * - capacidade = 26000 L em todos
 * - inicio_locacao = 2026-07-01 em todos
 *
 * Uso: node scripts/update-chemflow-isotanques-prosolv-capacidade.mjs
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

function normalizeSupabaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
}

function normProduto(nome) {
  return String(nome || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const root = resolve(process.cwd());
  const env = {
    ...loadEnv(resolve(root, '.env')),
    ...loadEnv(resolve(root, '.env.local')),
    ...process.env,
  };

  const url = normalizeSupabaseUrl(env.VITE_CHEMFLOW_SUPABASE_URL || '');
  const key = (env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) {
    console.error('Configure VITE_CHEMFLOW_SUPABASE_URL e VITE_CHEMFLOW_SUPABASE_ANON_KEY no .env');
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const { data: produtos, error: errP } = await supabase
    .from('produtos')
    .select('id, produto, cliente_id, cliente_nome');
  if (errP) throw new Error(`Listar produtos: ${errP.message}`);

  const targetNome = 'PROSOLV HS 8785';
  const targetNorm = normProduto(targetNome);
  const produto8785 = (produtos || []).find((p) => normProduto(p.produto) === targetNorm);
  if (!produto8785) {
    throw new Error(`Produto "${targetNome}" não encontrado no cadastro.`);
  }

  console.log(`Produto destino: ${produto8785.produto} (${produto8785.id})`);
  console.log(`Cliente: ${produto8785.cliente_nome || '-'}`);

  const { data: isotanques, error: errI } = await supabase
    .from('isotanques')
    .select('id, tanka, codigo_itku, produto_id, produto_nome, capacidade, inicio_locacao');
  if (errI) throw new Error(`Listar isotanques: ${errI.message}`);

  const all = isotanques || [];
  const oldNorms = new Set(['PROSOLV HS 6765', 'PROSOLV HS6765'].map(normProduto));
  const toSwap = all.filter((it) => oldNorms.has(normProduto(it.produto_nome)));

  console.log(`Isotanques totais: ${all.length}`);
  console.log(`Com PROSOLV HS 6765: ${toSwap.length}`);

  let swapped = 0;
  for (const it of toSwap) {
    const { error } = await supabase
      .from('isotanques')
      .update({
        produto_id: produto8785.id,
        produto_nome: produto8785.produto,
        cliente_id: produto8785.cliente_id || null,
        cliente_nome: produto8785.cliente_nome || null,
      })
      .eq('id', it.id);
    if (error) throw new Error(`Atualizar produto ${it.tanka}: ${error.message}`);
    swapped += 1;
    console.log(`  produto: ${it.tanka || '-'} | ${it.codigo_itku} → ${produto8785.produto}`);
  }

  const ids = all.map((x) => x.id);
  let capacityUpdated = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { data, error } = await supabase
      .from('isotanques')
      .update({
        capacidade: 26000,
        inicio_locacao: '2026-07-01',
      })
      .in('id', chunk)
      .select('id');
    if (error) throw new Error(`Atualizar capacidade/data (lote): ${error.message}`);
    capacityUpdated += (data || []).length;
  }

  console.log(`\nOK — produto atualizado em ${swapped} tanka(s).`);
  console.log(`OK — capacidade 26000 L + início 01/07/2026 em ${capacityUpdated} tanka(s).`);
}

main().catch((err) => {
  console.error('\nFalha:', err.message || err);
  process.exit(1);
});
