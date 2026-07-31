/**
 * Inventário PROSOLV (VEOLIA) por tanka + composição de lotes
 * (telas Tankagem + Vasilhames), a partir das planilhas de estoque.
 *
 * Volumes: notação pt-BR (1.500 = 1500 L).
 *
 * Uso:
 *   node scripts/seed-chemflow-prosolv-tankas-inventario.mjs
 *   node scripts/seed-chemflow-prosolv-tankas-inventario.mjs --dry-run
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

function dominantLote(lots) {
  return [...lots].sort((a, b) => b.volume - a.volume)[0]?.lote || '';
}

/**
 * Inventário por produto. Aliases resolvem o cadastro de produtos.
 * Volumes já convertidos (pt-BR → inteiro L).
 *
 * TANKA 07: planilha mostra TOTAL 26.338 L, mas só o lote 3720858 (18.225 L)
 * está legível — usamos o lote visível.
 */
const INVENTARIOS = [
  {
    seedCodigo: 'T-INV-PROSOLV-HS8785',
    produtoAliases: ['PROSOLV HS 8785', 'PROSOLV HS8785'],
    produtoCodigoPreferido: '24051603',
    tankas: {
      'TANKA 05': [
        { lote: '3719196', volume: 2205 },
        { lote: '3719006', volume: 18378 },
        { lote: '3719195', volume: 5217 },
      ],
      'TANKA 06': [{ lote: '3719195', volume: 20800 }],
      'TANKA 07': [{ lote: '3720858', volume: 18225 }],
      'TANKA 09': [{ lote: '3720855', volume: 25800 }],
      'TANKA 13': [
        { lote: '3699465', volume: 17700 },
        { lote: '3699252', volume: 7913 },
      ],
      'TANKA 22': [{ lote: '3699266', volume: 25800 }],
      'TANKA 23': [
        { lote: '3699465', volume: 16935 },
        { lote: '3699266', volume: 8530 },
      ],
      'TANKA 24': [{ lote: '3699252', volume: 25800 }],
      'TANKA 27': [{ lote: '3692596', volume: 25800 }],
      'TANKA 29': [
        { lote: '3693182', volume: 14035 },
        { lote: '3692599', volume: 11800 },
      ],
      'TANKA 30': [{ lote: '3692599', volume: 20122 }],
    },
  },
  {
    seedCodigo: 'T-INV-PROSOLV-WCI8062',
    produtoAliases: ['PROSOLV WCI 8062', 'PROSOLV WEI 8062', 'PROSOLV WCI8062'],
    produtoCodigoPreferido: '5025576',
    tankas: {
      'TANKA 10': [{ lote: '3707481', volume: 1118 }],
    },
  },
  {
    seedCodigo: 'T-INV-PROSOLV-SI9081',
    produtoAliases: ['PROSOLV SI 9081', 'PROSOLV SI9081'],
    produtoCodigoPreferido: '5033326',
    tankas: {
      'TANKA 25': [
        { lote: '3708887', volume: 1172 },
        { lote: '3717339', volume: 1705 },
        { lote: '3719599', volume: 1598 },
      ],
    },
  },
  {
    seedCodigo: 'T-INV-PROSOLV-SI9039',
    produtoAliases: ['PROSOLV SI 9039', 'PROSOLV SI9039'],
    produtoCodigoPreferido: '5032495',
    tankas: {
      'TANKA 26': [
        { lote: '3715665', volume: 5349 },
        { lote: '3718536', volume: 1333 },
        { lote: '3719023', volume: 1341 },
        { lote: '3720863', volume: 317 },
      ],
    },
  },
  {
    seedCodigo: 'T-INV-PROSOLV-SI9214',
    produtoAliases: [
      'PROSOLV SI9214 DW',
      'PROSOLV SI 9214 DW',
      'PROSOLV SI9214',
      'PROSOLV SI 9214',
    ],
    produtoCodigoPreferido: '6014900',
    tankas: {
      'TANKA 28': [
        { lote: '3714555', volume: 4294 },
        { lote: '3720426', volume: 11250 },
      ],
    },
  },
];

function findProduto(produtos, inv) {
  if (inv.produtoCodigoPreferido) {
    const byCode = (produtos || []).find(
      (p) => String(p.codigo || '').trim() === inv.produtoCodigoPreferido
    );
    if (byCode) return byCode;
  }
  for (const alias of inv.produtoAliases) {
    const hit = (produtos || []).find((p) => norm(p.produto) === norm(alias));
    if (hit) return hit;
  }
  for (const alias of inv.produtoAliases) {
    const hit = (produtos || []).find((p) => norm(p.produto).includes(norm(alias)));
    if (hit) return hit;
  }
  return null;
}

async function upsertInventario(sb, inv, ctx) {
  const { produtos, clientes, isotanques, transbordos, vasilhames } = ctx;
  const produto = findProduto(produtos, inv);
  if (!produto) {
    throw new Error(`Produto não encontrado: ${inv.produtoAliases.join(' / ')}`);
  }

  const cliente =
    (clientes || []).find((c) => c.id === produto.cliente_id) ||
    (clientes || []).find((c) => norm(c.nome) === 'VEOLIA') ||
    (clientes || []).find((c) => norm(c.nome).includes('VEOLIA'));
  if (!cliente) throw new Error('Cliente VEOLIA não encontrado');

  const tankNames = Object.keys(inv.tankas);
  const isos = tankNames.map((name) => {
    const iso = (isotanques || []).find((i) => norm(i.tanka) === norm(name));
    if (!iso) throw new Error(`Isotanque ${name} não encontrado`);
    return iso;
  });

  let seedOp = (transbordos || []).find(
    (t) => t.codigo_transbordo === inv.seedCodigo
  );

  const dens =
    Number(String(produto.densidade || '1').replace(',', '.')) || 1;
  const densStr = String(produto.densidade || dens);
  const produtoNome = produto.produto;
  const produtoCodigo = produto.codigo || inv.produtoCodigoPreferido || '';

  const destinos = isos.map((iso, idx) => {
    const lots = inv.tankas[iso.tanka];
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

  const origensAjuste = [];
  for (const iso of isos) {
    const saldoOutros = computeTankaSaldo(
      iso,
      transbordos || [],
      seedOp?.id || null
    );
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

  const volumeTotal = destinos.reduce((s, d) => s + d.volume_total, 0);
  const massaTotal = roundMass(volumeTotal * dens);
  const origens = [
    {
      tipo_origem: 'entrada',
      entrada_id: null,
      entrada_codigo: `INVENTARIO — ${inv.seedCodigo}`,
      lote: `INVENTARIO-${inv.seedCodigo}`,
      volume_retirado: volumeTotal,
      massa_retirada: massaTotal,
      saldo_restante: 0,
      saldo_disponivel: volumeTotal,
    },
    ...origensAjuste,
  ];

  const payload = {
    codigo_transbordo: inv.seedCodigo,
    data: TODAY,
    cliente_id: cliente.id,
    cliente_nome: cliente.nome || 'VEOLIA',
    produto_id: produto.id,
    produto_nome: produtoNome,
    produto_codigo: produtoCodigo,
    densidade: densStr,
    volume_total: volumeTotal,
    massa_total: massaTotal,
    operadores: ['Inventário'],
    observacoes: `Inventário inicial ${produtoNome} — ${tankNames.join(', ')} (composição por lote).`,
    origens,
    destinos,
  };

  console.log(`\n======== ${inv.seedCodigo} ========`);
  console.log('Produto:', produtoCodigo, produtoNome, '| dens', densStr);
  console.log('Cliente:', cliente.nome);
  console.log(
    'Volumes alvo:',
    isos
      .map((iso) => {
        const vol = inv.tankas[iso.tanka].reduce((s, l) => s + l.volume, 0);
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
      // mantém cache local para próximos grupos
      (transbordos || []).push(data);
    }
  } else {
    console.log('OP (dry):', inv.seedCodigo, seedOp?.id ? 'update' : 'create');
  }

  for (let i = 0; i < isos.length; i++) {
    const iso = isos[i];
    const lots = inv.tankas[iso.tanka];
    const composicao = lots.map((l) => {
      const qL = roundVolume(l.volume);
      return {
        lote: l.lote,
        quantidade_l: qL,
        quantidade_kg: roundMass(qL * dens),
        transbordo_codigo: inv.seedCodigo,
        data: TODAY,
      };
    });
    const volume = roundVolume(lots.reduce((s, l) => s + l.volume, 0));
    const peso = roundMass(volume * dens);
    const lote = dominantLote(lots);

    const record = {
      codigo: inv.seedCodigo,
      origem: 'transbordo',
      transbordo_id: seedOp?.id || null,
      numero_op: inv.seedCodigo,
      placa: iso.tanka,
      barril: '',
      tipo: 'Tankagem',
      produto_id: produto.id,
      produto_nome: produtoNome,
      produto_codigo: produtoCodigo,
      cliente_id: cliente.id,
      cliente_nome: cliente.nome || 'VEOLIA',
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
      if (error) {
        throw new Error(`Update vasilhame ${iso.tanka}: ${error.message}`);
      }
      console.log('  → atualizado', primary.id);

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
      if (error) {
        throw new Error(`Insert vasilhame ${iso.tanka}: ${error.message}`);
      }
      console.log('  → criado', data.id);
      (vasilhames || []).push(data);
    }

    const { error: eUpIso } = await sb
      .from('isotanques')
      .update({
        produto_id: produto.id,
        produto_nome: produtoNome,
        cliente_id: cliente.id,
        cliente_nome: cliente.nome || 'VEOLIA',
      })
      .eq('id', iso.id);
    if (eUpIso) {
      console.warn(`  ⚠ isotanque ${iso.tanka}: ${eUpIso.message}`);
    }
  }
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

  const { data: clientes, error: eCli } = await sb.from('clientes').select('*');
  if (eCli) throw new Error(eCli.message);

  const { data: isotanques, error: eIso } = await sb.from('isotanques').select('*');
  if (eIso) throw new Error(eIso.message);

  const { data: transbordos, error: eTrans } = await sb
    .from('transbordos')
    .select('*');
  if (eTrans) throw new Error(eTrans.message);

  const { data: vasilhames, error: eVas } = await sb.from('vasilhames').select('*');
  if (eVas) throw new Error(eVas.message);

  const ctx = {
    produtos: produtos || [],
    clientes: clientes || [],
    isotanques: isotanques || [],
    transbordos: transbordos || [],
    vasilhames: vasilhames || [],
  };

  const lista = ONLY
    ? INVENTARIOS.filter(
        (inv) =>
          inv.seedCodigo.toUpperCase().includes(ONLY) ||
          inv.produtoAliases.some((a) => norm(a).includes(norm(ONLY)))
      )
    : INVENTARIOS;
  if (ONLY && !lista.length) {
    throw new Error(`Nenhum inventário corresponde a --only=${ONLY}`);
  }

  for (const inv of lista) {
    await upsertInventario(sb, inv, ctx);
  }

  console.log('\nConcluído.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
