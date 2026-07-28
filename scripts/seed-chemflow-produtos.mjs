/**
 * Seed / correção: cadastra clientes + produtos ChemFlow a partir da planilha
 * (Data / Produto / Cliente / Cod. Cliente / Densidade / Filtrado).
 *
 * Uso:
 *   node scripts/seed-chemflow-produtos.mjs           # só insere novos
 *   node scripts/seed-chemflow-produtos.mjs --replace # apaga produtos e reinsere
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
    // ignore missing file
  }
  return env;
}

function normalizeSupabaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
}

function parseBrDate(br) {
  const [d, m, y] = br.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function normalizeDensidade(raw) {
  if (!raw || raw === '-' || String(raw).trim() === '-') {
    return { densidade: '-', densidade_tabelada: false };
  }
  return {
    densidade: String(raw).trim().replace(',', '.'),
    densidade_tabelada: true,
  };
}

function normalizeCliente(nome) {
  return String(nome || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/ENERGIIA/i, 'ENERGIA')
    .replace(/^VEOUA$/i, 'VEOLIA');
}

/**
 * Tabela corrigida (anexo).
 * Filtrado: NÃO na maioria; SIM apenas em PROSOLV WEI 8062, HS 6765,
 * SI 9702 DW e SI9214 DW.
 */
const ROWS = [
  ['20/08/2025', 'ÁCIDO ACÉTICO GLACIAL', 'VIBRA ENERGIA', '1023021', '1,0500', 'NÃO'],
  ['20/08/2025', 'ALCOOL ANIDRO', 'VIBRA ENERGIA', '1003687', '0,7907', 'NÃO'],
  ['20/08/2025', 'AMODRILL 1000', 'VIBRA ENERGIA', '1023320', '0,7870', 'NÃO'],
  ['20/08/2025', 'AMODRILL 1610', 'VIBRA ENERGIA', '1023319', '0,7870', 'NÃO'],
  ['20/08/2025', 'BIOC', 'VIBRA ENERGIA', '1023571', '1,0200', 'NÃO'],
  ['20/08/2025', 'CARTABREAK OW 3132', 'VIBRA ENERGIA', '1025418', '0,9700', 'NÃO'],
  ['20/08/2025', 'FURFURAL', 'VIBRA ENERGIA', '1025413', '1,1590', 'NÃO'],
  ['20/08/2025', 'METANOL', 'VIBRA ENERGIA', '1024570', '0,7920', 'NÃO'],
  ['20/08/2025', 'MONOETILENOGLICOL', 'VIBRA ENERGIA', '1006057', '1,1100', 'NÃO'],
  ['20/08/2025', 'SISBRAX SCALE DTPA', 'VIBRA ENERGIA', '1023938', '1,2500', 'NÃO'],
  ['20/08/2025', 'SISBRAX ACE 75', 'VIBRA ENERGIA', '1023175', '1,0680', 'NÃO'],
  ['20/08/2025', 'SISBRAX AFW 01', 'VIBRA ENERGIA', '1023137', '0,7600', 'NÃO'],
  ['20/08/2025', 'SISBRAX AFW 02', 'VIBRA ENERGIA', '1023824', '0,8420', 'NÃO'],
  ['20/08/2025', 'SISBRAX CORR 5230', 'VIBRA ENERGIA', '1021965', '1,2400', 'NÃO'],
  ['20/08/2025', 'SISBRAX GL 210', 'VIBRA ENERGIA', '1023105', '1,1100', 'NÃO'],
  ['20/08/2025', 'SISBRAX SCALE DTPA', 'VIBRA ENERGIA', '1024004', '1,2500', 'NÃO'],
  ['20/08/2025', 'SISBRAX SCAVE CI-39', 'VIBRA ENERGIA', '1023957', '1,3000', 'NÃO'],
  ['20/08/2025', 'SISBRAX SCAVE TZ 70', 'VIBRA ENERGIA', '1024001', '1,1500', 'NÃO'],
  ['20/08/2025', 'SISBRAX SCAVE TZ 53', 'VIBRA ENERGIA', '1023970', '1,0424', 'NÃO'],
  ['20/08/2025', 'SOLBRAX QP', 'VIBRA ENERGIA', '1007516', '0,7950', 'NÃO'],
  ['20/08/2025', 'SOLBRAX QP', 'VIBRA ENERGIA', '1024094', '0,7950', 'NÃO'],
  ['20/08/2025', 'TRIETILENOGLICOL', 'VIBRA ENERGIA', '1023969', '1,1200', 'NÃO'],
  ['20/08/2025', 'XILENO', 'VIBRA ENERGIA', '1001665', '0,8500', 'NÃO'],
  ['20/08/2025', 'SISBRAX SCALE DTPA', 'VIBRA ENERGIA', '1023936', '1,2500', 'NÃO'],
  ['20/08/2025', 'AGENA BQ-1556', 'VIBRA ENERGIA', '1014212', '1,2500', 'NÃO'],
  ['20/08/2025', 'TRIETILENOGLICOL', 'VIBRA ENERGIA', '1023492', '1,1200', 'NÃO'],
  ['20/08/2025', 'BUTILGLICOL', 'CLARIANT', '11241725358', '-', 'NÃO'],
  ['20/08/2025', 'CORRTREAT 14180', 'CLARIANT', '29111429766', '-', 'NÃO'],
  ['20/08/2025', 'DISSOLVAN 14177', 'CLARIANT', '29932529766', '-', 'NÃO'],
  ['20/08/2025', 'DISSOLVAN 14746', 'CLARIANT', '29754529766', '-', 'NÃO'],
  ['20/08/2025', 'FOAMTREAT 14707', 'CLARIANT', '25028729766', '-', 'NÃO'],
  ['20/08/2025', 'MULTITREAT 9302', 'CLARIANT', '22958429766', '-', 'NÃO'],
  ['20/08/2025', 'PHASETREAT DF 14116', 'CLARIANT', '29090429766', '-', 'NÃO'],
  ['20/08/2025', 'NC-5250', 'SCHLUMBERGER', 'M0011593', '1,5000', 'NÃO'],
  ['20/08/2025', 'IDOS 143ADA', 'REP BRASIL', '10090', '1,0700', 'NÃO'],
  ['20/08/2025', 'NC-5250', 'SCHLUMBERGER', 'M0011590', '1,5000', 'NÃO'],
  ['20/08/2025', 'HYPERSPERSE MDC 150 BR', 'VEOLIA', '6008184', '1,1500', 'NÃO'],
  ['20/08/2025', 'NORUST 646', 'ARKEMA', '403934', '0,8300', 'NÃO'],
  ['20/08/2025', 'MONOETILENOGLICOL', 'BAKER HUGHES', 'BU143-00', '1,0990', 'NÃO'],
  ['27/08/2025', 'SISBRAX MEG 80', 'VIBRA ENERGIA', '1024399', '1,0900', 'NÃO'],
  ['27/08/2025', 'DOWSIL 9902', 'BAKER HUGHES', '4129079', '0,8200', 'NÃO'],
  ['29/08/2025', 'HYPERSPERSE MDC776 IBC', 'VEOLIA', '6013630', '1,2800', 'NÃO'],
  ['02/09/2025', 'RBW 405', 'BAKER HUGHES', 'BU3604-00', '1,0900', 'NÃO'],
  ['05/09/2025', 'KLEEN MCT194 IBC', 'VEOLIA', '6005326', '1,1000', 'NÃO'],
  ['06/09/2025', 'PROSOLV EB 8379', 'VEOLIA', '5032101', '0,8700', 'NÃO'],
  ['06/09/2025', 'MEMCHEM DCL40 BR', 'VEOLIA', '5027259', '1,3000', 'NÃO'],
  ['06/09/2025', 'PROSOLV SI 9039', 'VEOLIA', '5032495', '1,2300', 'NÃO'],
  ['06/09/2025', 'PROSOLV SI 9081', 'VEOLIA', '5033326', '1,2200', 'NÃO'],
  ['06/09/2025', 'PROSOLV WEI 8062', 'VEOLIA', '5025576', '1,0100', 'SIM'],
  ['06/09/2025', 'PROSOLV HS 6765', 'VEOLIA', '24051603', '1,1500', 'SIM'],
  ['06/09/2025', 'PROSOLV SI 9702 DW', 'VEOLIA', '5033887', '1,1600', 'SIM'],
  ['29/09/2025', 'ETHANOL', 'C INNOVATION', '2', '0,7900', 'NÃO'],
  ['30/09/2025', 'EXP4144', 'VEOLIA', '5033252', '1,1500', 'NÃO'],
  ['30/09/2025', 'EXP4144', 'VEOLIA', '6013046', '1,1500', 'NÃO'],
  ['07/10/2025', 'EXP4149', 'VEOLIA', '6014427', '1,0400', 'NÃO'],
  ['09/10/2025', 'BU7841-00', 'BAKER HUGHES', 'BU7841-00', '1,2500', 'NÃO'],
  ['14/10/2025', 'BU 5619-00', 'BAKER HUGHES', 'BU 5619-00', '1,2500', 'NÃO'],
  ['14/10/2025', 'BU143-00', 'BAKER HUGHES', 'BU143-00', '1,0990', 'NÃO'],
  ['17/10/2025', 'HYPERSPERSE MDC776', 'VEOLIA', '6008183', '1,2800', 'NÃO'],
  ['31/10/2025', 'REPCLEAN', 'REP BRASIL', '10029', '1,0700', 'NÃO'],
  ['18/11/2025', 'MONOETILENOGLICOL', 'GRUPO MARES', '35', '1,1000', 'NÃO'],
  ['05/12/2025', 'EXP 4138', 'VEOLIA', '6014608', '1,1600', 'NÃO'],
  ['15/12/2025', 'PROSOLV SI9214 DW', 'VEOLIA', '6014900', '1,1600', 'SIM'],
  ['24/12/2025', 'BRBW405-10', 'BAKER HUGHES', 'BRBW405-10', '1,0900', 'NÃO'],
  ['07/01/2026', 'SCAVENREP CI285', 'REP BRASIL', '10081', '1,3100', 'NÃO'],
  ['13/01/2026', 'FOAMTREAT 19502', 'CLARIANT', '32986329766', '-', 'NÃO'],
  ['24/01/2026', 'MEMCHEM DCL40BR', 'VEOLIA', '6008462', '1,3000', 'NÃO'],
  ['27/01/2026', 'FOAMTREAT 14459', 'CLARIANT', '29206926694', '0,8420', 'NÃO'],
  ['02/03/2026', 'BACTIREP 50 QT', 'REP BRASIL', '10012', '0,9600', 'NÃO'],
  ['02/03/2026', 'BACTIREP THPS 75', 'REP BRASIL', '10101', '1,4000', 'NÃO'],
  ['02/03/2026', 'PROSOLV OCI8070', 'VEOLIA', '5018959', '1,0320', 'NÃO'],
  ['09/03/2026', 'GLUTARALDEHYDE 50%', 'ARKEMA', '3', '1,1000', 'NÃO'],
  ['11/03/2026', 'MEMCHEM DCL40BR BB20L', 'VEOLIA', '6116614', '1,3000', 'NÃO'],
  ['27/03/2026', 'BACTIRAM 446', 'ARKEMA', '403959', '1,1000', 'NÃO'],
  ['30/03/2026', 'NC-5250 L', 'SCHLUMBERGER', '104725373', '1,5000', 'NÃO'],
  ['10/04/2026', 'EXP 4146', 'VEOLIA', '6026969', '1,1600', 'NÃO'],
  ['13/04/2026', 'INIPOL AD 8000', 'ARKEMA', '404505', '1,2500', 'NÃO'],
  ['15/04/2026', 'OPTISPERSE ADJ5050', 'VEOLIA', '6109597', '1,5200', 'NÃO'],
  ['17/04/2026', 'GLUTARALDEHYDE 50 TAMBOR', 'ARKEMA', '404021', '1,2500', 'NÃO'],
  ['14/05/2026', 'SISBRAX DEMUL PT', 'VIBRA ENERGIA', '1026799', '0,8900', 'NÃO'],
  ['26/05/2026', 'BACTIRAM 3000', 'ARKEMA', '403507', '1,1000', 'NÃO'],
  ['26/05/2026', 'ANTIESPUMANTE', 'BAKER HUGHES', 'BU5143', '1,0000', 'NÃO'],
  ['12/06/2026', 'SISBRAX SCALE SQ-01', 'VIBRA ENERGIA', '1025543', '1,2930', 'NÃO'],
  ['06/07/2026', 'PROSOLV SI9566', 'VEOLIA', '6015720', '1,0960', 'NÃO'],
  ['06/07/2026', 'PROSOLV EB7157', 'VEOLIA', '6014439', '1,0800', 'NÃO'],
  ['06/07/2026', 'PROSOLV EB7156', 'VEOLIA', '6015718', '1,0300', 'NÃO'],
];

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

  const seen = new Set();
  const uniqueRows = [];
  for (const row of ROWS) {
    const [, produto, clienteRaw, codigo] = row;
    const cliente = normalizeCliente(clienteRaw);
    const keyRow = `${String(codigo).trim()}||${cliente}||${produto.trim()}`;
    if (seen.has(keyRow)) continue;
    seen.add(keyRow);
    uniqueRows.push([row[0], produto, cliente, String(codigo).trim(), row[4], row[5]]);
  }

  const clienteNomes = [...new Set(uniqueRows.map((r) => r[2]))].sort();

  console.log(`Modo: ${replace ? 'REPLACE (apaga e reinsere)' : 'INSERT (só novos)'}`);
  console.log(`Clientes únicos: ${clienteNomes.length}`);
  console.log(`Produtos na planilha: ${uniqueRows.length} (de ${ROWS.length} linhas)`);

  const { data: clientesExistentes, error: errClientesList } = await supabase
    .from('clientes')
    .select('id, nome');
  if (errClientesList) throw new Error(`Listar clientes: ${errClientesList.message}`);

  const clienteByNome = new Map(
    (clientesExistentes || []).map((c) => [c.nome.trim().toUpperCase(), c])
  );

  const clientesCriados = [];
  for (const nome of clienteNomes) {
    if (clienteByNome.get(nome.toUpperCase())) continue;
    const { data, error } = await supabase
      .from('clientes')
      .insert({ nome })
      .select('id, nome')
      .single();
    if (error) throw new Error(`Criar cliente ${nome}: ${error.message}`);
    clienteByNome.set(nome.toUpperCase(), data);
    clientesCriados.push(data.nome);
  }

  console.log(`Clientes criados agora: ${clientesCriados.length}`);

  if (replace) {
    const { data: existentes, error: errList } = await supabase
      .from('produtos')
      .select('id');
    if (errList) throw new Error(`Listar produtos: ${errList.message}`);
    const ids = (existentes || []).map((p) => p.id);
    console.log(`Apagando ${ids.length} produtos existentes...`);
    // delete em lotes
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const { error } = await supabase.from('produtos').delete().in('id', chunk);
      if (error) throw new Error(`Apagar produtos: ${error.message}`);
    }
  }

  const payloads = uniqueRows.map(([dataBr, produto, cliente, codigo, densRaw, filtradoRaw]) => {
    const dens = normalizeDensidade(densRaw);
    const clienteRow = clienteByNome.get(cliente.toUpperCase());
    return {
      codigo,
      produto: produto.trim(),
      cliente_id: clienteRow?.id || null,
      cliente_nome: cliente,
      densidade: dens.densidade,
      densidade_tabelada: dens.densidade_tabelada,
      filtrado: String(filtradoRaw).trim().toUpperCase().startsWith('S'),
      data_cadastro: parseBrDate(dataBr),
    };
  });

  let toInsert = payloads;
  if (!replace) {
    const { data: produtosExistentes, error: errProdList } = await supabase
      .from('produtos')
      .select('id, codigo, produto, cliente_nome');
    if (errProdList) throw new Error(`Listar produtos: ${errProdList.message}`);

    const produtoKey = (p) =>
      `${String(p.codigo || '').trim()}||${normalizeCliente(p.cliente_nome || '').toUpperCase()}||${String(p.produto || '').trim().toUpperCase()}`;
    const existingKeys = new Set((produtosExistentes || []).map(produtoKey));
    toInsert = payloads.filter((p) => !existingKeys.has(produtoKey(p)));
    console.log(`Já existiam (pulados): ${payloads.length - toInsert.length}`);
  }

  console.log(`Inserindo: ${toInsert.length}`);

  if (toInsert.length === 0) {
    console.log('Nada a inserir.');
    return;
  }

  const created = [];
  for (let i = 0; i < toInsert.length; i += 50) {
    const chunk = toInsert.slice(i, i + 50);
    const { data, error } = await supabase
      .from('produtos')
      .insert(chunk)
      .select('id, codigo, produto, cliente_nome, filtrado, densidade');
    if (error) throw new Error(`Inserir produtos (lote ${i / 50 + 1}): ${error.message}`);
    created.push(...(data || []));
  }

  const filtradoSim = created.filter((p) => p.filtrado).length;
  console.log(`\nOK — ${created.length} produtos no ChemFlow.`);
  console.log(`Filtrado=SIM: ${filtradoSim} | Filtrado=NÃO: ${created.length - filtradoSim}`);
  console.log('Produtos filtrados (SIM):');
  for (const p of created.filter((x) => x.filtrado)) {
    console.log(`  - [${p.codigo}] ${p.produto}`);
  }
}

main().catch((err) => {
  console.error('\nFalha no seed:', err.message || err);
  process.exit(1);
});
