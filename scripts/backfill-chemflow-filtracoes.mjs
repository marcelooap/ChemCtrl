/**
 * Backfill: cria registros em `filtracoes` a partir dos vasilhames
 * de produtos marcados como filtrados (ou filtro por nome).
 *
 * Por padrão processa PROSOLV HS 8785.
 *
 * Uso:
 *   node scripts/backfill-chemflow-filtracoes.mjs
 *   node scripts/backfill-chemflow-filtracoes.mjs --all-filtrados
 *   node scripts/backfill-chemflow-filtracoes.mjs --dry-run
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

function buildFiltracaoFromVasilhame(vasilhame) {
  return {
    vasilhame_id: vasilhame.id,
    transbordo_id: vasilhame.transbordo_id || null,
    codigo: vasilhame.codigo || '',
    placa: vasilhame.placa || '',
    barril: vasilhame.barril || '',
    produto_id: vasilhame.produto_id || null,
    produto_codigo: vasilhame.produto_codigo || '',
    produto_nome: vasilhame.produto_nome || '',
    cliente_id: vasilhame.cliente_id || null,
    cliente_nome: vasilhame.cliente_nome || '',
    lote: vasilhame.lote || '',
    composicao: vasilhame.composicao || [],
    volume: vasilhame.volume || 0,
    sae: null,
    particulas_6: null,
    particulas_14: null,
    particulas_21: null,
    particulas_38: null,
    particulas_70: null,
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const allFiltrados = process.argv.includes('--all-filtrados');
  const targetNome = 'PROSOLV HS 8785';
  const targetNorm = normProduto(targetNome);

  const root = resolve(process.cwd());
  const env = {
    ...loadEnv(resolve(root, '.env')),
    ...loadEnv(resolve(root, '.env.local')),
    ...process.env,
  };

  const url = normalizeSupabaseUrl(env.VITE_CHEMFLOW_SUPABASE_URL || '');
  const key = (env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) {
    console.error(
      'Configure VITE_CHEMFLOW_SUPABASE_URL e VITE_CHEMFLOW_SUPABASE_ANON_KEY no .env'
    );
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const { data: produtos, error: errP } = await supabase
    .from('produtos')
    .select('id, produto, codigo, filtrado');
  if (errP) throw new Error(`Listar produtos: ${errP.message}`);

  let produtoIds;
  if (allFiltrados) {
    produtoIds = new Set(
      (produtos || []).filter((p) => p.filtrado).map((p) => p.id)
    );
    console.log(`Produtos filtrados: ${produtoIds.size}`);
  } else {
    const produto = (produtos || []).find(
      (p) => normProduto(p.produto) === targetNorm
    );
    if (!produto) {
      throw new Error(`Produto "${targetNome}" não encontrado no cadastro.`);
    }
    if (!produto.filtrado) {
      console.warn(
        `Atenção: "${produto.produto}" não está marcado como filtrado — backfill mesmo assim.`
      );
    }
    produtoIds = new Set([produto.id]);
    console.log(
      `Produto: ${produto.produto} (${produto.id}) | filtrado=${!!produto.filtrado}`
    );
  }

  const { data: vasilhames, error: errV } = await supabase
    .from('vasilhames')
    .select('*')
    .order('created_at', { ascending: false });
  if (errV) throw new Error(`Listar vasilhames: ${errV.message}`);

  const candidates = (vasilhames || []).filter((v) => {
    // Filtração: somente tipo Vasilhame (não Tankagem / IBC / etc.)
    if ((v.tipo || '') !== 'Vasilhame') return false;
    if (v.produto_id && produtoIds.has(v.produto_id)) return true;
    if (!allFiltrados && normProduto(v.produto_nome) === targetNorm) return true;
    return false;
  });

  console.log(`Vasilhames candidatos: ${candidates.length}`);

  const { data: existentes, error: errF } = await supabase
    .from('filtracoes')
    .select('id, vasilhame_id');
  if (errF) throw new Error(`Listar filtracoes: ${errF.message}`);

  const already = new Set(
    (existentes || []).map((f) => f.vasilhame_id).filter(Boolean)
  );
  const toInsert = candidates.filter((v) => !already.has(v.id));

  console.log(`Já em filtração: ${candidates.length - toInsert.length}`);
  console.log(`A inserir: ${toInsert.length}${dryRun ? ' (dry-run)' : ''}`);

  if (toInsert.length === 0) {
    console.log('Nada a fazer.');
    return;
  }

  for (const v of toInsert.slice(0, 20)) {
    console.log(
      `  → ${v.codigo || '-'} | ${v.placa || '-'} | ${v.barril || '—'} | ${v.produto_nome || '-'} | ${v.volume ?? 0} L`
    );
  }
  if (toInsert.length > 20) {
    console.log(`  ... e mais ${toInsert.length - 20}`);
  }

  if (dryRun) return;

  const payload = toInsert.map(buildFiltracaoFromVasilhame);
  const chunkSize = 100;
  let inserted = 0;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { data, error } = await supabase.from('filtracoes').insert(chunk).select('id');
    if (error) throw new Error(`Inserir filtracoes: ${error.message}`);
    inserted += (data || []).length;
  }

  console.log(`Inseridos: ${inserted}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
