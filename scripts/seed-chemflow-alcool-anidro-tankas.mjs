/**
 * Insere inventário de ALCOOL ANIDRO (1003687) — VIBRA ENERGIA
 * nas TANKA 14, 15 e 16 (telas Tankagem + Vasilhames), com composição por lote.
 *
 * Uso:
 *   node scripts/seed-chemflow-alcool-anidro-tankas.mjs
 *   node scripts/seed-chemflow-alcool-anidro-tankas.mjs --dry-run
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const SEED_CODIGO = 'T-INV-ALCOOL-ANIDRO';
const DENSIDADE = 0.7907;
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

/** Volumes em L (pt-BR: ponto = milhar, vírgula = decimal). */
const TANK_LOTS = {
  'TANKA 16': [
    { volume: 10000, lote: '50002836990' },
    { volume: 147, lote: '50002905311' },
    { volume: 2000, lote: '50002920839' },
    { volume: 29, lote: '50002964017' },
    { volume: 147, lote: '50002968780' },
    { volume: 2665, lote: '50002676772' },
  ],
  'TANKA 15': [
    { volume: 2665, lote: '50002984668' },
    { volume: 16320, lote: '50002676772' },
  ],
  'TANKA 14': [{ volume: 25800, lote: '50002676772' }],
};

function buildComposicao(lots) {
  return lots.map((l) => {
    const qL = roundVolume(l.volume);
    return {
      lote: l.lote,
      quantidade_l: qL,
      quantidade_kg: roundMass(qL * DENSIDADE),
      transbordo_codigo: SEED_CODIGO,
      data: TODAY,
    };
  });
}

function dominantLote(lots) {
  return [...lots].sort((a, b) => b.volume - a.volume)[0]?.lote || '';
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
      'Configure VITE_CHEMFLOW_SUPABASE_URL/ANON_KEY (ou VITE_SUPABASE_*) no .env'
    );
    process.exit(1);
  }

  const sb = createClient(url, key);
  console.log(DRY_RUN ? '[DRY-RUN] sem writes' : '[APPLY] gravando no banco');

  const { data: produtos, error: eProd } = await sb.from('produtos').select('*');
  if (eProd) throw new Error(eProd.message);
  const produto =
    (produtos || []).find((p) => String(p.codigo || '').trim() === '1003687') ||
    (produtos || []).find((p) =>
      norm(p.produto || p.nome).includes('ALCOOL ANIDRO')
    );
  if (!produto) throw new Error('Produto 1003687 ALCOOL ANIDRO não encontrado');

  const produtoNome = produto.produto || produto.nome || 'ALCOOL ANIDRO';
  const produtoCodigo = produto.codigo || '1003687';

  const { data: clientes, error: eCli } = await sb.from('clientes').select('*');
  if (eCli) throw new Error(eCli.message);
  const cliente =
    (clientes || []).find((c) => norm(c.nome) === 'VIBRA ENERGIA') ||
    (clientes || []).find((c) => norm(c.nome).includes('VIBRA'));
  if (!cliente) throw new Error('Cliente VIBRA ENERGIA não encontrado');

  const { data: isotanques, error: eIso } = await sb.from('isotanques').select('*');
  if (eIso) throw new Error(eIso.message);

  const tankNames = Object.keys(TANK_LOTS);
  const isos = tankNames.map((name) => {
    const iso = (isotanques || []).find((i) => norm(i.tanka) === norm(name));
    if (!iso) throw new Error(`Isotanque ${name} não encontrado`);
    return iso;
  });

  const { data: transbordos, error: eTrans } = await sb
    .from('transbordos')
    .select('*');
  if (eTrans) throw new Error(eTrans.message);

  const { data: vasilhames, error: eVas } = await sb.from('vasilhames').select('*');
  if (eVas) throw new Error(eVas.message);

  let seedOp = (transbordos || []).find(
    (t) => t.codigo_transbordo === SEED_CODIGO
  );

  const dens = Number(String(produto.densidade || DENSIDADE).replace(',', '.')) || DENSIDADE;
  const densStr = String(produto.densidade || DENSIDADE);

  // Destinos do OP de inventário = volumes alvo absolutos
  const destinos = isos.map((iso, idx) => {
    const lots = TANK_LOTS[iso.tanka];
    const volume = roundVolume(lots.reduce((s, l) => s + l.volume, 0));
    const peso = roundMass(volume * dens);
    return {
      tipo_embalagem: 'Tankagem',
      tanka_id: iso.id,
      tanka_codigo: iso.tanka,
      volume,
      volume_total: volume,
      peso_liquido: peso,
      peso_bruto: peso,
      tara: 0,
      quantidade_embalagens: 0,
      volume_por_embalagem: 0,
      fracionado: lots.length > 1,
      destino_index: idx,
    };
  });

  // Compensa saldos de outros OPs: origens retiram o excedente fora deste seed
  const origensAjuste = [];
  for (const iso of isos) {
    const saldoOutros = computeTankaSaldo(iso, transbordos || [], seedOp?.id || null);
    if (saldoOutros > 0) {
      origensAjuste.push({
        tipo_origem: 'tanka',
        entrada_id: iso.id,
        entrada_codigo: iso.tanka,
        tanka_codigo: iso.tanka,
        lote: `AJUSTE-INV-${iso.tanka}`,
        volume_retirado: saldoOutros,
        massa_retirada: roundMass(saldoOutros * dens),
        saldo_restante: 0,
        saldo_disponivel: saldoOutros,
      });
    }
  }

  // Origem sintética cobrindo o volume envasado (inventário inicial)
  const volumeTotal = destinos.reduce((s, d) => s + d.volume_total, 0);
  const massaTotal = roundMass(volumeTotal * dens);
  const origens = [
    {
      tipo_origem: 'entrada',
      entrada_id: null,
      entrada_codigo: `INVENTARIO — ${SEED_CODIGO}`,
      lote: 'INVENTARIO-ALCOOL-ANIDRO',
      volume_retirado: volumeTotal,
      massa_retirada: massaTotal,
      saldo_restante: 0,
      saldo_disponivel: volumeTotal,
    },
    ...origensAjuste,
  ];

  const payload = {
    codigo_transbordo: SEED_CODIGO,
    data: TODAY,
    cliente_id: cliente.id,
    cliente_nome: cliente.nome || 'VIBRA ENERGIA',
    produto_id: produto.id,
    produto_nome: produtoNome,
    produto_codigo: produtoCodigo,
    densidade: densStr,
    volume_total: volumeTotal,
    massa_total: massaTotal,
    operadores: ['Inventário'],
    observacoes:
      'Inventário inicial ALCOOL ANIDRO — TANKA 14/15/16 (composição por lote).',
    origens,
    destinos,
  };

  console.log('\nProduto:', produtoCodigo, produtoNome, '| dens', densStr);
  console.log('Cliente:', cliente.nome);
  console.log(
    'Volumes alvo:',
    isos
      .map((iso) => {
        const vol = TANK_LOTS[iso.tanka].reduce((s, l) => s + l.volume, 0);
        return `${iso.tanka}=${vol}L`;
      })
      .join(' | ')
  );
  console.log(
    'Ajustes de saldo prévio:',
    origensAjuste.length
      ? origensAjuste.map((o) => `${o.tanka_codigo}:${o.volume_retirado}L`).join(', ')
      : '(nenhum)'
  );

  if (!DRY_RUN) {
    if (seedOp?.id) {
      const { data, error } = await sb
        .from('transbordos')
        .update(payload)
        .eq('id', seedOp.id)
        .select()
        .single();
      if (error) throw new Error(`Update transbordo: ${error.message}`);
      seedOp = data;
      console.log('OP atualizado:', seedOp.codigo_transbordo, seedOp.id);
    } else {
      const { data, error } = await sb
        .from('transbordos')
        .insert(payload)
        .select()
        .single();
      if (error) throw new Error(`Insert transbordo: ${error.message}`);
      seedOp = data;
      console.log('OP criado:', seedOp.codigo_transbordo, seedOp.id);
    }
  } else {
    console.log('OP (dry):', SEED_CODIGO, seedOp?.id ? 'update' : 'create');
  }

  // Upsert vasilhames tipo Tankagem — 1 por tanka, com composição completa
  for (let i = 0; i < isos.length; i++) {
    const iso = isos[i];
    const lots = TANK_LOTS[iso.tanka];
    const composicao = buildComposicao(lots).map((c) => ({
      ...c,
      quantidade_kg: roundMass(c.quantidade_l * dens),
    }));
    const volume = roundVolume(lots.reduce((s, l) => s + l.volume, 0));
    const peso = roundMass(volume * dens);
    const lote = dominantLote(lots);

    const record = {
      codigo: SEED_CODIGO,
      origem: 'transbordo',
      transbordo_id: seedOp?.id || null,
      numero_op: SEED_CODIGO,
      placa: iso.tanka,
      barril: '',
      tipo: 'Tankagem',
      produto_id: produto.id,
      produto_nome: produtoNome,
      produto_codigo: produtoCodigo,
      cliente_id: cliente.id,
      cliente_nome: cliente.nome || 'VIBRA ENERGIA',
      lote,
      densidade: densStr,
      volume,
      tara: 0,
      peso_liquido: peso,
      peso_bruto: peso,
      status: 'No Pátio',
      data_saida: null,
      responsavel: 'Inventário',
      fracionado: lots.length > 1,
      composicao,
      destino_index: i,
    };

    const existing = (vasilhames || []).filter(
      (v) =>
        v.tipo === 'Tankagem' &&
        norm(v.placa) === norm(iso.tanka) &&
        (v.status || 'No Pátio') === 'No Pátio'
    );

    console.log(
      `\n${iso.tanka}: ${volume} L | lote dominante ${lote} | ${composicao.length} lote(s)`
    );
    composicao.forEach((c) =>
      console.log(`  - ${c.lote}: ${c.quantidade_l} L / ${c.quantidade_kg} kg`)
    );

    if (DRY_RUN) {
      console.log(
        existing.length
          ? `  → atualizaria ${existing.length} vasilhame(s)`
          : '  → criaria 1 vasilhame'
      );
      continue;
    }

    if (existing.length > 0) {
      const primary = existing[0];
      const { error } = await sb
        .from('vasilhames')
        .update(record)
        .eq('id', primary.id);
      if (error) throw new Error(`Update vasilhame ${iso.tanka}: ${error.message}`);
      console.log('  → atualizado', primary.id);

      // Expede duplicatas no pátio da mesma tanka
      for (const dup of existing.slice(1)) {
        const { error: eDup } = await sb
          .from('vasilhames')
          .update({
            volume: 0,
            peso_liquido: 0,
            peso_bruto: 0,
            status: 'Expedido',
            data_saida: TODAY,
            composicao: [],
          })
          .eq('id', dup.id);
        if (eDup) throw new Error(`Expedir dup ${dup.id}: ${eDup.message}`);
        console.log('  → duplicata expedida', dup.id);
      }
    } else {
      const { data, error } = await sb
        .from('vasilhames')
        .insert(record)
        .select()
        .single();
      if (error) throw new Error(`Insert vasilhame ${iso.tanka}: ${error.message}`);
      console.log('  → criado', data.id);
    }

    // Garante produto/cliente no cadastro do isotanque
    const { error: eUpIso } = await sb
      .from('isotanques')
      .update({
        produto_id: produto.id,
        produto_nome: produtoNome,
        cliente_id: cliente.id,
        cliente_nome: cliente.nome || 'VIBRA ENERGIA',
      })
      .eq('id', iso.id);
    if (eUpIso) {
      console.warn(`  ⚠ isotanque ${iso.tanka}: ${eUpIso.message}`);
    }
  }

  console.log('\nConcluído.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
