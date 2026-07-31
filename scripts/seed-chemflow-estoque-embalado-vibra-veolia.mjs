/**
 * Inventário embalado — VIBRA ENERGIA + VEOLIA
 * (planilhas de saldo controle → entradas + estoque embalado)
 *
 * Volumes/massas: notação pt-BR (1.500 = 1500).
 * Tudo cadastrado como embalado.
 *
 * Uso:
 *   node scripts/seed-chemflow-estoque-embalado-vibra-veolia.mjs
 *   node scripts/seed-chemflow-estoque-embalado-vibra-veolia.mjs --dry-run
 *   node scripts/seed-chemflow-estoque-embalado-vibra-veolia.mjs --only=VIBRA
 *   node scripts/seed-chemflow-estoque-embalado-vibra-veolia.mjs --only=VEOLIA
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_ARG = process.argv.find((a) => a.startsWith('--only='));
const ONLY = ONLY_ARG ? ONLY_ARG.slice('--only='.length).trim().toUpperCase() : '';
const TODAY = new Date().toISOString().slice(0, 10);

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

function norm(v) {
  return String(v || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function cleanCodigo(raw) {
  return String(raw || '')
    .trim()
    .replace(/\.+$/, '');
}

/** Unidade ChemFlow (LoteBlock: kg | L | lb | gal | unid.) */
function normalizeUnidade(raw) {
  const u = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  if (u === 'kg' || u === 'kgs') return 'kg';
  if (u === 'l' || u === 'lt' || u === 'litro' || u === 'litros') return 'L';
  if (u === 'unid' || u === 'un' || u === 'und' || u === 'unidade' || u === 'unidades') {
    return 'unid.';
  }
  return String(raw || 'kg').trim();
}

/**
 * Planilha VIBRA ENERGIA (saldo pt-BR).
 * [codigo, produto, saldo, unidade]
 */
const VIBRA_ROWS = [
  ['1024875', 'CHLORIDE HP TEST KIT', 2, 'Unid'],
  ['1003538', 'BIFLUORETO DE AMONIO - KG', 4000, 'kg'],
  ['1025615', 'STD COND SOLUTION 1,413 US', 3, 'Unid'],
  ['1025623', 'STD COND SOLUTION 84US', 3, 'Unid'],
  ['1025672', 'AMERSITE CHZ B ACTIVATOR SOLN', 3, 'Unid'],
  ['1015981', 'GAMAZYME 700 FN - BALDE 12 KG', 288, 'KG'],
  ['IBC VIBRA', 'IBC', 16, 'Unid'],
  ['1011892', 'GC - BB 25 L', 275, 'L'],
  ['1023145', 'DESCALEX - BB 25KG', 625, 'KG'],
  ['1026973', 'OCEANIC SST 5007', 9, 'Unid'],
  ['6000122', 'BOMBONA PLAST 20L', 156, 'Unid'],
  ['10254461', 'BOMBONA PLAST 200L', 119, 'Unid'],
  ['1003321', 'ACIDO CITRICO - KG', 100, 'KG'],
  ['1011262', 'HIPOCLORITO DE CALCIO BD 45 KG', 1980, 'KG'],
  ['1028244', 'SISBRAX CORR 5206', 2730, 'KG'],
  ['1024421', 'VERSOL PLUS ECO - BB 200 L', 3200, 'L'],
  ['1024670', 'Hidróxido de Sódio 50% - TB 200L', 250, 'KG'],
  ['1025425', 'ÁCIDO CLORIDRICO 32%', 374, 'KG'],
  ['1023966', 'METILDIETANOLAMINA', 15999, 'KG'],
  ['1024332', 'ÁGUA DEIONIZADA BB 20 L', 2040, 'L'],
  ['1028104', 'DICLOROISOCIANURATO DE SODIO 60 %', 84, 'KG'],
  ['1024362', 'ÁGUA DESTILADA BB 20L', 2060, 'L'],
  ['1021671', 'SODA CAUSTICA ESCAMAS - SC 25KG', 275, 'KG'],
  ['1022451', 'ROCOR NB LIQUID BB 25 L', 375, 'L'],
  ['1023975', 'HIPOCLORITO DE SÓDIO - BB 20 L', 2820, 'L'],
  ['1015971', 'GAMAZYME BTC-CX 12L', 852, 'L'],
  ['1017963', 'AMEROYAL BB 25 L', 650, 'L'],
  ['1011262', 'GR CLEAN 65 GRANULADO', 448, 'KG'],
  ['1023974', 'HIPOCLORITO DE SÓDIO BB 50 L', 8000, 'L'],
  ['5000133', 'TAMBOR', 62, 'Unid'],
  ['1028926', 'ENERC ACD CL-IN', 1150, 'KG'],
  ['1023969', 'TRIETILENOGLICOL - TB 208 L', 200, 'L'],
  ['1016291', 'ÁGUA DESMINERALIZADA BB 20 L', 5000, 'L'],
];

/**
 * Planilha VEOLIA (saldo pt-BR).
 * [codigo, produto, saldo, unidade]
 */
const VEOLIA_ROWS = [
  ['6009403', 'PROSOLV RB8474', 6115, 'KG'],
  ['6011804', 'SCALETROL PDC 9456L', 9585, 'KG'],
  ['26353', 'TAMBOR - VEOLIA', 211, 'unid'],
  ['22313', 'BOMBONA PLAST BB 20l', 74, 'unid'],
  ['5032241', 'PROSOLV EXP 4106', 0, 'KG'],
  ['6005328', 'KLEEN MCT194 BB 20L', 498, 'KG'],
  ['6113042', 'HYPERSPERSE MDC776 BB 200L', 80, 'KG'],
  ['22315', 'BOMBONA PLAST AZUL Z67 e Z66', 299, 'unid'],
  ['6116614', 'MEMCHEM DCL40BR BB 20L', 16032, 'KG'],
  ['6108233', 'KLEEN MCT882', 600, 'KG'],
  ['6115529', 'CUSTON CLEAN CC31', 760, 'KG'],
  ['6004980', 'MEMCHEM MCT109 BB 20L', 445, 'KG'],
  ['997260', 'Container plastico 1000L', 195, 'Unid'],
  ['6013630', 'HYPERSPERSE MDC776 IBC', 18560, 'KG'],
  ['6012946', 'EXP4139', 4868, 'KG'],
  ['5032358', 'EXP 4143', 498, 'KG'],
  ['20717', 'THPS 75 IBC 1400KG', 48580, 'KG'],
  ['6115558', 'BETZDEARBORN R227BR', 304, 'KG'],
  ['6010352', 'EXP4097 - RETO', 1241, 'KG'],
  ['6000242', 'MEMCHEM MCT109 BB 200L', 18060, 'KG'],
  ['6013772', 'FOAMTROL AF2050', 3120, 'KG'],
  ['6012972', 'EXP4138', 1500, 'KG'],
  ['6012981', 'EXP 4138 CT 1500L', 1355, 'KG'],
  ['6010724', 'PROSOLV HS 8785', 23000, 'KG'],
  ['6113226', 'HYPERSPERSE MDC776', 10764, 'KG'],
  ['6008482', 'MEMCHEM DCL40BR IBC', 14300, 'KG'],
  ['6116610', 'KLEEN MCT 503 - BB 20L', 15015, 'KG'],
  ['6118252', 'SODIUM HYPOCHLORITE CMD', 30000, 'KG'],
  ['6118080', 'ACIDO SULFURICO 98%', 1799, 'KG'],
  ['6116922', 'BIOMATE MBC2881B', 244, 'KG'],
  ['6109597', 'OPTISPERSE ADJ5050', 12850, 'KG'],
  ['6005326', 'KLEEN MCT194 IBC', 550, 'KG'],
  ['32047', 'POLIOL POLIMERIZADO', 4988, 'KG'],
  ['31354', 'RESINA FENOLICA OXIALQUILADA', 4990, 'KG'],
  ['6115333', 'BIOMATE MBC2881B - BB 20L', 46, 'KG'],
  ['6108219', 'CORTROL IS 3020', 11000, 'KG'],
  ['6002674', 'KLEEN MCT194 BB 200L', 5150, 'KG'],
  ['6118802', 'HYPERSPERSE MDC 150 BR', 7530, 'KG'],
  ['6117643', 'KLEEN MCT 515', 2500, 'KG'],
  ['6011961', 'PROSOLV RB 8474 BB 200L', 1632, 'KG'],
  ['6008194', 'HYPERSPERSE MDC 150 BR - IBC', 5750, 'KG'],
];

const INVENTARIOS = [
  {
    cliente: 'VIBRA ENERGIA',
    grupo: 'E-INV-EMB-VIBRA',
    notaFiscal: 'INV-EMB-VIBRA',
    lote: 'INVENTARIO',
    rows: VIBRA_ROWS,
  },
  {
    cliente: 'VEOLIA',
    grupo: 'E-INV-EMB-VEOLIA',
    notaFiscal: 'INV-EMB-VEOLIA',
    lote: 'INVENTARIO',
    rows: VEOLIA_ROWS,
  },
];

function findProduto(produtos, codigo, nome, clienteNome) {
  const c = cleanCodigo(codigo);
  const n = norm(nome);
  const cli = norm(clienteNome);
  const sameCli = (produtos || []).filter(
    (p) =>
      cleanCodigo(p.codigo) === c &&
      norm(p.cliente_nome) === cli
  );

  const exact = sameCli.find((p) => norm(p.produto) === n);
  if (exact) return exact;

  const loose = sameCli.find((p) => {
    const pn = norm(p.produto);
    return pn.includes(n) || n.includes(pn);
  });
  if (loose) return loose;

  // Preferência por nome mais próximo (sem espaços em códigos de embalagem)
  const compact = (s) => norm(s).replace(/\s+/g, '');
  const byCompact = sameCli.find((p) => compact(p.produto) === compact(nome));
  if (byCompact) return byCompact;

  if (sameCli.length === 1) return sameCli[0];
  return null;
}

async function ensureCliente(sb, nome) {
  const { data: existentes, error } = await sb.from('clientes').select('*');
  if (error) throw new Error(`Listar clientes: ${error.message}`);
  const found = (existentes || []).find((c) => norm(c.nome) === norm(nome));
  if (found) return found;
  if (DRY_RUN) {
    console.log(`  [dry-run] criaria cliente ${nome}`);
    return { id: null, nome };
  }
  const { data, error: errIns } = await sb
    .from('clientes')
    .insert({ nome })
    .select()
    .single();
  if (errIns) throw new Error(`Criar cliente ${nome}: ${errIns.message}`);
  return data;
}

async function ensureProduto(sb, cliente, codigo, nome, produtosCache) {
  const existing = findProduto(produtosCache, codigo, nome, cliente.nome);
  if (existing) return existing;

  if (DRY_RUN) {
    console.log(`  [dry-run] criaria produto [${codigo}] ${nome}`);
    const stub = {
      id: null,
      codigo: cleanCodigo(codigo),
      produto: nome,
      cliente_id: cliente.id,
      cliente_nome: cliente.nome,
      densidade: '-',
      densidade_tabelada: false,
      filtrado: false,
    };
    produtosCache.push(stub);
    return stub;
  }

  const payload = {
    codigo: cleanCodigo(codigo),
    produto: nome.trim(),
    cliente_id: cliente.id,
    cliente_nome: cliente.nome,
    densidade: '-',
    densidade_tabelada: false,
    filtrado: false,
    data_cadastro: TODAY,
  };
  const { data, error } = await sb
    .from('produtos')
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(`Criar produto ${codigo}: ${error.message}`);
  produtosCache.push(data);
  console.log(`  + produto criado: [${data.codigo}] ${data.produto}`);
  return data;
}

function buildLote(produto, notaFiscal, lote, quantidade, unidade) {
  const qtd = Math.round(Number(quantidade) || 0);
  return {
    produto_id: produto.id,
    produto_nome: produto.produto || produto.nome,
    produto_codigo: produto.codigo,
    nota_fiscal: notaFiscal,
    lote,
    densidade: null,
    quantidade: qtd,
    unidade_medida: unidade,
    data_fabricacao: null,
    data_validade: null,
    preco_unitario: 0,
    embalado: true,
    // Inventário: 1 “embalagem lógica” com o saldo total
    peso_liquido: qtd,
    quantidade_embalagens: 1,
  };
}

async function clearGrupo(sb, grupo) {
  const { data: estoques } = await sb
    .from('estoque')
    .select('id,entrada_id')
    .eq('grupo_entrada', grupo);

  const entradaIds = [
    ...new Set((estoques || []).map((e) => e.entrada_id).filter(Boolean)),
  ];

  const { data: entradasByNf } = await sb
    .from('entradas')
    .select('id')
    .eq('grupo_entrada', grupo);
  for (const e of entradasByNf || []) {
    if (!entradaIds.includes(e.id)) entradaIds.push(e.id);
  }

  if (DRY_RUN) {
    console.log(
      `  [dry-run] removeria ${estoques?.length || 0} estoque(s) e ${entradaIds.length} entrada(s) do grupo ${grupo}`
    );
    return;
  }

  if ((estoques || []).length > 0) {
    for (let i = 0; i < estoques.length; i += 50) {
      const chunk = estoques.slice(i, i + 50).map((e) => e.id);
      const { error } = await sb.from('estoque').delete().in('id', chunk);
      if (error) throw new Error(`Delete estoque: ${error.message}`);
    }
  }

  if (entradaIds.length > 0) {
    for (let i = 0; i < entradaIds.length; i += 50) {
      const chunk = entradaIds.slice(i, i + 50);
      const { error } = await sb.from('entradas').delete().in('id', chunk);
      if (error) throw new Error(`Delete entradas: ${error.message}`);
    }
  }
}

async function seedInventario(sb, inv, cliente, produtosCache) {
  console.log(`\n── ${inv.cliente} (${inv.grupo}) ──`);

  const items = [];
  const skipped = [];

  for (const [codigo, nome, saldo, unidRaw] of inv.rows) {
    const qtd = Math.round(Number(saldo) || 0);
    if (qtd <= 0) {
      skipped.push(`${codigo} ${nome} (saldo ${saldo})`);
      continue;
    }
    const produto = await ensureProduto(sb, cliente, codigo, nome, produtosCache);
    const unidade = normalizeUnidade(unidRaw);
    items.push({ produto, quantidade: qtd, unidade });
  }

  if (skipped.length) {
    console.log('  Pulados (saldo ≤ 0):');
    skipped.forEach((s) => console.log(`    - ${s}`));
  }

  console.log(`  Itens a gravar: ${items.length}`);
  items.forEach((it, i) => {
    console.log(
      `    ${String(i + 1).padStart(2, '0')}. [${it.produto.codigo}] ${it.produto.produto || it.produto.nome} → ${it.quantidade} ${it.unidade}`
    );
  });

  await clearGrupo(sb, inv.grupo);

  if (DRY_RUN) {
    console.log('  [dry-run] nada gravado.');
    return { created: 0, skipped: skipped.length };
  }

  let created = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const loteJson = buildLote(
      it.produto,
      inv.notaFiscal,
      inv.lote,
      it.quantidade,
      it.unidade
    );
    const entradaCodigo = `${inv.grupo}-${String(i + 1).padStart(3, '0')}`;

    const entradaPayload = {
      data: TODAY,
      cliente_id: cliente.id,
      cliente_nome: cliente.nome,
      produto_id: it.produto.id,
      produto_nome: loteJson.produto_nome,
      produto_codigo: loteJson.produto_codigo,
      nota_fiscal: inv.notaFiscal,
      lote: inv.lote,
      densidade: null,
      quantidade: it.quantidade,
      unidade_medida: it.unidade,
      preco_unitario: 0,
      custo_total: 0,
      saldo_atual: it.quantidade,
      embalado: true,
      peso_liquido: it.quantidade,
      quantidade_embalagens: 1,
      status_wms: false,
      origem: 'convencional',
      grupo_entrada: inv.grupo,
      lotes: [loteJson],
    };

    const { data: entrada, error: eEnt } = await sb
      .from('entradas')
      .insert(entradaPayload)
      .select()
      .single();
    if (eEnt) {
      throw new Error(
        `Insert entrada [${it.produto.codigo}]: ${eEnt.message}`
      );
    }

    const estoquePayload = {
      entrada_id: entrada.id,
      entrada_codigo: entradaCodigo,
      grupo_entrada: inv.grupo,
      cliente_id: cliente.id,
      cliente_nome: cliente.nome,
      produto_id: it.produto.id,
      produto_nome: loteJson.produto_nome,
      produto_codigo: loteJson.produto_codigo,
      nota_fiscal: inv.notaFiscal,
      lote: inv.lote,
      densidade: null,
      quantidade: it.quantidade,
      unidade_medida: it.unidade,
      saldo_atual: it.quantidade,
      preco_unitario: 0,
      custo_total: 0,
      embalado: true,
      peso_liquido: it.quantidade,
      quantidade_embalagens: 1,
      status_wms: false,
      origem: 'convencional',
      lotes: [loteJson],
    };

    const { error: eEst } = await sb.from('estoque').insert(estoquePayload);
    if (eEst) {
      throw new Error(
        `Insert estoque [${it.produto.codigo}]: ${eEst.message}`
      );
    }
    created++;
  }

  console.log(`  OK — ${created} estoque(s) embalado(s)`);
  return { created, skipped: skipped.length };
}

async function main() {
  const root = resolve(process.cwd());
  const env = {
    ...loadEnv(resolve(root, '.env')),
    ...loadEnv(resolve(root, '.env.local')),
    ...process.env,
  };
  const url = normalizeSupabaseUrl(
    env.VITE_CHEMFLOW_SUPABASE_URL || env.VITE_SUPABASE_URL || ''
  );
  const key = (
    env.VITE_CHEMFLOW_SUPABASE_ANON_KEY ||
    env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  if (!url || !key) {
    console.error(
      'Configure VITE_CHEMFLOW_SUPABASE_* (ou VITE_SUPABASE_*) no .env'
    );
    process.exit(1);
  }

  const sb = createClient(url, key);
  console.log(DRY_RUN ? '[DRY-RUN]' : '[APPLY]');
  console.log('Inventário embalado VIBRA + VEOLIA');

  const { data: produtos, error: eProd } = await sb.from('produtos').select('*');
  if (eProd) throw new Error(eProd.message);
  const produtosCache = [...(produtos || [])];

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const inv of INVENTARIOS) {
    const tag = norm(inv.cliente);
    if (ONLY) {
      if (ONLY === 'VIBRA' && !tag.includes('VIBRA')) continue;
      if (ONLY === 'VEOLIA' && !tag.includes('VEOLIA')) continue;
      if (ONLY !== 'VIBRA' && ONLY !== 'VEOLIA' && !tag.includes(ONLY)) continue;
    }

    const cliente = await ensureCliente(sb, inv.cliente);
    if (!cliente?.id && !DRY_RUN) {
      throw new Error(`Cliente ${inv.cliente} sem id`);
    }

    const result = await seedInventario(sb, inv, cliente, produtosCache);
    totalCreated += result.created;
    totalSkipped += result.skipped;
  }

  console.log('\n══ Resumo ══');
  console.log(`Criados/atualizados: ${totalCreated}`);
  console.log(`Pulados (saldo 0): ${totalSkipped}`);
  if (DRY_RUN) console.log('(dry-run — nada gravado)');
}

main().catch((err) => {
  console.error('\nFalha no seed:', err.message || err);
  process.exit(1);
});
