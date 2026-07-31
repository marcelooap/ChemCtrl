/**
 * Inventário SISBRAX SCAVE O-39 (1023957) — VIBRA ENERGIA
 * - Entrada + Estoque (lotes)
 * - Vasilhames (incl. fracionado 13567-0)
 * - TANKA 46
 *
 * Uso:
 *   node scripts/seed-chemflow-sisbrax-scave-o39.mjs
 *   node scripts/seed-chemflow-sisbrax-scave-o39.mjs --dry-run
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const SEED_CODIGO = 'T-INV-SCAVE-O39';
const ENTRADA_CODIGO = 'E-INV-SCAVE-O39';
const DENS_FALLBACK = 1.3;
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

function roundVolume(v) {
  return Math.round(Number(v) || 0);
}

function roundMass(v) {
  return Math.round(Number(v) || 0);
}

function norm(v) {
  return String(v || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function parsePlacaBarril(vasilhame) {
  const raw = String(vasilhame || '').trim();
  if (!raw) return { placa: '', barril: '' };
  const m = raw.match(/^(.+)-(\d+)$/);
  if (m) return { placa: m[1], barril: m[2] };
  return { placa: raw, barril: '' };
}

function matchesTanka(ref, isotanqueId, tankaCodigo) {
  if (!ref) return false;
  if (isotanqueId && (ref.tanka_id === isotanqueId || ref.entrada_id === isotanqueId)) {
    return true;
  }
  const codigo = norm(tankaCodigo);
  if (!codigo) return false;
  return norm(ref.tanka_codigo) === codigo || norm(ref.entrada_codigo) === codigo;
}

function computeTankaSaldo(iso, transbordos, excludeId = null) {
  let entrada = 0;
  let saida = 0;
  for (const t of transbordos) {
    if (excludeId && t.id === excludeId) continue;
    for (const d of t.destinos || []) {
      if (
        d.tipo_embalagem === 'Tankagem' &&
        matchesTanka(d, iso.id, iso.tanka)
      ) {
        entrada += roundVolume(d.volume_total || d.volume || 0);
      }
    }
    for (const o of t.origens || []) {
      if (o.tipo_origem === 'tanka' && matchesTanka(o, iso.id, iso.tanka)) {
        saida += roundVolume(o.volume_retirado || 0);
      }
    }
  }
  return roundVolume(entrada - saida);
}

/** Volumes em L (pt-BR: 1.500 = 1500). */
const VASILHAMES = [
  { lote: '2606180624', vasilhame: '14342-1', volume: 1500, massa: 1950 },
  { lote: '2606180624', vasilhame: '14353-5', volume: 1500, massa: 1950 },
  { lote: '2606180624', vasilhame: '17983-2', volume: 1500, massa: 1950 },
  { lote: '2606180624', vasilhame: '15561-2', volume: 1500, massa: 1950 },
  { lote: '2606180624', vasilhame: '16088-7', volume: 1500, massa: 1950 },
  { lote: '2606180624', vasilhame: '15066-4', volume: 5000, massa: 6500 },
  { lote: '2606180624', vasilhame: '14995-1', volume: 5000, massa: 6500 },
  { lote: '2606180624', vasilhame: '16760-1', volume: 1500, massa: 1950 },
  { lote: '2606180624', vasilhame: '17878-9', volume: 1500, massa: 1950 },
  { lote: '2606180624', vasilhame: '16780-4', volume: 1500, massa: 1950 },
  { lote: '2606180624', vasilhame: '14170-4', volume: 1500, massa: 1950 },
];

/** Fracionado 13567-0 — dois lotes na mesma embalagem. */
const FRACIONADO = {
  vasilhame: '13567-0',
  partes: [
    { lote: '2606180624', volume: 869, massa: 1130 },
    { lote: '2511211329', volume: 2133, massa: 2773 },
  ],
};

const TANKA = {
  tanka: 'TANKA 46',
  lote: '2606160615',
  volume: 24400,
  massa: 31720,
};

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
    console.error('Configure VITE_CHEMFLOW_SUPABASE_* (ou VITE_SUPABASE_*) no .env');
    process.exit(1);
  }

  const sb = createClient(url, key);
  console.log(DRY_RUN ? '[DRY-RUN]' : '[APPLY]');

  const { data: produtos, error: eProd } = await sb.from('produtos').select('*');
  if (eProd) throw new Error(eProd.message);

  const produto =
    (produtos || []).find(
      (p) =>
        String(p.codigo || '').trim() === '1023957' &&
        norm(p.produto || p.nome) === 'SISBRAX SCAVE O-39'
    ) ||
    (produtos || []).find(
      (p) =>
        String(p.codigo || '').trim() === '1023957' &&
        Number(String(p.densidade || '').replace(',', '.')) > 0
    ) ||
    (produtos || []).find((p) => String(p.codigo || '').trim() === '1023957') ||
    (produtos || []).find((p) =>
      norm(p.produto || p.nome).includes('SCAVE O-39')
    );
  if (!produto) throw new Error('Produto SISBRAX SCAVE O-39 (1023957) não encontrado');

  const produtoNome = produto.produto || produto.nome || 'SISBRAX SCAVE O-39';
  const produtoCodigo = produto.codigo || '1023957';
  const densParsed = Number(
    String(produto.densidade || '')
      .replace(',', '.')
      .replace(/[^\d.]/g, '')
  );
  const dens = densParsed > 0 ? densParsed : DENS_FALLBACK;
  const densStr = densParsed > 0 ? String(produto.densidade) : String(DENS_FALLBACK);

  const { data: clientes, error: eCli } = await sb.from('clientes').select('*');
  if (eCli) throw new Error(eCli.message);
  const cliente =
    (clientes || []).find((c) => norm(c.nome) === 'VIBRA ENERGIA') ||
    (clientes || []).find((c) => norm(c.nome).includes('VIBRA'));
  if (!cliente) throw new Error('Cliente VIBRA ENERGIA não encontrado');

  const { data: isotanques, error: eIso } = await sb.from('isotanques').select('*');
  if (eIso) throw new Error(eIso.message);
  const iso46 = (isotanques || []).find((i) => norm(i.tanka) === 'TANKA 46');
  if (!iso46) throw new Error('Isotanque TANKA 46 não encontrado');

  // Totais por lote (entrada/estoque)
  const loteVolumes = new Map();
  const addLote = (lote, vol, massa) => {
    const prev = loteVolumes.get(lote) || { volume: 0, massa: 0 };
    prev.volume += vol;
    prev.massa += massa;
    loteVolumes.set(lote, prev);
  };
  for (const v of VASILHAMES) addLote(v.lote, v.volume, v.massa);
  for (const p of FRACIONADO.partes) addLote(p.lote, p.volume, p.massa);
  addLote(TANKA.lote, TANKA.volume, TANKA.massa);

  const lotesEntrada = [...loteVolumes.entries()].map(([lote, t]) => {
    const vol = roundVolume(t.volume);
    const massa = roundMass(t.massa || vol * dens);
    return {
      produto_id: produto.id,
      produto_nome: produtoNome,
      produto_codigo: produtoCodigo,
      nota_fiscal: `INV-${SEED_CODIGO}`,
      lote,
      densidade: densStr,
      quantidade: massa,
      unidade_medida: 'kg',
      data_fabricacao: null,
      data_validade: null,
      preco_unitario: 0,
      embalado: false,
      peso_liquido: null,
      quantidade_embalagens: null,
      _volume_l: vol,
    };
  });

  const qtdTotalKg = lotesEntrada.reduce((s, l) => s + l.quantidade, 0);
  const volTotalL = lotesEntrada.reduce((s, l) => s + l._volume_l, 0);

  console.log('\nProduto:', produtoCodigo, produtoNome, '| dens', densStr);
  console.log('Cliente:', cliente.nome);
  console.log('Lotes entrada:');
  lotesEntrada.forEach((l) =>
    console.log(`  ${l.lote}: ${l._volume_l} L / ${l.quantidade} kg`)
  );
  console.log('Total:', volTotalL, 'L /', qtdTotalKg, 'kg');
  console.log(
    'Vasilhames:',
    VASILHAMES.length,
    '+ fracionado',
    FRACIONADO.vasilhame,
    '+',
    TANKA.tanka
  );

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] nada gravado.');
    return;
  }

  // ── Entrada ──
  const { data: entradasExist } = await sb
    .from('entradas')
    .select('*')
    .eq('nota_fiscal', `INV-${SEED_CODIGO}`);
  let entrada = (entradasExist || [])[0] || null;

  const entradaPayload = {
    cliente_id: cliente.id,
    cliente_nome: cliente.nome || 'VIBRA ENERGIA',
    produto_id: produto.id,
    produto_nome: produtoNome,
    produto_codigo: produtoCodigo,
    nota_fiscal: `INV-${SEED_CODIGO}`,
    lote: lotesEntrada[0]?.lote || '',
    densidade: densStr,
    quantidade: qtdTotalKg,
    unidade_medida: 'kg',
    preco_unitario: 0,
    custo_total: 0,
    saldo_atual: qtdTotalKg,
    embalado: false,
    status_wms: false,
    origem: 'convencional',
    grupo_entrada: ENTRADA_CODIGO,
    lotes: lotesEntrada.map(({ _volume_l, ...rest }) => rest),
  };

  if (entrada?.id) {
    const { data, error } = await sb
      .from('entradas')
      .update(entradaPayload)
      .eq('id', entrada.id)
      .select()
      .single();
    if (error) throw new Error(`Update entrada: ${error.message}`);
    entrada = data;
    console.log('\nEntrada atualizada:', entrada.id);
  } else {
    const { data, error } = await sb
      .from('entradas')
      .insert(entradaPayload)
      .select()
      .single();
    if (error) throw new Error(`Insert entrada: ${error.message}`);
    entrada = data;
    console.log('\nEntrada criada:', entrada.id);
  }

  // ── Estoque (1 registro por lote) ──
  const { data: estoqueExist } = await sb
    .from('estoque')
    .select('*')
    .eq('grupo_entrada', ENTRADA_CODIGO);

  // Remove estoque antigo deste inventário
  for (const e of estoqueExist || []) {
    await sb.from('estoque').delete().eq('id', e.id);
  }

  const estoqueRecords = lotesEntrada.map((l, i) => ({
    entrada_id: entrada.id,
    entrada_codigo: `${ENTRADA_CODIGO}-${i + 1}`,
    grupo_entrada: ENTRADA_CODIGO,
    cliente_id: cliente.id,
    cliente_nome: cliente.nome || 'VIBRA ENERGIA',
    produto_id: produto.id,
    produto_nome: produtoNome,
    produto_codigo: produtoCodigo,
    nota_fiscal: `INV-${SEED_CODIGO}`,
    lote: l.lote,
    densidade: densStr,
    quantidade: l.quantidade,
    unidade_medida: 'kg',
    saldo_atual: l.quantidade,
    preco_unitario: 0,
    custo_total: 0,
    embalado: false,
    status_wms: false,
    origem: 'convencional',
    lotes: [
      {
        produto_id: produto.id,
        produto_nome: produtoNome,
        produto_codigo: produtoCodigo,
        nota_fiscal: `INV-${SEED_CODIGO}`,
        lote: l.lote,
        densidade: densStr,
        quantidade: l.quantidade,
        unidade_medida: 'kg',
        embalado: false,
        volume_l: l._volume_l,
      },
    ],
  }));

  const { data: savedEstoques, error: eEst } = await sb
    .from('estoque')
    .insert(estoqueRecords)
    .select();
  if (eEst) throw new Error(`Insert estoque: ${eEst.message}`);
  console.log('Estoque:', (savedEstoques || []).length, 'lote(s)');

  const estoqueByLote = new Map(
    (savedEstoques || []).map((e) => [e.lote, e])
  );

  // ── Transbordo inventário (origens = estoque → destinos vasilhames/tanka) ──
  const { data: transbordos, error: eTrans } = await sb
    .from('transbordos')
    .select('*');
  if (eTrans) throw new Error(eTrans.message);

  let seedOp = (transbordos || []).find(
    (t) => t.codigo_transbordo === SEED_CODIGO
  );

  const origens = (savedEstoques || []).map((e) => {
    const vol = roundVolume(
      e.lotes?.[0]?.volume_l ||
        (dens > 0 ? Number(e.quantidade) / dens : 0)
    );
    return {
      tipo_origem: 'entrada',
      entrada_id: e.id,
      entrada_codigo: `${e.entrada_codigo} — Lote ${e.lote}`,
      lote: e.lote,
      volume_retirado: vol,
      massa_retirada: roundMass(e.quantidade),
      saldo_restante: 0,
      saldo_disponivel: vol,
    };
  });

  // Compensa saldo prévio da TANKA 46
  const saldoOutros = computeTankaSaldo(iso46, transbordos || [], seedOp?.id || null);
  if (saldoOutros > 0) {
    origens.push({
      tipo_origem: 'tanka',
      entrada_id: iso46.id,
      entrada_codigo: iso46.tanka,
      tanka_codigo: iso46.tanka,
      lote: `AJUSTE-INV-${iso46.tanka}`,
      volume_retirado: saldoOutros,
      massa_retirada: roundMass(saldoOutros * dens),
      saldo_restante: 0,
      saldo_disponivel: saldoOutros,
    });
  }

  const destinos = [];
  let destinoIndex = 0;

  for (const v of VASILHAMES) {
    const { placa, barril } = parsePlacaBarril(v.vasilhame);
    destinos.push({
      tipo_embalagem: 'Vasilhame',
      placa,
      barril,
      volume: v.volume,
      volume_total: v.volume,
      peso_liquido: v.massa,
      peso_bruto: v.massa,
      tara: 0,
      fracionado: false,
      destino_index: destinoIndex++,
      _lote: v.lote,
    });
  }

  // Fracionado
  {
    const { placa, barril } = parsePlacaBarril(FRACIONADO.vasilhame);
    const vol = FRACIONADO.partes.reduce((s, p) => s + p.volume, 0);
    const massa = FRACIONADO.partes.reduce((s, p) => s + p.massa, 0);
    destinos.push({
      tipo_embalagem: 'Vasilhame',
      placa,
      barril,
      volume: vol,
      volume_total: vol,
      peso_liquido: massa,
      peso_bruto: massa,
      tara: 0,
      fracionado: true,
      destino_index: destinoIndex++,
      _lotes: FRACIONADO.partes,
    });
  }

  destinos.push({
    tipo_embalagem: 'Tankagem',
    tanka_id: iso46.id,
    tanka_codigo: iso46.tanka,
    volume: TANKA.volume,
    volume_total: TANKA.volume,
    peso_liquido: TANKA.massa,
    peso_bruto: TANKA.massa,
    tara: 0,
    fracionado: false,
    destino_index: destinoIndex++,
    _lote: TANKA.lote,
  });

  const volume_total = destinos.reduce(
    (s, d) => s + roundVolume(d.volume_total),
    0
  );
  const massa_total = destinos.reduce(
    (s, d) => s + roundMass(d.peso_liquido),
    0
  );

  const opPayload = {
    codigo_transbordo: SEED_CODIGO,
    data: TODAY,
    cliente_id: cliente.id,
    cliente_nome: cliente.nome || 'VIBRA ENERGIA',
    produto_id: produto.id,
    produto_nome: produtoNome,
    produto_codigo: produtoCodigo,
    densidade: densStr,
    volume_total,
    massa_total,
    operadores: ['Inventário'],
    observacoes:
      'Inventário SISBRAX SCAVE O-39 — vasilhames + TANKA 46 (entrada E-INV-SCAVE-O39).',
    origens,
    destinos: destinos.map(({ _lote, _lotes, ...d }) => d),
  };

  if (seedOp?.id) {
    const { data, error } = await sb
      .from('transbordos')
      .update(opPayload)
      .eq('id', seedOp.id)
      .select()
      .single();
    if (error) throw new Error(`Update OP: ${error.message}`);
    seedOp = data;
    console.log('OP atualizado:', seedOp.codigo_transbordo);
    // Remove vasilhames criados por este OP
    await sb.from('vasilhames').delete().eq('transbordo_id', seedOp.id);
  } else {
    const { data, error } = await sb
      .from('transbordos')
      .insert(opPayload)
      .select()
      .single();
    if (error) throw new Error(`Insert OP: ${error.message}`);
    seedOp = data;
    console.log('OP criado:', seedOp.codigo_transbordo);
  }

  // ── Vasilhames ──
  const vasilhameRecords = [];

  for (const v of VASILHAMES) {
    const { placa, barril } = parsePlacaBarril(v.vasilhame);
    vasilhameRecords.push({
      codigo: SEED_CODIGO,
      origem: 'transbordo',
      transbordo_id: seedOp.id,
      numero_op: SEED_CODIGO,
      placa,
      barril,
      tipo: 'Vasilhame',
      produto_id: produto.id,
      produto_nome: produtoNome,
      produto_codigo: produtoCodigo,
      cliente_id: cliente.id,
      cliente_nome: cliente.nome || 'VIBRA ENERGIA',
      lote: v.lote,
      densidade: densStr,
      volume: v.volume,
      tara: 0,
      peso_liquido: v.massa,
      peso_bruto: v.massa,
      status: 'No Pátio',
      data_saida: null,
      responsavel: 'Inventário',
      fracionado: false,
      composicao: [
        {
          lote: v.lote,
          quantidade_l: v.volume,
          quantidade_kg: v.massa,
          transbordo_codigo: SEED_CODIGO,
          data: TODAY,
        },
      ],
    });
  }

  // Fracionado 13567-0
  {
    const { placa, barril } = parsePlacaBarril(FRACIONADO.vasilhame);
    const vol = FRACIONADO.partes.reduce((s, p) => s + p.volume, 0);
    const massa = FRACIONADO.partes.reduce((s, p) => s + p.massa, 0);
    const dominant = [...FRACIONADO.partes].sort(
      (a, b) => b.volume - a.volume
    )[0].lote;
    vasilhameRecords.push({
      codigo: SEED_CODIGO,
      origem: 'transbordo',
      transbordo_id: seedOp.id,
      numero_op: SEED_CODIGO,
      placa,
      barril,
      tipo: 'Vasilhame',
      produto_id: produto.id,
      produto_nome: produtoNome,
      produto_codigo: produtoCodigo,
      cliente_id: cliente.id,
      cliente_nome: cliente.nome || 'VIBRA ENERGIA',
      lote: dominant,
      densidade: densStr,
      volume: vol,
      tara: 0,
      peso_liquido: massa,
      peso_bruto: massa,
      status: 'No Pátio',
      data_saida: null,
      responsavel: 'Inventário',
      fracionado: true,
      composicao: FRACIONADO.partes.map((p) => ({
        lote: p.lote,
        quantidade_l: p.volume,
        quantidade_kg: p.massa,
        transbordo_codigo: SEED_CODIGO,
        data: TODAY,
      })),
    });
  }

  // TANKA 46
  vasilhameRecords.push({
    codigo: SEED_CODIGO,
    origem: 'transbordo',
    transbordo_id: seedOp.id,
    numero_op: SEED_CODIGO,
    placa: iso46.tanka,
    barril: '',
    tipo: 'Tankagem',
    produto_id: produto.id,
    produto_nome: produtoNome,
    produto_codigo: produtoCodigo,
    cliente_id: cliente.id,
    cliente_nome: cliente.nome || 'VIBRA ENERGIA',
    lote: TANKA.lote,
    densidade: densStr,
    volume: TANKA.volume,
    tara: 0,
    peso_liquido: TANKA.massa,
    peso_bruto: TANKA.massa,
    status: 'No Pátio',
    data_saida: null,
    responsavel: 'Inventário',
    fracionado: false,
    composicao: [
      {
        lote: TANKA.lote,
        quantidade_l: TANKA.volume,
        quantidade_kg: TANKA.massa,
        transbordo_codigo: SEED_CODIGO,
        data: TODAY,
      },
    ],
  });

  // Expede vasilhames antigos no pátio com mesmas placas deste inventário
  const placasSeed = new Set(
    vasilhameRecords.map((v) => `${norm(v.placa)}||${String(v.barril || '')}`)
  );
  const { data: vasExist } = await sb.from('vasilhames').select('*');
  for (const v of vasExist || []) {
    if ((v.status || 'No Pátio') !== 'No Pátio') continue;
    const key = `${norm(v.placa)}||${String(v.barril || '')}`;
    if (!placasSeed.has(key)) continue;
    if (v.transbordo_id === seedOp.id) continue;
    await sb
      .from('vasilhames')
      .update({
        volume: 0,
        peso_liquido: 0,
        peso_bruto: 0,
        status: 'Expedido',
        data_saida: TODAY,
        composicao: [],
      })
      .eq('id', v.id);
  }

  const { data: createdVas, error: eVas } = await sb
    .from('vasilhames')
    .insert(vasilhameRecords)
    .select();
  if (eVas) throw new Error(`Insert vasilhames: ${eVas.message}`);
  console.log('Vasilhames criados:', (createdVas || []).length);

  await sb
    .from('isotanques')
    .update({
      produto_id: produto.id,
      produto_nome: produtoNome,
      cliente_id: cliente.id,
      cliente_nome: cliente.nome || 'VIBRA ENERGIA',
    })
    .eq('id', iso46.id);

  console.log('\nResumo:');
  console.log('  Entrada:', ENTRADA_CODIGO, entrada.id);
  console.log(
    '  Estoque lotes:',
    [...estoqueByLote.keys()].join(', ')
  );
  console.log('  OP:', SEED_CODIGO, seedOp.id);
  console.log(
    '  Embalagens: 11 vasilhames + 1 fracionado (13567-0) + TANKA 46'
  );
  console.log('Concluído.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
