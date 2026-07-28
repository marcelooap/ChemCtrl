/**
 * Seed ChemFlow: produtos das 6 tabelas anexas (Data / Produto / Codigo).
 * Todos com filtrado = NÃO, sem cliente, sem densidade tabelada.
 *
 * Uso: node scripts/seed-chemflow-produtos-tabelas.mjs
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

function parseBrDate(br) {
  const [d, m, y] = String(br).trim().split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function normalizeCodigo(raw) {
  let c = String(raw ?? '').trim();
  if (!c) return '';
  // Excel scientific notation (pt-BR): 1,02237E+11
  const sci = c.match(/^(\d+),(\d+)[Ee]\+(\d+)$/);
  if (sci) {
    const n = Number(`${sci[1]}.${sci[2]}e+${sci[3]}`);
    if (Number.isFinite(n)) return String(Math.round(n));
  }
  const sciEn = c.match(/^(\d+(?:\.\d+)?)[Ee]\+(\d+)$/);
  if (sciEn) {
    const n = Number(c);
    if (Number.isFinite(n)) return String(Math.round(n));
  }
  // trailing dots from spreadsheet
  c = c.replace(/\.+$/, '').trim();
  return c;
}

function isPendingCodigo(codigo) {
  const c = String(codigo || '').trim().toUpperCase();
  if (!c || c === '-') return true;
  return /^PENDENTE/.test(c) || c === 'TESTE 01';
}

/** [data, produto, codigo] — 6 tabelas anexas */
const ROWS = [
  // —— Tabela 1 ——
  ['23/06/2022', 'ACIDO CITRICO - KG', '1003321'],
  ['29/05/2023', 'ÁCIDO CLORIDRICO 32%', '1025425'],
  ['23/06/2022', 'ADJUNCT-B - KG', '1009061'],
  ['23/06/2022', 'AGENA DET-1549 BB 20 L', '1023919'],
  ['23/06/2022', 'AGENA DET-1564 BB 20 L', '1017059'],
  ['22/06/2022', 'ÁGUA DEIONIZADA BB 20 L', '1024332'],
  ['22/06/2022', 'ÁGUA DESMINERALIZADA BB 20 L', '1016291'],
  ['23/06/2022', 'ÁGUA DESTILADA BB 20 L', '1024362'],
  ['13/09/2022', 'AK 12500', '1023118'],
  ['22/06/2022', 'AMEROYAL BB 25 L', '1017963'],
  ['23/06/2022', 'AMERSITE CHZ - BB 25L', '1015835'],
  ['05/06/2023', 'AMERSITE CHZ A AMPOULE REFILL', '1024901'],
  ['05/06/2023', 'AMERSITE CHZ B AMPOULE REFILL', '1024903'],
  ['23/06/2022', 'AQUCAR 790 - IBC 1000', '1021252'],
  ['06/12/2022', 'ARDROX 6322', '1015739'],
  ['29/06/2023', 'BIFLUORETO DE AMONIO - KG', '1003538'],
  ['05/06/2023', 'BOILER PHOSPHATE AMP REFILL', '1024904'],
  ['08/07/2022', 'BOMBONA VERDE NEW 20L PEAD', '5004082'],
  ['22/06/2022', 'Carbonato de sódio / BARRILHA KG', '1003518'],
  ['27/02/2023', 'CARTABREAK OW 3132', '1025418'],
  ['23/06/2022', 'CASTROL TRANSAQUA DW - LI', '1009163'],
  ['05/06/2023', 'CHLORIDE HP TEST KIT', '1024875'],
  ['05/06/2023', 'CHLORIDE LMP TEST KIT', '1024905'],
  ['23/06/2022', 'CIL - BB 20 L', '1018600'],
  ['23/06/2022', 'DESCALEX - BB 25KG', '1023145'],
  ['21/12/2022', 'DOWSIL 9510-CT 1,5', '1021059'],
  ['23/06/2022', 'DREWPLEX OX - BB 25 Lts.', '1011273'],
  ['23/06/2022', 'EDTA DISSÓDICO', '1018231'],
  ['23/06/2022', 'EDTA TETRASSÓDICO', '1023967'],
  ['15/02/2023', 'ERIFON HD 603 - BB200L', '1024712'],
  ['23/06/2022', 'ERIFON HD 603 HP BB 208 L / 218 KG', '1007564'],
  ['23/06/2022', 'ERITORBATO DE SÓDIO', '1006484'],
  ['23/06/2022', 'FLUORESCEINA SÓDICA', '1002847'],
  ['23/06/2022', 'GAMAZYME 700 FN - BALDE 12 KG', '1015981'],
  ['23/06/2022', 'GAMAZYME BTC-CX 12L', '1015971'],
  ['23/06/2022', 'GASOLINA A PREMIUM PODIUM TB', '1024645'],
  ['23/06/2022', 'GC - BB 25 L', '1011892'],
  ['23/06/2022', 'GROTAMAR 71 - BB 200 L', '1026252'],
  ['14/04/2023', 'HIDRÓXIDO DE AMÔNIA TB 200 L', '1024911'],
  ['26/12/2022', 'HIDROXIDO DE SODIO A 50% TB-200 L', '1012074'],
  ['23/06/2022', 'HIPOCLORITO DE SÓDIO - BB 20 L', '1023975'],
  ['22/06/2022', 'HIPOCLORITO DE SÓDIO BB 200 L', '1015692'],
  ['23/06/2022', 'HIPOCLORITO DE SODIO - CT 1000L', '1016642'],
  ['22/06/2022', 'HIPOCLORITO DE SÓDIO BB 50 L', '1023974'],
  ['23/06/2022', 'LIQUID COAGULANT - BB 25 LITROS', '1017966'],
  ['22/06/2022', 'MAXFLOC OG 679B CT 1.500 L', '1023074'],
  ['14/07/2022', 'MAXSCAV OG 511B', '1023980'],
  ['22/06/2022', 'METAL BRITE BB 25 L', '1024282'],
  ['22/06/2022', 'METILDIETANOLAMINA', '1023966'],
  ['22/06/2022', 'MONOETILENOGLICOL CT 5000 L', '1006057'],

  // —— Tabela 2 ——
  ['22/08/2022', 'MONOETILENOGLICOL TB 200 L', '1024012'],
  ['04/07/2022', 'MONOETILENOGLICOL TB', 'BU143-00'],
  ['14/09/2022', 'NEOFLO 1-58', '1022818'],
  ['22/06/2022', 'Nitrato de cálcio 50% CT 5000 L', '1018249'],
  ['15/02/2023', 'OCEANIC HW 525P - BB200L', '1019811'],
  ['04/08/2022', 'PENTAPOTASSIUM DTPA', '1023938'],
  ['05/06/2023', 'PHENOLPHTALEIN IND-500ML', '1024906'],
  ['05/06/2023', 'PHOSPHATE VACU VIAL REFILL', '1024879'],
  ['22/06/2022', 'ROCOR NB LIQUID BB 25 L', '1022451'],
  ['23/06/2022', 'SAF ACID - BB 25 KG', '1014535'],
  ['09/01/2023', 'SISBRAX ACE 75 T', '1023175'],
  ['21/07/2022', 'SISBRAX ACE IN 750', '1024346'],
  ['23/06/2022', 'SISBRAX BIOC QT TB 194 L', '1022674'],
  ['29/06/2023', 'SISBRAX CLEANER AC-01', '1025577'],
  ['29/06/2023', 'SISBRAX CLEANER AK-01', '1025576'],
  ['29/05/2023', 'SISBRAX CORR 5230 - TB 248 KG', '1024361'],
  ['22/06/2022', 'SISBRAX CORR 5230 CT 1.500 L', '1021965'],
  ['22/06/2022', 'SISBRAX CORR 5230 TB 200 L', '1024361'],
  ['08/08/2022', 'SISBRAX CORR BR-02 CT 1500L', '1024333'],
  ['16/02/2023', 'SISBRAX GL 210', '1023105'],
  ['11/04/2023', 'SISBRAX SCALE DTPA', '1024004'],
  ['12/01/2023', 'SISBRAX SCAVE O-39', '1023957'],
  ['20/09/2022', 'SISBRAX SCAVE TZ70', '1024001'],
  ['23/06/2022', 'SLCC - A - LI', '1009066'],
  ['22/06/2022', 'Hidróxido de Sódio 50% - TB 200L', '1024670'],
  ['30/06/2022', 'SODA CAUSTICA ESCAMAS - SC 25KG', '1021671'],
  ['23/06/2022', 'SOLBRAX QP – QUEROSENE 20 L', '1007516'],
  ['23/06/2022', 'SOLBRAX QP QUEROSENE TB 200L', '1007516'],
  ['13/09/2022', 'SOLVENTE SOLBRAX ECO 230/260', '1017256'],
  ['05/06/2023', 'SULFURIC ACID N/10-1000ML', '1024894'],
  ['05/06/2023', 'TOTAL ALKALINITY IND GP 500 ML', '1024906'],
  ['23/06/2022', 'Trietilenoglicol - CT 1500 L', '1013072'],
  ['23/06/2022', 'Trietilenoglicol - GRA', '1023969'],
  ['22/06/2022', 'TRIETILENOGLICOL - TB 208 L', '1023969'],
  ['19/10/2022', 'Ucarsol HS-101', '1017613'],
  ['29/08/2022', 'VACCUM PIPE CLEARNER BB 25L', '1024291'],
  ['23/06/2022', 'VERSOL PLUS ECO - BB 200 L', '1024421'],
  ['28/10/2022', 'XILENO CT 5.000 L', '1024392'],
  ['19/07/2023', 'TAMBOR', '5000133'],
  ['20/07/2023', 'SUMALIN AF 85', '1025633'],
  ['03/08/2023', 'QUEROSENE ILUMINANTE - LT 18L', '1025632'],
  ['11/05/2023', 'SOLBRAX QP - QUEROSENE CT 1000L', '1007516'],
  ['11/08/2023', 'SISBRAX SCAVE TZ70', '1024001'],
  ['17/08/2023', 'HIPOCLORITO DE SÓDIO IBC 1.000 L', '1016642'],
  ['24/08/2023', 'METANOL - TB 200 L', '1002902'],
  ['01/09/2023', 'STD COND SOLUTION 1,413 US', '1025615'],
  ['01/09/2023', 'STD COND SOLUTION 84US', '1025623'],
  ['01/09/2023', 'AMERSITE CHZ B ACTIVATOR SOLN', '1025672'],
  ['20/09/2023', 'TRIETILENOGLICOL', '1023969'],
  ['20/12/2023', 'ARDROX 6345 BB 25 L', '1021893'],

  // —— Tabela 3 ——
  ['20/12/2023', 'SISBRAX AFW 02', '1023824'],
  ['15/02/2024', 'SISBRAX CLEANER AK-01 TB 200 L', '1023222'],
  ['06/12/2024', 'UCARSOL AP 814', '1,02237E+11'],
  ['28/02/2024', 'METHANOL ENERGY CARTRIDGE 28L', '12422'],
  ['28/02/2024', 'METHANOL ENERGY CARTRIDGE 60L', '12423'],
  ['06/05/2024', 'STARBICOR PVB', '1026003'],
  ['17/05/2024', 'PROSOLV RB8474', '6009403'],
  ['21/05/2024', 'SCALETROL PDC 9456L', '6011804'],
  ['21/05/2024', 'PROSOLV SI9000', '6115358'],
  ['21/05/2024', 'BETZDEARBON R227', '5032757'],
  ['21/05/2024', 'EXP4139', '6012946'],
  ['21/05/2024', 'EXP4120', '6012414'],
  ['21/05/2024', 'PROSOLV EB8379', '5032101'],
  ['21/05/2024', 'EXP4097', '5032030'],
  ['21/05/2024', 'EB 8370', '5032101'],
  ['21/05/2024', 'EXP4120 CT', '5032757'],
  ['22/05/2024', 'PROSOLV OCI8070', '5018969'],
  ['22/05/2024', 'PROSOLV SI9039', '6011749'],
  ['27/05/2024', 'SISBRAX FLOC V01', '1026001'],
  ['28/05/2024', 'DISSOLVAN 14177', '29932525358'],
  ['28/05/2024', 'DISSOLVAN 14746', '29754525358'],
  ['28/05/2024', 'FROAMTREAT 14707', '29328725358'],
  ['29/05/2024', 'CORRTREAT 14180', '29111425358'],
  ['05/06/2024', 'ÁCIDO CÍTRICO ANIDRO', 'L77090-00'],
  ['05/06/2024', 'TANQUE - 550GAL', ''],
  ['07/06/2024', 'ALCOOL ANIDRO', '1003687'],
  ['17/06/2024', 'GENAMIN DAT 100', '19536518038'],
  ['17/06/2024', '2-MERCAPTOETANOL', '21220330042'],
  ['17/06/2024', 'TC - 925', '24397523411'],
  ['17/06/2024', 'DETRIX 10040', '31492321170'],
  ['04/06/2024', 'TAMBOR - VEOLIA', '26353'],
  ['18/06/2024', 'PROSOLV EXP 4106', '5032241'],
  ['25/06/2024', 'BOMBONA PLAST BB 20L', '22313'],
  ['25/06/2024', 'KLEEN MCT882', '6108233'],
  ['25/06/2024', 'MEMCHEM MCT109 BB 20L', '6004980'],
  ['25/06/2024', 'BIOMATE MBC2881B', '6116922'],
  ['25/06/2024', 'MEMCHEM MCT109 BB 200L', '6000242'],
  ['25/06/2024', 'EXP4106', '6012704'],
  ['27/06/2024', 'BGL BUTIL GLICOL', '11241726694'],
  ['27/06/2024', 'FONGRABAC THPS', '18235112243'],
  ['27/06/2024', 'PHASETREAT DF 14116', '29092425358'],
  ['04/07/2024', 'EXP4138', '6012972'],
  ['11/07/2024', 'CARTASCAVE TZ', '1024001'],
  ['11/07/2024', 'IBC', 'IBC VIBRA'],
  ['18/07/2024', 'KLEEN MCT194 200L', '6002674'],
  ['18/07/2024', 'MEMCHEM DCL40BR', '6002674'],
  ['18/07/2024', 'KLEEN MCT194', '6002674'],
  ['18/07/2024', 'MEMCHEM DCL40BR IBC', '6008482'],
  ['18/07/2024', 'PROSOLV HS8782DW RESIDUO', ''],
  ['22/07/2024', 'SODA CÁUSTICA ESCAMAS IMP', '1025426'],

  // —— Tabela 4 ——
  ['31/07/2024', 'HYPERSPERSE MDC776', '6113226'],
  ['07/08/2024', 'FLOCTREAT 7924', '1073041'],
  ['14/08/2024', 'QUEROSENE BB 20 L - VEOLIA', '151745'],
  ['14/08/2024', 'ALCOOL 96% BB 20 L - VEOLIA', '121217'],
  ['21/08/2024', 'CORTROL IS 3020', '6108219'],
  ['21/08/2024', 'HYPERSPERSE MDC 150 BR', '6118802'],
  ['21/08/2024', 'KLEEN MCT 515', '6117643'],
  ['22/08/2024', 'BOMBONA PLAST AZUL Z67 e Z66', '22315'],
  ['29/08/2024', 'KLEEN MCT194 BB 20L', '6005328'],
  ['29/08/2024', 'MEMCHEM DCL40BR BB 20L', '6116614'],
  ['02/09/2024', 'EXP4144', '5033292'],
  ['09/09/2024', 'SISBRAX AFW02', '1023824'],
  ['10/09/2024', 'HIPOCLORITO DE CALCIO GRANULADO 14KG', '1011262'],
  ['11/09/2024', 'HYPERSPERSE MDC776 BB 200L', '6113042'],
  ['11/09/2024', 'KLEEN MCT194 BB 200L', '6002674'],
  ['16/09/2024', 'SUMALIN AC3035', '1026442'],
  ['17/09/2024', 'BOMBONA PLAST 20L', '6000122'],
  ['17/09/2024', 'BOMBONA PLAST 200L', '10254461'],
  ['19/09/2024', 'PROSOLV OCI8070 CT', '6012823'],
  ['19/09/2024', 'METANOL - GL 05 L ALCOOL METILICO', '12426'],
  ['19/09/2024', 'M28 FEED ADAPTER FOR PRO SERIES 151003011', '12425'],
  ['19/09/2024', 'SERVICE FLUID', '12424'],
  ['23/09/2024', 'CUSTON CLEAN CC31', '6115529'],
  ['25/09/2024', 'METHANOL ENERGY CARTRIDGE 28L VAZIO BB', '12427'],
  ['25/09/2024', 'METHANOL ENERGY CARTRIDGE 60L VAZIO BB', '12428'],
  ['01/10/2024', 'Container plastico 1000L', '997260'],
  ['09/10/2024', 'IBC - SLB', '-'],
  ['28/10/2024', 'HYPERSPERSE MDC776 IBC', '6013630'],
  ['25/10/2024', 'RECOND UM UMP 1000L', '27278'],
  ['07/11/2024', 'SILICONES SAG 10', '2277'],
  ['07/11/2024', 'PROSOLV RB8465', '6004149'],
  ['04/12/2024', 'LUBRAX CALCIUM ZN - BL 20KG', '1010530'],
  ['04/12/2024', 'LUBRAX COMPSOR DE 100 - BL 20-L', '1010181'],
  ['04/12/2024', 'LUBRAX TOP TURBO - BB20L', '1002395'],
  ['17/12/2024', 'BACTIRAM 446', '403959'],
  ['27/12/2024', 'THPS 75', 'TESTE 01'],
  ['07/01/2025', 'SODA CAUSTICA 98% - KG', '1010991'],
  ['14/01/2025', 'KLEEN MCT 503 - BB 20L', '6116610'],
  ['14/01/2025', 'BIOMATE MBC2881B - BB 20L', '6115333'],
  ['27/01/2025', 'EXP 4143', '5032358'],
  ['27/04/2024', 'CONTAINER FUGRO', '1063'],
  ['29/01/2025', 'MI BR LUBE PH', 'pendente'],
  ['30/01/2025', 'WT 12046 BULK 1L', 'pendente'],
  ['07/02/2025', 'IBC CLARIANT', ''],
  ['11/02/2025', 'MB-5068', 'pendente 01'],
  ['20/02/2025', 'THPS 75 IBC 1400KG', '20717'],
  ['22/02/2025', 'BETZDEARBORN R227BR', '6115558'],
  ['22/02/2025', 'EXP4097 - RETO', '6010352'],
  ['10/03/2025', 'METANOL - lt', '1002902'],
  ['18/03/2025', 'PROSOLV EB8434', '6012946'],

  // —— Tabela 5 ——
  ['26/03/2025', 'SISBRAX SCAVE O-39 - BB 20L', '1023957'],
  ['26/03/2025', 'SOLBRAX QP - BB 20L', '1007516'],
  ['01/04/2025', 'SISBRAX SCAVE O-39 - BB 200L', '1026454'],
  ['14/04/2025', 'KLEEN MCT515', '6116050'],
  ['17/04/2025', 'IDOS 143AGA', '10090'],
  ['17/04/2025', 'IBC REP BRASIL', '1010009'],
  ['12/05/2025', 'SISBRAX TZ 53', '1023970'],
  ['13/05/2025', 'FOAMTREAT 14707', '29328729766'],
  ['15/05/2025', 'NORUST', '403934'],
  ['20/05/2025', 'AGENA SQ-1556/KA', 'PENDENTE 05'],
  ['20/05/2025', 'BIOTREAT 4682', '24122523372'],
  ['29/05/2025', 'FOAMTROL AF2050', '6013772'],
  ['29/05/2025', 'KLEEN MCT529', '6014346'],
  ['05/06/2025', 'SOLBRAX QP - CT', '1007516'],
  ['06/06/2025', 'EXP 4138 CT 1500L', '6012981'],
  ['24/06/2025', 'HIPOCLORITO DE SÓDIO BB 24 KG', '1027448'],
  ['24/06/2025', 'HIPOCLORITO DE SÓDIO BB 50', '1027449'],
  ['24/06/2025', 'HIPOCLORITO DE SÓDIO BB 240 kg', '1027454'],
  ['24/06/2025', 'MULTITREAT 9302', '22958426694'],
  ['01/07/2025', 'EXP 4149', '6014427'],
  ['03/07/2025', 'RBW 405 CLARIFICANTE', 'BRBW405-10'],
  ['17/07/2025', 'PROSOLV HS 8785', '6010724'],
  ['25/07/2025', 'TRIETILENOGLICOL - IMP', '1023492'],
  ['08/08/2025', 'HIPOCLORITO DE CÁLCIO - BB 14 kg', '73708'],
  ['08/08/2025', 'HYPERSPERSE MDC 150 BR - IBC', '6008194'],
  ['11/08/2025', 'HIPOCLORITO DE SÓDIO BB 60 kg', '1027449'],
  ['22/08/2025', 'SODIUM HYPOCHLORITE CMD', '6118252'],
  ['22/08/2025', 'ACIDO SULFURICO 98%', '6118080'],
  ['22/08/2025', 'PROSOLV RB 8474 BB 200L', '6011961'],
  ['25/08/2025', 'OPTISPERSE ADJ5050', '6109597'],
  ['26/08/2025', 'KLEEN MCT503 IBC', '611804'],
  ['04/07/2022', 'MONOETILENOGLICOL IBC', 'BU143-00'],
  ['28/08/2025', 'CLARIFICANTE DE AGUAS PRF5323', 'BU3604-00'],
  ['28/08/2025', 'ERITORBATO DE SÓDIO - KG', '1006484'],
  ['01/09/2025', 'OCEANIC SST 5007', '1026973'],
  ['04/09/2025', 'KLEEN MCT194 IBC', '6005326'],
  ['03/09/2025', 'IBC - BAKER', '1'],
  ['04/09/2025', 'IBC - VEOLIA', ''],
  ['08/09/2025', 'EXP4150', '6014439'],
  ['12/09/2025', 'EMBALAGEM TAMBORES', '2'],
  ['01/04/2025', 'SISBRAX SCAVE O-39 - BB 200L ISO', '1023957'],
  ['29/09/2025', 'ETHANOL', '3'],
  ['01/10/2025', 'PROSOLV SI9081', '6013178'],
  ['07/10/2025', 'BU8619-00 (SAL DE SÓDIO DE ÁCIDO POLIAMINO)', 'BU8619-00'],
  ['07/10/2025', 'BU7841-00 (BRIQUEST 221-40AS)', 'BU7841-00'],
  ['08/10/2025', 'Hidróxido de Sódio 50% - BB 250 KG', '1024670'],
  ['31/10/2025', 'POLIOL POLIMERIZADO', '32047'],
  // duplicatas KLEEN MCT194 IBC no final da tabela 5 — ignoradas no dedupe

  // —— Tabela 6 ——
  ['31/10/2025', 'RESINA FENOLICA OXIALQUILADA', '31354'],
  ['14/11/2025', 'MONOETILENOGLICOL IBC - GRUPO MARES', 'PENDENTE 01'],
  ['05/12/2025', '(ARQUAD MCB-50 )SISBRAX BIOC QT IBC', '1026182'],
  ['01/01/2026', 'EXP 4148', ''],
  ['20/01/2026', 'CORANTE UNISOL LIQUID RED B', '1'],
  ['18/12/2025', 'BIOMATE SAN9494', '6114606'],
  ['20/01/2026', 'HIPOCLORITO DE CALCIO BD 45 KG', '1011262'],
  ['26/01/2026', 'FOAMTREAT 14459', '29206926694'],
  ['05/03/2026', 'GR CLEAN 65 GRANULADO', '1011262'],
  ['05/03/2026', 'DICLOROISOCIANURATO DE SODIO 60 %', '1028104'],
  ['16/04/2026', 'PROSOLV RB 8474 IBC', '6011961'],
  ['22/04/2026', 'SISBRAX CORR 5206', '1028244'],
  ['27/05/2026', 'ACIDO CITRICO LIQUIDO TB 200 KG', '1027751'],
  ['24/07/2026', 'ENERC ACD CL-IN', '1028926'],
];

function rowKey(codigo, produto) {
  return `${String(codigo).trim()}||${String(produto).trim().toUpperCase()}`;
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

  const skippedEmpty = [];
  const skippedPending = [];
  const seen = new Set();
  const unique = [];

  for (const [dataBr, produtoRaw, codigoRaw] of ROWS) {
    const produto = String(produtoRaw || '').trim().replace(/\s+/g, ' ');
    const codigo = normalizeCodigo(codigoRaw);
    if (!produto) continue;

    if (!codigo) {
      skippedEmpty.push(produto);
      continue;
    }

    // Mantém códigos "pendente" / "TESTE 01" / "-" conforme a planilha
    // (usuário pediu cadastrar as tabelas; códigos placeholder ficam registrados)
    const keyRow = rowKey(codigo, produto);
    if (seen.has(keyRow)) continue;
    seen.add(keyRow);

    if (isPendingCodigo(codigo)) {
      skippedPending.push(`${produto} [${codigo}]`);
    }

    unique.push({
      codigo,
      produto,
      cliente_id: null,
      cliente_nome: '',
      densidade: '-',
      densidade_tabelada: false,
      filtrado: false,
      data_cadastro: parseBrDate(dataBr),
    });
  }

  console.log(`Linhas na planilha: ${ROWS.length}`);
  console.log(`Únicos após dedupe: ${unique.length}`);
  console.log(`Sem código (pulados): ${skippedEmpty.length}`);
  if (skippedEmpty.length) {
    for (const p of skippedEmpty) console.log(`  - ${p}`);
  }

  const { data: existentes, error: errList } = await supabase
    .from('produtos')
    .select('id, codigo, produto');
  if (errList) throw new Error(`Listar produtos: ${errList.message}`);

  const existingKeys = new Set(
    (existentes || []).map((p) => rowKey(p.codigo || '', p.produto || ''))
  );

  const toInsert = unique.filter((p) => !existingKeys.has(rowKey(p.codigo, p.produto)));
  console.log(`Já existiam (pulados): ${unique.length - toInsert.length}`);
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
      .select('id, codigo, produto, filtrado');
    if (error) throw new Error(`Inserir lote ${i / 50 + 1}: ${error.message}`);
    created.push(...(data || []));
  }

  const { count } = await supabase
    .from('produtos')
    .select('*', { count: 'exact', head: true });

  const filtradoSim = created.filter((p) => p.filtrado).length;
  console.log(`\nOK — ${created.length} produtos cadastrados (filtrado=NÃO).`);
  console.log(`Filtrado SIM no lote: ${filtradoSim} (deve ser 0)`);
  console.log(`Total de produtos no ChemFlow agora: ${count}`);
  if (skippedPending.length) {
    console.log(`\nCom código placeholder (cadastrados mesmo assim): ${skippedPending.length}`);
    for (const p of skippedPending) console.log(`  - ${p}`);
  }
}

main().catch((err) => {
  console.error('\nFalha no seed:', err.message || err);
  process.exit(1);
});
