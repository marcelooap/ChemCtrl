/**
 * Seed isotanques ChemFlow a partir da planilha (TANKA / ITKU / PRODUTO / CLIENTE).
 *
 * Uso:
 *   node scripts/seed-chemflow-isotanques.mjs
 *   node scripts/seed-chemflow-isotanques.mjs --replace
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

function normalizeCliente(nome) {
  if (!nome || nome === '-') return '';
  return String(nome)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/ENERGIIA/i, 'ENERGIA')
    .replace(/^VEOUA$/i, 'VEOLIA');
}

/** Normaliza nome de produto para matching flexível. */
function normProduto(nome) {
  return String(nome || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Aliases da planilha → nomes cadastrados (ou variantes aceitas).
 * Ordem: tentativa exata normalizada, depois aliases.
 */
const PRODUTO_ALIASES = {
  'PROSOLV EB 7157DW': ['PROSOLV EB7157', 'PROSOLV EB 7157', 'PROSOLV EB 7157DW'],
  'PROSOLV EB 7156': ['PROSOLV EB7156', 'PROSOLV EB 7156'],
  'PROSOLV HS 8785': ['PROSOLV HS 6765', 'PROSOLV HS 8785', 'PROSOLV HS6765'],
  'PROSOLV SI 9207': ['PROSOLV SI 9207', 'PROSOLV SI9207'],
  'PROSOLV WCI 8062': ['PROSOLV WEI 8062', 'PROSOLV WCI 8062', 'PROSOLV WEI8062'],
  'BACTIREP 50QT': ['BACTIREP 50 QT', 'BACTIREP 50QT'],
  'PROSOLV SI 9081': ['PROSOLV SI 9081', 'PROSOLV SI9081'],
  'PROSOLV SI 9039': ['PROSOLV SI 9039', 'PROSOLV SI9039'],
  'PROSOLV SI9214': ['PROSOLV SI9214 DW', 'PROSOLV SI 9214 DW', 'PROSOLV SI9214', 'PROSOLV SI 9702 DW'],
  'PROSOLV SI 9214': ['PROSOLV SI9214 DW', 'PROSOLV SI 9214 DW', 'PROSOLV SI9214'],
  'SCAVENREP O2BS': ['SCAVENREP CI285', 'SCAVENREP O2BS', 'SCAVENREP O2B5'],
  'SISBRAX SCAVE O-39': ['SISBRAX SCAVE CI-39', 'SISBRAX SCAVE O-39', 'SISBRAX SCAVE O 39'],
  'ALCOOL ANIDRO': ['ALCOOL ANIDRO'],
  METANOL: ['METANOL'],
  TRIETILENOGLICOL: ['TRIETILENOGLICOL'],
  REPCLEAN: ['REPCLEAN'],
  'SISBRAX ACE 75': ['SISBRAX ACE 75'],
  MONOETILENOGLICOL: ['MONOETILENOGLICOL'],
  ÁGUA: ['AGUA', 'ÁGUA'],
  AGUA: ['AGUA', 'ÁGUA'],
};

// tanka, itku, produto, cliente  (produto/cliente "-" = vazio)
const ROWS = [
  ['TANKA 01', 'ITKU 260049-7', 'PROSOLV EB 7157DW', 'VEOLIA'],
  ['TANKA 02', 'ITKU 260050-0', '-', '-'],
  ['TANKA 03', 'ITKU 260008-0', 'PROSOLV EB 7156', 'VEOLIA'],
  ['TANKA 04', 'ITKU 260064-5', '-', '-'],
  ['TANKA 05', 'ITKU 260027-0', 'PROSOLV HS 8785', 'VEOLIA'],
  ['TANKA 06', 'ITKU 260063-0', 'PROSOLV HS 8785', 'VEOLIA'],
  ['TANKA 07', 'ITKU 260022-3', 'PROSOLV HS 8785', 'VEOLIA'],
  ['TANKA 08', 'ITKU 260052-1', 'PROSOLV SI 9207', 'VEOLIA'],
  ['TANKA 09', 'ITKU 260036-6', 'PROSOLV HS 8785', 'VEOLIA'],
  ['TANKA 10', 'ITKU 260043-4', 'PROSOLV WCI 8062', 'VEOLIA'],
  ['TANKA 11', 'ITKU 260061-9', 'BACTIREP 50QT', 'REP BRASIL'],
  ['TANKA 12', 'ITKU 260054-2', 'BACTIREP 50QT', 'REP BRASIL'],
  ['TANKA 13', 'ITKU 260014-1', 'PROSOLV HS 8785', 'VEOLIA'],
  ['TANKA 14', 'ITKU 260017-8', 'ALCOOL ANIDRO', 'VIBRA ENERGIA'],
  ['TANKA 15', 'ITKU 260046-0', 'ALCOOL ANIDRO', 'VIBRA ENERGIA'],
  ['TANKA 16', 'ITKU 260038-9', 'ALCOOL ANIDRO', 'VIBRA ENERGIA'],
  ['TANKA 17', 'ITKU 260035-2', 'METANOL', 'VIBRA ENERGIA'],
  ['TANKA 18', 'ITKU 260018-3', 'METANOL', 'VIBRA ENERGIA'],
  ['TANKA 19', 'ITKU 260033-1', 'METANOL', 'VIBRA ENERGIA'],
  ['TANKA 20', 'ITKU 260045-5', 'METANOL', 'VIBRA ENERGIA'],
  ['TANKA 21', 'ITKU 260028-6', 'TRIETILENOGLICOL', 'VIBRA ENERGIA'],
  ['TANKA 22', 'ITKU 260051-6', 'PROSOLV HS 8785', 'VEOLIA'],
  ['TANKA 23', 'ITKU 260041-3', 'PROSOLV HS 8785', 'VEOLIA'],
  ['TANKA 24', 'ITKU 260024-4', 'PROSOLV HS 8785', 'VEOLIA'],
  ['TANKA 25', 'ITKU 260007-5', 'PROSOLV SI 9081', 'VEOLIA'],
  ['TANKA 26', 'ITKU 260020-2', 'PROSOLV SI 9039', 'VEOLIA'],
  ['TANKA 27', 'ITKU 260016-2', 'PROSOLV HS 8785', 'VEOLIA'],
  ['TANKA 28', 'ITKU 260039-4', 'PROSOLV SI9214', 'VEOLIA'],
  ['TANKA 29', 'ITKU 260032-6', 'PROSOLV HS 8785', 'VEOLIA'],
  ['TANKA 30', 'ITKU 260042-9', 'PROSOLV HS 8785', 'VEOLIA'],
  ['TANKA 31', 'ITKU 260012-0', 'REPCLEAN', 'REP BRASIL'],
  ['TANKA 32', 'ITKU 260048-1', 'REPCLEAN', 'REP BRASIL'],
  ['TANKA 33', 'ITKU 260053-7', 'SCAVENREP O2BS', 'REP BRASIL'],
  ['TANKA 34', 'ITKU 260058-4', 'REPCLEAN', 'REP BRASIL'],
  ['TANKA 35', 'ITKU 260057-9', 'SISBRAX ACE 75', 'VIBRA ENERGIA'],
  ['TANKA 36', 'ITKU 260062-4', 'SISBRAX ACE 75', 'VIBRA ENERGIA'],
  ['TANKA 37', 'ITKU 260005-4', 'ÁGUA', 'INTERTANK'],
  ['TANKA 38', 'ITKU 260059-0', 'SISBRAX ACE 75', 'VIBRA ENERGIA'],
  ['TANKA 39', 'ITKU 260013-6', 'SISBRAX ACE 75', 'VIBRA ENERGIA'],
  ['TANKA 40', 'ITKU 260047-6', 'SISBRAX ACE 75', 'VIBRA ENERGIA'],
  ['TANKA 41', 'ITKU 260011-5', 'SISBRAX ACE 75', 'VIBRA ENERGIA'],
  ['TANKA 42', 'ITKU 260006-0', 'SISBRAX ACE 75', 'VIBRA ENERGIA'],
  ['TANKA 43', 'ITKU 260021-8', 'TRIETILENOGLICOL', 'VIBRA ENERGIA'],
  ['TANKA 44', 'ITKU 260055-8', 'MONOETILENOGLICOL', 'VIBRA ENERGIA'],
  ['TANKA 45', 'ITKU 260015-7', 'MONOETILENOGLICOL', 'VIBRA ENERGIA'],
  ['TANKA 46', 'ITKU 260056-3', 'SISBRAX SCAVE O-39', 'VIBRA ENERGIA'],
  ['TANKA 47', 'ITKU 260029-1', 'SISBRAX SCAVE O-39', 'VIBRA ENERGIA'],
  ['TANKA 48', 'ITKU 260026-5', 'SISBRAX SCAVE O-39', 'VIBRA ENERGIA'],
  ['TANKA 49', 'ITKU 260010-0', 'TRIETILENOGLICOL', 'VIBRA ENERGIA'],
  ['TANKA 50', 'ITKU 260023-9', 'TRIETILENOGLICOL', 'VIBRA ENERGIA'],
  ['TANKA 51', 'ITKU 260019-9', 'TRIETILENOGLICOL', 'VIBRA ENERGIA'],
  ['TANKA 55', 'ITKU 260031-0', 'SISBRAX ACE 75', 'VIBRA ENERGIA'],
  ['TANKA 56', 'ITKU 260037-3', 'SISBRAX ACE 75', 'VIBRA ENERGIA'],
  ['TANKA 57', 'ITKU 260034-7', 'SISBRAX ACE 75', 'VIBRA ENERGIA'],
  ['TANKA 58', 'ITKU 260009-5', 'SISBRAX ACE 75', 'VIBRA ENERGIA'],
  ['TANKA 59', 'ITKU 260030-5', 'SISBRAX ACE 75', 'VIBRA ENERGIA'],
];

function findProduto(produtos, nomePlanilha, clienteNome) {
  if (!nomePlanilha || nomePlanilha === '-') return null;

  const candidates = PRODUTO_ALIASES[nomePlanilha] || [nomePlanilha];
  const norms = candidates.map(normProduto);

  // 1) match exato (normalizado) preferindo mesmo cliente
  const sameClient = [];
  const anyClient = [];
  for (const p of produtos) {
    const pn = normProduto(p.produto);
    if (!norms.includes(pn) && !norms.some((n) => pn === n || pn.startsWith(n) || n.startsWith(pn))) {
      // também tenta contains tokens principais
      continue;
    }
    if (clienteNome && normalizeCliente(p.cliente_nome).toUpperCase() === clienteNome.toUpperCase()) {
      sameClient.push(p);
    } else {
      anyClient.push(p);
    }
  }

  if (sameClient.length) return sameClient[0];
  if (anyClient.length) return anyClient[0];

  // 2) fuzzy: todos os tokens do alias presentes no nome do produto
  for (const alias of candidates) {
    const tokens = normProduto(alias).split(' ').filter((t) => t.length > 1);
    const fuzzySame = [];
    const fuzzyAny = [];
    for (const p of produtos) {
      const pn = normProduto(p.produto);
      if (!tokens.every((t) => pn.includes(t))) continue;
      if (clienteNome && normalizeCliente(p.cliente_nome).toUpperCase() === clienteNome.toUpperCase()) {
        fuzzySame.push(p);
      } else {
        fuzzyAny.push(p);
      }
    }
    if (fuzzySame.length) return fuzzySame[0];
    if (fuzzyAny.length) return fuzzyAny[0];
  }

  return null;
}

async function main() {
  const replace = process.argv.includes('--replace');
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

  console.log(`Modo: ${replace ? 'REPLACE' : 'INSERT'}`);
  console.log(`Linhas na planilha: ${ROWS.length}`);

  const { data: clientesExistentes, error: errC } = await supabase
    .from('clientes')
    .select('id, nome');
  if (errC) throw new Error(`Listar clientes: ${errC.message}`);

  const clienteByNome = new Map(
    (clientesExistentes || []).map((c) => [c.nome.trim().toUpperCase(), c])
  );

  const clientesNecessarios = [
    ...new Set(
      ROWS.map((r) => normalizeCliente(r[3])).filter(Boolean)
    ),
  ];

  for (const nome of clientesNecessarios) {
    if (clienteByNome.has(nome.toUpperCase())) continue;
    const { data, error } = await supabase
      .from('clientes')
      .insert({ nome })
      .select('id, nome')
      .single();
    if (error) throw new Error(`Criar cliente ${nome}: ${error.message}`);
    clienteByNome.set(nome.toUpperCase(), data);
    console.log(`Cliente criado: ${nome}`);
  }

  // Produto ÁGUA pode não existir — cria se necessário
  const { data: produtos, error: errP } = await supabase
    .from('produtos')
    .select('id, produto, codigo, cliente_id, cliente_nome');
  if (errP) throw new Error(`Listar produtos: ${errP.message}`);

  const agua = findProduto(produtos || [], 'ÁGUA', 'INTERTANK');
  if (!agua) {
    const intertank = clienteByNome.get('INTERTANK');
    const { data: novoAgua, error: errAgua } = await supabase
      .from('produtos')
      .insert({
        codigo: 'AGUA',
        produto: 'ÁGUA',
        cliente_id: intertank?.id || null,
        cliente_nome: 'INTERTANK',
        densidade: '1.0000',
        densidade_tabelada: true,
        filtrado: false,
        data_cadastro: new Date().toISOString().slice(0, 10),
      })
      .select('id, produto, codigo, cliente_id, cliente_nome')
      .single();
    if (errAgua) throw new Error(`Criar produto ÁGUA: ${errAgua.message}`);
    produtos.push(novoAgua);
    console.log('Produto criado: ÁGUA (INTERTANK)');
  }

  // PROSOLV SI 9207 pode não existir no cadastro de produtos
  if (!findProduto(produtos || [], 'PROSOLV SI 9207', 'VEOLIA')) {
    const veolia = clienteByNome.get('VEOLIA');
    const { data: novo, error } = await supabase
      .from('produtos')
      .insert({
        codigo: 'SI9207',
        produto: 'PROSOLV SI 9207',
        cliente_id: veolia?.id || null,
        cliente_nome: 'VEOLIA',
        densidade: '-',
        densidade_tabelada: false,
        filtrado: false,
        data_cadastro: new Date().toISOString().slice(0, 10),
      })
      .select('id, produto, codigo, cliente_id, cliente_nome')
      .single();
    if (error) throw new Error(`Criar PROSOLV SI 9207: ${error.message}`);
    produtos.push(novo);
    console.log('Produto criado: PROSOLV SI 9207 (VEOLIA)');
  }

  if (replace) {
    const { data: existentes, error: errList } = await supabase
      .from('isotanques')
      .select('id');
    if (errList) throw new Error(`Listar isotanques: ${errList.message}`);
    const ids = (existentes || []).map((x) => x.id);
    console.log(`Apagando ${ids.length} isotanques existentes...`);
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const { error } = await supabase.from('isotanques').delete().in('id', chunk);
      if (error) throw new Error(`Apagar isotanques: ${error.message}`);
    }
  }

  const unmatched = [];
  const payloads = [];

  for (const [tanka, itku, produtoRaw, clienteRaw] of ROWS) {
    const clienteNome = normalizeCliente(clienteRaw);
    const produtoNomePlanilha = !produtoRaw || produtoRaw === '-' ? '' : produtoRaw.trim();
    const produto = produtoNomePlanilha
      ? findProduto(produtos || [], produtoNomePlanilha, clienteNome)
      : null;

    if (produtoNomePlanilha && !produto) {
      unmatched.push(`${tanka}: ${produtoNomePlanilha} (${clienteNome})`);
    }

    const cliente =
      (clienteNome && clienteByNome.get(clienteNome.toUpperCase())) ||
      (produto?.cliente_id
        ? { id: produto.cliente_id, nome: produto.cliente_nome }
        : null);

    payloads.push({
      codigo_itku: itku.trim(),
      tanka: tanka.trim(),
      produto_id: produto?.id || null,
      produto_nome: produto?.produto || produtoNomePlanilha || null,
      cliente_id: cliente?.id || null,
      cliente_nome: cliente?.nome || clienteNome || null,
      capacidade: null,
      inicio_locacao: null,
    });
  }

  let toInsert = payloads;
  if (!replace) {
    const { data: existentes, error } = await supabase
      .from('isotanques')
      .select('id, codigo_itku');
    if (error) throw new Error(`Listar isotanques: ${error.message}`);
    const keys = new Set((existentes || []).map((x) => x.codigo_itku.trim().toUpperCase()));
    toInsert = payloads.filter((p) => !keys.has(p.codigo_itku.trim().toUpperCase()));
    console.log(`Já existiam (pulados): ${payloads.length - toInsert.length}`);
  }

  console.log(`Inserindo: ${toInsert.length}`);

  const created = [];
  for (let i = 0; i < toInsert.length; i += 50) {
    const chunk = toInsert.slice(i, i + 50);
    const { data, error } = await supabase
      .from('isotanques')
      .insert(chunk)
      .select('id, codigo_itku, tanka, produto_nome, cliente_nome');
    if (error) throw new Error(`Inserir isotanques (lote ${i / 50 + 1}): ${error.message}`);
    created.push(...(data || []));
  }

  console.log(`\nOK — ${created.length} isotanques cadastrados.`);
  console.log('Amostra:');
  for (const it of created.slice(0, 5)) {
    console.log(
      `  - ${it.tanka} | ${it.codigo_itku} | ${it.produto_nome || '-'} | ${it.cliente_nome || '-'}`
    );
  }
  if (created.length > 5) console.log(`  ... e mais ${created.length - 5}`);

  const vazios = created.filter((x) => !x.produto_nome).length;
  console.log(`Sem produto/cliente: ${vazios}`);

  if (unmatched.length) {
    console.log('\nAVISO — produtos da planilha sem match no cadastro (gravados só com nome):');
    for (const u of unmatched) console.log(`  - ${u}`);
  }
}

main().catch((err) => {
  console.error('\nFalha no seed:', err.message || err);
  process.exit(1);
});
