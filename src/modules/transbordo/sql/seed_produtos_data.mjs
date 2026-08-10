/**
 * Seed one-shot: cadastra clientes + produtos do Transbordo (t_clientes / t_produtos).
 * Uso: node src/modules/transbordo/sql/seed_produtos_data.mjs
 *
 * Idempotente: não recria cliente pelo nome (case-insensitive) nem produto
 * pela combinação codigo + produto + cliente_nome.
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
const url = (env.VITE_CHEMFLOW_SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
const key = (env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || '').trim();

if (!url || !key) {
  console.error('Credenciais VITE_CHEMFLOW_SUPABASE_* ausentes no .env');
  process.exit(1);
}

const supabase = createClient(url, key);

/** [produto, cliente, codigo] — limpeza de espaços/pontos finais do paste. */
const RAW = [
  ['ACIDO CITRICO - KG', 'VIBRA ENERGIA', '1003321'],
  ['ÁCIDO CLORIDRICO 32%', 'VIBRA ENERGIA', '1025425'],
  ['ADJUNCT-B - KG', 'VIBRA ENERGIA', '1009061'],
  ['AGENA DET-1549 BB 20 L', 'VIBRA ENERGIA', '1023919'],
  ['AGENA DET-1564 BB 20 L', 'VIBRA ENERGIA', '1017059'],
  ['ÁGUA DEIONIZADA BB 20 L', 'VIBRA ENERGIA', '1024332'],
  ['ÁGUA DESMINERALIZADA BB 20 L', 'VIBRA ENERGIA', '1016291'],
  ['ÁGUA DESTILADA BB 20L', 'VIBRA ENERGIA', '1024362'],
  ['AK 12500', 'VIBRA ENERGIA', '1023118'],
  ['AMEROYAL BB 25 L', 'VIBRA ENERGIA', '1017963'],
  ['AMERSITE CHZ - BB 25L', 'VIBRA ENERGIA', '1015835'],
  ['AMERSITE CHZ A AMPOULE REFILL', 'VIBRA ENERGIA', '1024901'],
  ['AMERSITE CHZ B AMPOULE REFILL', 'VIBRA ENERGIA', '1024903'],
  ['AQUCAR 790 - IBC 1000', 'VIBRA ENERGIA', '1021252'],
  ['ARDROX 6322', 'VIBRA ENERGIA', '1015739'],
  ['BIFLUORETO DE AMONIO', 'VIBRA ENERGIA', '1003538'],
  ['BOILER PHOSPHATE AMP REFILL', 'VIBRA ENERGIA', '1024904'],
  ['BOMBONA VERDE NEW 20L PEAD', 'VIBRA ENERGIA', '5004082'],
  ['CARBONATO DE SÓDIO - BARRILHA', 'VIBRA ENERGIA', '1003518'],
  ['CARTABREAK OW 3132', 'VIBRA ENERGIA', '1025418'],
  ['CASTROL TRANSAQUA DW - LI', 'VIBRA ENERGIA', '1009163'],
  ['CHLORIDE HP TEST KIT', 'VIBRA ENERGIA', '1024875'],
  ['CHLORIDE LMP TEST KIT', 'VIBRA ENERGIA', '1024905'],
  ['CIL - BB 20 L', 'VIBRA ENERGIA', '1018600'],
  ['DESCALEX - BB 25KG', 'VIBRA ENERGIA', '1023145'],
  ['DOWSIL 9510-CT 1,5', 'VIBRA ENERGIA', '1021059'],
  ['DREWPLEX OX - BB 25 Lts.', 'VIBRA ENERGIA', '1011273'],
  ['EDTA DISSÓDICO', 'VIBRA ENERGIA', '1018231'],
  ['EDTA TETRASSÓDICO', 'VIBRA ENERGIA', '1023967'],
  ['ERIFON HD 603 - BB200L', 'VIBRA ENERGIA', '1024712'],
  ['ERIFON HD 603 HP BB 208 L / 218 KG', 'VIBRA ENERGIA', '1007564'],
  ['ERITORBATO DE SÓDIO', 'VIBRA ENERGIA', '1006484'],
  ['FLUORESCEINA SÓDICA', 'VIBRA ENERGIA', '1002847'],
  ['GAMAZYME 700 FN - BALDE 12 KG', 'VIBRA ENERGIA', '1015981'],
  ['GAMAZYME BTC-CX 12L', 'VIBRA ENERGIA', '1015971'],
  ['GASOLINA A PREMIUM PODIUM TB', 'VIBRA ENERGIA', '1024645'],
  ['GC  - BB 25 L', 'VIBRA ENERGIA', '1011892'],
  ['GROTAMAR 71 - BB 200 L', 'VIBRA ENERGIA', '1026252'],
  ['HIDRÓXIDO DE AMÔNIA TB 200 L', 'VIBRA ENERGIA', '1024911'],
  ['HIDROXIDO DE SODIO A 50% TB-200 L', 'VIBRA ENERGIA', '1012074'],
  ['HIPOCLORITO DE SÓDIO - BB 20 L', 'VIBRA ENERGIA', '1023975'],
  ['HIPOCLORITO DE SÓDIO  BB 200 L', 'VIBRA ENERGIA', '1015692'],
  ['HIPOCLORITO DE SÓDIO BB 50 L', 'VIBRA ENERGIA', '1023974'],
  ['LIQUID COAGULANT - BB 25 LITROS', 'VIBRA ENERGIA', '1017966'],
  ['MAXFLOC OG 679B CT 1.500 L', 'VIBRA ENERGIA', '1023074'],
  ['MAXSCAV OG 511B', 'VIBRA ENERGIA', '1023980'],
  ['METAL BRITE BB 25 L', 'VIBRA ENERGIA', '1024282'],
  ['METILDIETANOLAMINA', 'VIBRA ENERGIA', '1023966'],
  ['MONOETILENOGLICOL CT 5000 L', 'VIBRA ENERGIA', '1006057'],
  ['MONOETILENOGLICOL TB 200 L', 'VIBRA ENERGIA', '1024012'],
  ['MONOETILENOGLICOL', 'BAKER HUGHES', 'BU143-00'],
  ['NEOFLO 1-58', 'VIBRA ENERGIA', '1022818'],
  ['Nitrato de cálcio 50% CT 5000 L', 'VIBRA ENERGIA', '1018249'],
  ['OCEANIC HW 525P – BB200L', 'VIBRA ENERGIA', '1019811'],
  ['PENTAPOTASSIUM DTPA', 'VIBRA ENERGIA', '1023938'],
  ['PHENOLPHTALEIN IND-500ML', 'VIBRA ENERGIA', '1024906'],
  ['PHOSPHATE VACU VIAL REFILL', 'VIBRA ENERGIA', '1024879'],
  ['ROCOR NB LIQUID BB 25 L', 'VIBRA ENERGIA', '1022451'],
  ['SAF ACID - BB 25 KG', 'VIBRA ENERGIA', '1014535'],
  ['SISBRAX ACE 75 T', 'VIBRA ENERGIA', '1023175'],
  ['SISBRAX ACE IN 750', 'VIBRA ENERGIA', '1024346'],
  ['SISBRAX BIOC QT TB 194 L', 'VIBRA ENERGIA', '1022674'],
  ['SISBRAX CLEANER AC-01', 'VIBRA ENERGIA', '1025577'],
  ['SISBRAX CLEANER AK-01', 'VIBRA ENERGIA', '1025576'],
  ['SISBRAX CORR 5230 - TB 248 KG', 'VIBRA ENERGIA', '1024361'],
  ['SISBRAX CORR 5230 CT 1.500 L', 'VIBRA ENERGIA', '1021965'],
  ['SISBRAX CORR BR-02 CT 1500L', 'VIBRA ENERGIA', '1024333'],
  ['SISBRAX GL 210', 'VIBRA ENERGIA', '1023105'],
  ['SISBRAX SCALE DTPA', 'VIBRA ENERGIA', '1024004'],
  ['SLCC - A  - LI', 'VIBRA ENERGIA', '1009066'],
  ['HIDRÓXIDO DE SÓDIO 50% - TB 200L', 'VIBRA ENERGIA', '1024670'],
  ['SODA CAUSTICA ESCAMAS - SC 25KG', 'VIBRA ENERGIA', '1021671'],
  ['SOLBRAX QP – QUEROSENE 20 L', 'VIBRA ENERGIA', '1007516'],
  ['SOLBRAX QP QUEROSENE  TB 200L', 'VIBRA ENERGIA', '1007516'],
  ['SOLVENTE SOLBRAX ECO 230/260', 'VIBRA ENERGIA', '1017256'],
  ['SULFURIC ACID N/10-1000ML', 'VIBRA ENERGIA', '1024894'],
  ['TRIETILENOGLICOL - TB 208 L', 'VIBRA ENERGIA', '1023969'],
  ['Ucarsol HS-101', 'VIBRA ENERGIA', '1017613'],
  ['VACCUM PIPE CLEARNER BB 25L', 'VIBRA ENERGIA', '1024291'],
  ['VERSOL PLUS ECO - BB 200 L', 'VIBRA ENERGIA', '1024421'],
  ['XILENO CT 5.000 L', 'VIBRA ENERGIA', '1024392'],
  ['SUMALIN AF 85', 'VIBRA ENERGIA', '1025633'],
  ['QUEROSENE ILUMINANTE - LT 18L', 'VIBRA ENERGIA', '1025632'],
  ['SOLBRAX QP -  CT 1000L', 'VIBRA ENERGIA', '1007516'],
  ['HIPOCLORITO DE SÓDIO IBC 1.000 L', 'VIBRA ENERGIA', '1016642'],
  ['METANOL - TB 200 L', 'VIBRA ENERGIA', '1002902'],
  ['STD COND SOLUTION 1,413 US', 'VIBRA ENERGIA', '1025615'],
  ['STD COND SOLUTION 84US', 'VIBRA ENERGIA', '1025623'],
  ['AMERSITE CHZ B ACTIVATOR SOLN', 'VIBRA ENERGIA', '1025672'],
  ['ARDROX 6345 BB 25 L', 'VIBRA ENERGIA', '1021893'],
  ['SISBRAX CLEANER AK-01 TB 200 L', 'VIBRA ENERGIA', '1023222'],
  ['UCARSOL AP 814', 'DORF KETAL', '102237000000'],
  ['METHANOL ENERGY CARTRIDGE 28L', 'FUGRO', '12422'],
  ['METHANOL ENERGY CARTRIDGE 60L', 'FUGRO', '12423'],
  ['STARBICOR PVB', 'VIBRA ENERGIA', '1026003'],
  ['PROSOLV RB 8474', 'VEOLIA', '6009403'],
  ['SCALETROL PDC 9456L', 'VEOLIA', '6011804'],
  ['PROSOLV SI 9000', 'VEOLIA', '6115358'],
  ['BETZDEARBON R227', 'VEOLIA', '5032757'],
  ['EXP 4120', 'VEOLIA', '6012414'],
  ['EXP 4097', 'VEOLIA', '5032030'],
  ['EB 8370', 'VEOLIA', '5032101'],
  ['PROSOLV OCI 8070', 'VEOLIA', '5018969'],
  ['SISBRAX FLOC V01', 'VIBRA ENERGIA', '1026001'],
  ['PROSOLV EXP 4106', 'VEOLIA', '5032241'],
  ['KLEEN MCT882', 'VEOLIA', '6108233'],
  ['MEMCHEM MCT109 BB 20L', 'VEOLIA', '6004980'],
  ['BIOMATE MBC 2881B', 'VEOLIA', '6116922'],
  ['MEMCHEM MCT 109 BB 200L', 'VEOLIA', '6000242'],
  ['EXP 4106', 'VEOLIA', '6012704'],
  ['EXP4138', 'VEOLIA', '6012972'],
  ['CARTASCAVE TZ', 'VIBRA ENERGIA', '1024001'],
  ['MEMCHEM DCL40BR IBC', 'VEOLIA', '6008482'],
  ['SODA CÁUSTICA ESCAMAS IMP', 'VIBRA ENERGIA', '1025426'],
  ['HYPERSPERSE MDC776', 'VEOLIA', '6113226'],
  ['FLOCTREAT 7924', 'CLARIANT', '1073041'],
  ['QUEROSENE BB 20 L - VEOLIA', 'VEOLIA', '151745'],
  ['ALCOOL 96% BB 20 L - VEOLIA', 'VEOLIA', '121217'],
  ['CORTROL IS 3020', 'VEOLIA', '6108219'],
  ['HYPERSPERSE MDC 150 BR', 'VEOLIA', '6118802'],
  ['KLEEN MCT 515', 'VEOLIA', '6117643'],
  ['BOMBONA PLAST AZUL Z67 e Z66', 'VEOLIA', '22315'],
  ['KLEEN MCT194 BB 20L', 'VEOLIA', '6005328'],
  ['MEMCHEM DCL40BR BB 20L', 'VEOLIA', '6116614'],
  ['EXP4144', 'VEOLIA', '5033292'],
  ['SISBRAX AFW02', 'VIBRA ENERGIA', '1023824'],
  ['HYPERSPERSE MDC776 BB 200L', 'VEOLIA', '6113042'],
  ['KLEEN MCT194 BB 200L', 'VEOLIA', '6002674'],
  ['SUMALIN AC3035', 'VIBRA ENERGIA', '1026442'],
  ['BOMBONA PLAST 20L', 'VIBRA ENERGIA', '6000122'],
  ['BOMBONA PLAST 200L', 'VIBRA ENERGIA', '10254461'],
  ['PROSOLV OCI8070 CT', 'VEOLIA', '6012823'],
  ['METANOL - GL 05 L ALCOOL METILICO', 'FUGRO', '12426'],
  ['M28 FEED ADAPTER FOR PRO SERIES 151003011', 'FUGRO', '12425'],
  ['SERVICE FLUID', 'FUGRO', '12424'],
  ['CUSTON CLEAN CC31', 'VEOLIA', '6115529'],
  ['METHANOL ENERGY CARTRIDGE 28L VAZIO BB', 'FUGRO', '12427'],
  ['METHANOL ENERGY CARTRIDGE 60L VAZIO BB', 'FUGRO', '12428'],
  ['HYPERSPERSE MDC776 IBC', 'VEOLIA', '6013630'],
  ['RECOND UM UMP 1000L', 'VEOLIA', '27278'],
  ['SILICONES SAG 10', 'VEOLIA', '2277'],
  ['PROSOLV RB8465', 'VEOLIA', '6004149'],
  ['LUBRAX CALCIUM ZN - BL 20KG', 'VIBRA ENERGIA', '1010530'],
  ['LUBRAX COMPSOR DE 100 - BL 20-L', 'VIBRA ENERGIA', '1010181'],
  ['LUBRAX TOP TURBO - BB20L', 'VIBRA ENERGIA', '1002395'],
  ['BACTIRAM 446', 'ARKEMA', '403959'],
  ['SODA CAUSTICA 98% - KG', 'VIBRA ENERGIA', '1010991'],
  ['KLEEN MCT 503 - BB 20L', 'VEOLIA', '6116610'],
  ['BIOMATE MBC2881B - BB 20L', 'VEOLIA', '6115333'],
  ['EXP 4143', 'VEOLIA', '5032358'],
  ['THPS 75  IBC 1400KG', 'VEOLIA', '20717'],
  ['BETZDEARBORN R227BR', 'VEOLIA', '6115558'],
  ['EXP4097 - RETO', 'VEOLIA', '6010352'],
  ['PROSOLV EB8434', 'VEOLIA', '6012946'],
  ['KLEEN MCT515', 'VEOLIA', '6116050'],
  ['NORUST', 'ARKEMA', '403934'],
  ['BIOTREAT 4682', 'CLARIANT', '24122523372'],
  ['FOAMTROL AF2050', 'VEOLIA', '6013772'],
  ['KLEEN MCT529', 'VEOLIA', '6014346'],
  ['EXP 4138 CT 1500L', 'VEOLIA', '6012981'],
  ['HIPOCLORITO DE SÓDIO BB 24 KG', 'VIBRA ENERGIA', '1027448'],
  ['HIPOCLORITO DE SÓDIO BB 240 kg', 'VIBRA ENERGIA', '1027454'],
  ['EXP 4149', 'VEOLIA', '6014427'],
  ['PROSOLV HS 8785', 'VEOLIA', '6010724'],
  ['HIPOCLORITO DE CÁLCIO - BB 14 kg', 'VIBRA ENERGIA', '73708'],
  ['HYPERSPERSE MDC 150 BR - IBC', 'VEOLIA', '6008194'],
  ['HIPOCLORITO DE SÓDIO BB 60 kg', 'VIBRA ENERGIA', '1027449'],
  ['SODIUM HYPOCHLORITE CMD', 'VEOLIA', '6118252'],
  ['ACIDO SULFURICO 98%', 'VEOLIA', '6118080'],
  ['PROSOLV RB 8474 BB 200L', 'VEOLIA', '6011961'],
  ['OPTISPERSE ADJ5050', 'VEOLIA', '6109597'],
  ['KLEEN MCT503 IBC', 'VEOLIA', '611804'],
  ['CLARIFICANTE DE AGUAS PRF5323', 'BAKER HUGHES', 'BU3604-00'],
  ['OCEANIC SST 5007', 'VIBRA ENERGIA', '1026973'],
  ['EXP4150', 'VEOLIA', '6014439'],
  ['SISBRAX SCAVE O-39 - BB 200L ISO', 'VIBRA ENERGIA', '1023957'],
  ['ETHANOL', 'C INNOVATION', '3'],
  ['KLEEN MCT194 IBC', 'VEOLIA', '6005326'],
  ['(ARQUAD MCB-50 )SISBRAX BIOC QT IBC', 'VIBRA ENERGIA', '1026182'],
  ['BIOMATE SAN9494', 'VEOLIA', '6114606'],
  ['GR CLEAN 65 GRANULADO', 'VIBRA ENERGIA', '1011262'],
  ['DICLOROISOCIANURATO DE SODIO 60 %', 'VIBRA ENERGIA', '1028104'],
  ['SISBRAX CORR 5206', 'VIBRA ENERGIA', '1028244'],
  ['ACIDO CITRICO LIQUIDO TB 200 KG', 'VIBRA ENERGIA', '1027751'],
  ['ENERC ACD CL-IN', 'VIBRA ENERGIA', '1028926'],
];

function productKey(codigo, produto, clienteNome) {
  return `${String(codigo).trim().toLowerCase()}||${String(produto).trim().toLowerCase()}||${String(clienteNome || '').trim().toLowerCase()}`;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const { data: clientesExistentes, error: clientesErr } = await supabase
    .from('t_clientes')
    .select('id, nome');
  if (clientesErr) throw new Error(`t_clientes: ${clientesErr.message}`);

  const clienteByNome = new Map(
    (clientesExistentes || []).map((c) => [c.nome.trim().toLowerCase(), c])
  );

  const clienteNomes = [...new Set(RAW.map(([, c]) => c.trim()))];
  const novosClientes = [];
  for (const nome of clienteNomes) {
    if (!clienteByNome.has(nome.toLowerCase())) {
      novosClientes.push({ nome });
    }
  }

  if (novosClientes.length > 0) {
    const { data: criados, error } = await supabase
      .from('t_clientes')
      .insert(novosClientes)
      .select('id, nome');
    if (error) throw new Error(`insert clientes: ${error.message}`);
    for (const c of criados || []) {
      clienteByNome.set(c.nome.trim().toLowerCase(), c);
    }
    console.log(`Clientes criados: ${criados?.length || 0}`);
  } else {
    console.log('Nenhum cliente novo a criar.');
  }

  const { data: produtosExistentes, error: produtosErr } = await supabase
    .from('t_produtos')
    .select('id, codigo, produto, cliente_nome');
  if (produtosErr) throw new Error(`t_produtos: ${produtosErr.message}`);

  const existingKeys = new Set(
    (produtosExistentes || []).map((p) =>
      productKey(p.codigo, p.produto, p.cliente_nome)
    )
  );

  const toInsert = [];
  let skipped = 0;
  for (const [produto, clienteNome, codigo] of RAW) {
    const key = productKey(codigo, produto, clienteNome);
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    const cliente = clienteByNome.get(clienteNome.toLowerCase());
    toInsert.push({
      codigo: String(codigo).trim(),
      produto: produto.trim(),
      cliente_id: cliente?.id || null,
      cliente_nome: cliente?.nome || clienteNome,
      densidade: '-',
      densidade_tabelada: false,
      filtrado: false,
      data_cadastro: today,
    });
    existingKeys.add(key);
  }

  console.log(`Produtos na lista: ${RAW.length}`);
  console.log(`Já existentes (skip): ${skipped}`);
  console.log(`A inserir: ${toInsert.length}`);

  const chunkSize = 100;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize);
    const { data, error } = await supabase.from('t_produtos').insert(chunk).select('id');
    if (error) throw new Error(`insert produtos (offset ${i}): ${error.message}`);
    inserted += data?.length || 0;
    console.log(`  lote ${Math.floor(i / chunkSize) + 1}: +${data?.length || 0}`);
  }

  console.log(`Concluído. Inseridos: ${inserted}. Clientes únicos: ${clienteNomes.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
