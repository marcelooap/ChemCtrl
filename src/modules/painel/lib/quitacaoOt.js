/**
 * Quitação OT — consolidação de transbordos e produções finalizadas.
 * Preferência: RPC painel_quitacao_ot_list. Fallback: merge client-side das 3 fontes.
 */

import {
  chemflowSupabase,
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';
import { DEFAULT_PAGE_SIZE, clampPageSize } from '@shared/lib/pagination';
import { resolveTransbordoVolumeLitros } from '@transbordo/lib/transbordoViewData';

export const ORIGEM_FLUXO = Object.freeze({
  TRANSBORDO: 'transbordo',
  PRODUCAO: 'producao',
  TRANSBORDO_IND: 'transbordo_ind',
});

/** Tipo de operação exibido na coluna Operação. */
export const OPERACAO = Object.freeze({
  INDUSTRIALIZACAO: 'industrializacao',
  FILTRACAO: 'filtracao',
  CONVENCIONAL: 'convencional',
});

export const OPERACAO_LABEL_KEY = Object.freeze({
  [OPERACAO.INDUSTRIALIZACAO]: 'painel.operacional.quitacaoOt.operacao.industrializacao',
  [OPERACAO.FILTRACAO]: 'painel.operacional.quitacaoOt.operacao.filtracao',
  [OPERACAO.CONVENCIONAL]: 'painel.operacional.quitacaoOt.operacao.convencional',
});

/** Estilo visual do badge da coluna Operação. */
export const OPERACAO_BADGE_CLASS = Object.freeze({
  [OPERACAO.INDUSTRIALIZACAO]: 'bg-sky-50 text-sky-700 border-sky-200',
  [OPERACAO.FILTRACAO]: 'bg-violet-50 text-violet-700 border-violet-200',
  [OPERACAO.CONVENCIONAL]: 'bg-orange-50 text-orange-700 border-orange-200',
});

const NA = '—';

function origemTipoKey(origem) {
  return asText(origem?.tipo_origem || origem?.tipo).toLowerCase();
}

function hasOrigemGranel(origens) {
  const list = parseArr(origens);
  if (list.length === 0) return false;
  return list.some((o) => {
    const tipo = origemTipoKey(o);
    return !tipo || tipo === 'entrada' || tipo === 'granel';
  });
}

function hasOrigemTanka(origens) {
  return parseArr(origens).some((o) => origemTipoKey(o) === 'tanka');
}

/**
 * Classifica a operação para a coluna Operação:
 * - Produções Ind → Industrialização
 * - Transbordo ChemFlow com produto filtrado + origem tanka → Filtração
 * - Origem granel e demais transbordos → Convencional
 */
export function resolveOperacao(row) {
  const fluxo = asText(row?.origem_fluxo);
  if (fluxo === ORIGEM_FLUXO.PRODUCAO) return OPERACAO.INDUSTRIALIZACAO;
  // Transbordos do módulo Ind seguem como demais transbordos → Convencional
  if (fluxo === ORIGEM_FLUXO.TRANSBORDO_IND) return OPERACAO.CONVENCIONAL;

  if (fluxo === ORIGEM_FLUXO.TRANSBORDO) {
    const origens = row?.origens ?? row?.origins;
    if (hasOrigemGranel(origens)) return OPERACAO.CONVENCIONAL;
    if (Boolean(row?.produto_filtrado) && hasOrigemTanka(origens)) {
      return OPERACAO.FILTRACAO;
    }
    return OPERACAO.CONVENCIONAL;
  }

  return OPERACAO.CONVENCIONAL;
}

function assertConfigured(context) {
  if (!isChemFlowConfigured || !chemflowSupabase) {
    throw new Error(`[QuitacaoOT:${context}] ${CHEMFLOW_CONFIG_ERROR}`);
  }
}

function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asText(v) {
  const s = v == null ? '' : String(v).trim();
  return s;
}

/** Volume arredondado só para exibição nesta tela (ex.: 5.000 L). */
export function formatVolumeQuitacao(value, language = 'pt-BR') {
  const n = Number(value);
  if (!Number.isFinite(n)) return NA;
  const rounded = Math.round(n);
  const formatted = rounded.toLocaleString(language === 'en' ? 'en-US' : 'pt-BR', {
    maximumFractionDigits: 0,
  });
  return `${formatted} L`;
}

/**
 * Volume exibível na Quitação OT.
 * OP com complemento pendente → volume_apontado (já refletindo as MPs aplicadas).
 */
function sumJsonVolumes(items, keys) {
  let sum = 0;
  let has = false;
  for (const item of parseArr(items)) {
    for (const key of keys) {
      const q = Number(item?.[key]);
      if (Number.isFinite(q) && q > 0) {
        sum += q;
        has = true;
        break;
      }
    }
  }
  return has ? sum : 0;
}

export function resolveVolumeQuitacao(raw) {
  const origem = asText(raw?.origem_fluxo);
  if (origem === ORIGEM_FLUXO.PRODUCAO) {
    const pending =
      Boolean(raw?.fractional_supply) &&
      asText(raw?.complement_status) === 'Pendente' &&
      (Number(raw?.volume_pendente) || 0) > 0.001;
    const apontado = Number(raw?.volume_apontado);
    if (pending && Number.isFinite(apontado) && apontado > 0) {
      return apontado;
    }
    // Fallback: soma qty operacional das MPs quando volume_apontado não veio.
    if (pending) {
      const mps = parseArr(raw?.raw_materials_used);
      let sum = 0;
      let hasQty = false;
      for (const mp of mps) {
        const lots = parseArr(mp?.lots);
        if (lots.length > 0) {
          for (const lot of lots) {
            const q = Number(lot?.qty_operational_raw ?? lot?.qty_operational ?? lot?.qty_fiscal);
            if (Number.isFinite(q)) {
              sum += q;
              hasQty = true;
            }
          }
        } else {
          const q = Number(mp?.qty_operational ?? mp?.qty_fiscal ?? mp?.quantity);
          if (Number.isFinite(q)) {
            sum += q;
            hasQty = true;
          }
        }
      }
      if (hasQty && sum > 0) return sum;
    }
  }

  // ChemFlow: volume_* embalado em kg/lb → litros (igual ao modal de visualização).
  if (origem === ORIGEM_FLUXO.TRANSBORDO) {
    return resolveTransbordoVolumeLitros({
      volume_total: raw?.volume_total ?? raw?.volume,
      volume: raw?.volume,
      massa_total: raw?.massa_total,
      densidade: raw?.densidade,
      origens: raw?.origens ?? raw?.origins,
    });
  }

  // Transbordo Ind (ex.: Expedição): header.volume pode ficar 0 — soma destinos/origens.
  if (origem === ORIGEM_FLUXO.TRANSBORDO_IND) {
    const header = Number(raw?.volume) || 0;
    if (header > 0) return header;
    const destinos = raw?.destinos ?? raw?.destinations;
    const fromDest = sumJsonVolumes(destinos, ['volume', 'volume_total']);
    if (fromDest > 0) return fromDest;
    const origens = raw?.origens ?? raw?.origins;
    const fromOrig = sumJsonVolumes(origens, ['volume_used', 'volume']);
    if (fromOrig > 0) return fromOrig;
    return 0;
  }

  return Number(raw?.volume) || 0;
}

export function formatProdutoLabel(codigo, nome) {
  const code = asText(codigo);
  const name = asText(nome);
  if (code && name) return `${code} - ${name}`;
  if (name) return name;
  if (code) return code;
  return NA;
}

export function formatOperadores(operadores) {
  const list = parseArr(operadores)
    .map((op) => asText(typeof op === 'string' ? op : op?.nome || op?.name))
    .filter(Boolean);
  if (list.length === 0) return NA;
  return list.join(', ');
}

function uniqueLabels(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values || []) {
    const v = asText(raw);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function labelOrigemTransbordo(origem) {
  const tipo = asText(origem?.tipo_origem || origem?.tipo).toLowerCase();
  if (tipo === 'tanka') return 'Tanka';
  // Contentor: tipo genérico, sem número de placa/barril.
  if (tipo === 'vasilhame') return 'Contentor';
  if (tipo === 'embalado' || origem?.embalado) {
    return (
      asText(origem?.tipo_embalagem) ||
      asText(origem?.packaging_type) ||
      'Embalado'
    );
  }
  if (tipo === 'entrada' || tipo === 'granel' || !tipo) return 'Granel';
  return asText(origem?.tipo_origem) || NA;
}

function labelDestinoTransbordo(destino) {
  const tipo = asText(destino?.tipo_embalagem);
  if (tipo === 'Tankagem') return 'Tanque';
  // Contentor (vasilhame de pátio): não listar placas/números.
  if (tipo === 'Vasilhame' || (!tipo && asText(destino?.placa))) {
    return 'Contentor';
  }
  if (!tipo) {
    return asText(destino?.tanka_codigo) || NA;
  }
  return tipo;
}

function labelOrigemInd(_origem) {
  // Origens do TB industrializado são sempre contentores de pátio.
  return 'Contentor';
}

function labelDestinoInd(destino) {
  const packaging = asText(destino?.packaging_type);
  // Embalagens unitárias (IBC/bombona/tambor) mantêm o tipo cadastrado.
  if (packaging && !/^vasilhame$/i.test(packaging)) return packaging;
  const tipo = asText(destino?.type);
  if (tipo === 'Expedição') return 'Expedição';
  // Destino Transbordo / placa de contentor → rótulo genérico.
  if (tipo === 'Transbordo' || asText(destino?.placa) || packaging) {
    return 'Contentor';
  }
  return tipo || NA;
}

/**
 * Monta DE → PARA a partir dos campos reais do registro.
 * Não inventa valores; retorna — quando não houver informação.
 */
export function resolveDePara(row) {
  const origem = asText(row?.origem_fluxo);
  if (origem === ORIGEM_FLUXO.TRANSBORDO) {
    const origens = parseArr(row?.origens);
    const destinos = parseArr(row?.destinos);
    const de = uniqueLabels(origens.map(labelOrigemTransbordo));
    const para = uniqueLabels(destinos.map(labelDestinoTransbordo));
    if (de.length === 0 && para.length === 0) {
      return { de: NA, para: NA, label: NA };
    }
    return {
      de: de.length ? de.join(', ') : NA,
      para: para.length ? para.join(', ') : NA,
      label: `${de.length ? de.join(', ') : NA} → ${para.length ? para.join(', ') : NA}`,
    };
  }

  if (origem === ORIGEM_FLUXO.TRANSBORDO_IND) {
    const origens = parseArr(row?.origens);
    const destinos = parseArr(row?.destinos);
    const isExpedicao = destinos.some(
      (d) => asText(d?.type).toLowerCase() === 'expedição' || asText(d?.type).toLowerCase() === 'expedicao'
    );
    // Expedição Ind: rótulo fixo TANKA → CARRETA.
    if (isExpedicao) {
      return { de: 'TANKA', para: 'CARRETA', label: 'TANKA → CARRETA' };
    }
    const de = uniqueLabels(origens.map(labelOrigemInd));
    const para = uniqueLabels(destinos.map(labelDestinoInd));
    if (de.length === 0 && para.length === 0) {
      return { de: NA, para: NA, label: NA };
    }
    return {
      de: de.length ? de.join(', ') : NA,
      para: para.length ? para.join(', ') : NA,
      label: `${de.length ? de.join(', ') : NA} → ${para.length ? para.join(', ') : NA}`,
    };
  }

  if (origem === ORIGEM_FLUXO.PRODUCAO) {
    const mps = parseArr(row?.raw_materials_used);
    const de = mps.length > 0 ? 'Matéria-prima' : '';
    // Envase da OP vai para contentor — não exibir placa/número do tanque.
    const hasDestino =
      mps.length > 0 ||
      Boolean(asText(row?.packaging_info)) ||
      Boolean(asText(row?.packaging_type));
    const para = hasDestino ? 'Contentor' : '';
    if (!de && !para) return { de: NA, para: NA, label: NA };
    return {
      de: de || NA,
      para: para || NA,
      label: `${de || NA} → ${para || NA}`,
    };
  }

  return { de: NA, para: NA, label: NA };
}

export function badgeMetaForOrigem(origemFluxo) {
  switch (origemFluxo) {
    case ORIGEM_FLUXO.TRANSBORDO:
      return {
        key: ORIGEM_FLUXO.TRANSBORDO,
        labelKey: 'painel.operacional.quitacaoOt.badges.transbordo',
        className: 'bg-sky-50 text-sky-700 border-sky-200',
      };
    case ORIGEM_FLUXO.PRODUCAO:
      return {
        key: ORIGEM_FLUXO.PRODUCAO,
        labelKey: 'painel.operacional.quitacaoOt.badges.producao',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    case ORIGEM_FLUXO.TRANSBORDO_IND:
      return {
        key: ORIGEM_FLUXO.TRANSBORDO_IND,
        labelKey: 'painel.operacional.quitacaoOt.badges.transbordoInd',
        className: 'bg-violet-50 text-violet-700 border-violet-200',
      };
    default:
      return {
        key: 'unknown',
        labelKey: 'painel.operacional.quitacaoOt.badges.unknown',
        className: 'bg-muted text-muted-foreground border-border',
      };
  }
}

function normalizeRow(raw) {
  const origem_fluxo = asText(raw?.origem_fluxo);
  const operadores = parseArr(raw?.operadores);
  const origens = parseArr(raw?.origens ?? raw?.origins);
  const destinos = parseArr(raw?.destinos ?? raw?.destinations);
  const dePara = resolveDePara({
    ...raw,
    origem_fluxo,
    origens,
    destinos,
  });
  const volume = resolveVolumeQuitacao({ ...raw, origem_fluxo });
  const produto_filtrado = Boolean(raw?.produto_filtrado ?? raw?.filtrado);
  const operacao = resolveOperacao({
    ...raw,
    origem_fluxo,
    origens,
    produto_filtrado,
  });
  return {
    origem_fluxo,
    record_id: asText(raw?.record_id || raw?.id),
    id_exibido: asText(raw?.id_exibido) || NA,
    operation_at: raw?.operation_at || null,
    produto_codigo: asText(raw?.produto_codigo),
    produto_nome: asText(raw?.produto_nome || raw?.product),
    produto_label: formatProdutoLabel(raw?.produto_codigo, raw?.produto_nome || raw?.product),
    produto_filtrado,
    produto_id: raw?.produto_id != null ? String(raw.produto_id) : '',
    cliente: asText(raw?.cliente || raw?.client) || NA,
    volume,
    volume_label: formatVolumeQuitacao(volume),
    operadores,
    operadores_label: formatOperadores(operadores),
    lote: asText(raw?.lote || raw?.lot),
    origens,
    destinos,
    packaging_type: asText(raw?.packaging_type),
    packaging_info: asText(raw?.packaging_info),
    status: asText(raw?.status),
    fractional_supply: Boolean(raw?.fractional_supply),
    complement_status: asText(raw?.complement_status),
    volume_apontado: Number(raw?.volume_apontado) || 0,
    volume_pendente: Number(raw?.volume_pendente) || 0,
    raw_materials_used: parseArr(raw?.raw_materials_used),
    operacao,
    operacao_label_key: OPERACAO_LABEL_KEY[operacao] || OPERACAO_LABEL_KEY[OPERACAO.CONVENCIONAL],
    operacao_badge_class:
      OPERACAO_BADGE_CLASS[operacao] || OPERACAO_BADGE_CLASS[OPERACAO.CONVENCIONAL],
    de_para: dePara,
    row_key: `${origem_fluxo}:${asText(raw?.record_id || raw?.id)}`,
  };
}

function endOfDayIso(dateStr) {
  if (!dateStr) return null;
  return `${dateStr}T23:59:59.999`;
}

function startOfDayIso(dateStr) {
  if (!dateStr) return null;
  return `${dateStr}T00:00:00.000`;
}

function matchesSearch(haystack, q) {
  if (!q) return true;
  return String(haystack || '').toLowerCase().includes(q);
}

function rowSearchBlob(row) {
  const parts = [
    row.id_exibido,
    row.produto_codigo,
    row.produto_nome,
    row.lote,
    ...row.origens.flatMap((o) => [
      o?.lote,
      o?.lot,
      o?.tanka_codigo,
      o?.placa,
      o?.barril,
      o?.container_number,
      o?.barril_number,
      o?.entrada_codigo,
    ]),
    ...row.destinos.flatMap((d) => [
      d?.tanka_codigo,
      d?.placa,
      d?.barril,
      d?.packaging_type,
    ]),
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function inDateRange(isoOrDate, dateFrom, dateTo) {
  if (!isoOrDate) return !(dateFrom || dateTo);
  const t = new Date(isoOrDate).getTime();
  if (Number.isNaN(t)) return false;
  if (dateFrom) {
    const from = new Date(startOfDayIso(dateFrom)).getTime();
    if (t < from) return false;
  }
  if (dateTo) {
    const to = new Date(endOfDayIso(dateTo)).getTime();
    if (t > to) return false;
  }
  return true;
}

async function fetchAllPages(buildQuery, context, maxPages = 30) {
  const pageSize = 1000;
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) {
      throw new Error(`[QuitacaoOT:${context}] ${error.message || 'Erro Supabase'}`);
    }
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
}

/**
 * Fallback quando a RPC ainda não foi aplicada no banco.
 * Aplica filtros em memória e pagina localmente.
 */
async function listQuitacaoOtFallback({
  search = '',
  cliente = '',
  dateFrom = '',
  dateTo = '',
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  sortDir = 'desc',
} = {}) {
  assertConfigured('fallback');
  const q = asText(search).toLowerCase();
  const clienteNorm = asText(cliente).toLowerCase();

  const [transbordos, producoes, transfers, recipes] = await Promise.all([
    fetchAllPages(
      () => {
        let b = chemflowSupabase
          .from('t_transbordos')
          .select(
            'id,codigo_transbordo,data,produto_id,produto_codigo,produto_nome,cliente_nome,volume_total,massa_total,densidade,operadores,origens,destinos'
          )
          .order('data', { ascending: false });
        if (dateFrom) b = b.gte('data', dateFrom);
        if (dateTo) b = b.lte('data', dateTo);
        if (clienteNorm) b = b.ilike('cliente_nome', cliente);
        return b;
      },
      't_transbordos'
    ),
    fetchAllPages(
      () => {
        let b = chemflowSupabase
          .from('ind_lista_producoes')
          .select(
            'id,op_number,end_time,date,updated_date,created_date,product,client,lot,volume,operator,status,recipe_id,packaging_type,packaging_info,raw_materials_used,fractional_supply,complement_status,volume_apontado,volume_pendente'
          )
          .eq('status', 'Finalizado')
          .order('end_time', { ascending: false });
        if (clienteNorm) b = b.ilike('client', cliente);
        return b;
      },
      'ind_lista_producoes'
    ),
    fetchAllPages(
      () => {
        let b = chemflowSupabase
          .from('ind_transbordo_ind')
          .select(
            'id,transfer_number,date,updated_date,created_date,product,client,volume,operator,origins,destinations,packaging_type'
          )
          .order('date', { ascending: false });
        if (clienteNorm) b = b.ilike('client', cliente);
        return b;
      },
      'ind_transbordo_ind'
    ),
    (async () => {
      try {
        return await fetchAllPages(
          () =>
            chemflowSupabase
              .from('receitas')
              .select('id,code,product_name,revision_number')
              .order('revision_number', { ascending: false }),
          'receitas'
        );
      } catch {
        try {
          return await fetchAllPages(
            () =>
              chemflowSupabase
                .from('ind_lista_receitas')
                .select('id,code,product_name,revision_number')
                .order('revision_number', { ascending: false }),
            'ind_lista_receitas'
          );
        } catch {
          return [];
        }
      }
    })(),
  ]);

  const recipeById = new Map();
  const recipeCodeByProduct = new Map();
  for (const r of recipes || []) {
    if (r?.id) recipeById.set(String(r.id), r);
    const pname = asText(r?.product_name).toLowerCase();
    if (pname && asText(r?.code) && !recipeCodeByProduct.has(pname)) {
      recipeCodeByProduct.set(pname, asText(r.code));
    }
  }

  // Mapa produto filtrado (cadastro) para classificar Filtração.
  const filtradoById = new Map();
  const filtradoByCodigo = new Map();
  try {
    const produtos = await fetchAllPages(
      () =>
        chemflowSupabase
          .from('cadastro_produtos')
          .select('id,codigo,filtrado')
          .order('codigo', { ascending: true }),
      'cadastro_produtos'
    );
    for (const p of produtos || []) {
      if (p?.id != null) filtradoById.set(String(p.id), Boolean(p.filtrado));
      const cod = asText(p?.codigo).toLowerCase();
      if (cod) filtradoByCodigo.set(cod, Boolean(p.filtrado));
    }
  } catch {
    /* ignore */
  }

  const merged = [];

  for (const t of transbordos || []) {
    const filtrado =
      (t.produto_id != null && filtradoById.get(String(t.produto_id))) ||
      filtradoByCodigo.get(asText(t.produto_codigo).toLowerCase()) ||
      false;
    merged.push(
      normalizeRow({
        origem_fluxo: ORIGEM_FLUXO.TRANSBORDO,
        record_id: t.id,
        id_exibido: t.codigo_transbordo,
        operation_at: t.data,
        produto_id: t.produto_id,
        produto_codigo: t.produto_codigo,
        produto_nome: t.produto_nome,
        produto_filtrado: filtrado,
        cliente: t.cliente_nome,
        volume: t.volume_total,
        volume_total: t.volume_total,
        massa_total: t.massa_total,
        densidade: t.densidade,
        operadores: t.operadores,
        origens: t.origens,
        destinos: t.destinos,
        lote: parseArr(t.origens)
          .map((o) => o?.lote)
          .filter(Boolean)
          .join(' '),
      })
    );
  }

  for (const p of producoes || []) {
    if (asText(p.op_number).startsWith('TB')) continue;
    const recipe = p.recipe_id ? recipeById.get(String(p.recipe_id)) : null;
    const code =
      asText(recipe?.code) ||
      recipeCodeByProduct.get(asText(p.product).toLowerCase()) ||
      '';
    const operation_at = p.end_time || p.date || p.updated_date || p.created_date;
    merged.push(
      normalizeRow({
        origem_fluxo: ORIGEM_FLUXO.PRODUCAO,
        record_id: p.id,
        id_exibido: p.op_number,
        operation_at,
        produto_codigo: code,
        produto_nome: p.product,
        cliente: p.client,
        volume: p.volume,
        operadores: p.operator ? [p.operator] : [],
        lote: p.lot,
        packaging_type: p.packaging_type,
        packaging_info: p.packaging_info,
        status: p.status,
        fractional_supply: p.fractional_supply,
        complement_status: p.complement_status,
        volume_apontado: p.volume_apontado,
        volume_pendente: p.volume_pendente,
        raw_materials_used: p.raw_materials_used,
      })
    );
  }

  for (const tr of transfers || []) {
    const code = recipeCodeByProduct.get(asText(tr.product).toLowerCase()) || '';
    merged.push(
      normalizeRow({
        origem_fluxo: ORIGEM_FLUXO.TRANSBORDO_IND,
        record_id: tr.id,
        id_exibido: tr.transfer_number,
        operation_at: tr.date || tr.updated_date || tr.created_date,
        produto_codigo: code,
        produto_nome: tr.product,
        cliente: tr.client,
        volume: tr.volume,
        operadores: tr.operator ? [tr.operator] : [],
        origens: tr.origins,
        destinos: tr.destinations,
        packaging_type: tr.packaging_type,
        lote: parseArr(tr.origins)
          .map((o) => o?.lot)
          .filter(Boolean)
          .join(' '),
      })
    );
  }

  let filtered = merged.filter((row) => {
    if (clienteNorm && asText(row.cliente).toLowerCase() !== clienteNorm) return false;
    if (!inDateRange(row.operation_at, dateFrom, dateTo)) return false;
    if (q && !matchesSearch(rowSearchBlob(row), q)) return false;
    return true;
  });

  const asc = String(sortDir).toLowerCase() === 'asc';
  filtered.sort((a, b) => {
    const ta = new Date(a.operation_at || 0).getTime();
    const tb = new Date(b.operation_at || 0).getTime();
    if (ta === tb) return String(b.id_exibido).localeCompare(String(a.id_exibido));
    return asc ? ta - tb : tb - ta;
  });

  const size = clampPageSize(pageSize);
  const p = Math.max(1, Number(page) || 1);
  const total = filtered.length;
  const start = (p - 1) * size;
  const rows = filtered.slice(start, start + size);
  return {
    rows,
    total,
    page: p,
    pageSize: size,
    totals: computeQuitacaoOtTotals(filtered),
    source: 'fallback',
  };
}

export function emptyQuitacaoOtTotals() {
  return {
    [OPERACAO.INDUSTRIALIZACAO]: 0,
    [OPERACAO.FILTRACAO]: 0,
    [OPERACAO.CONVENCIONAL]: 0,
  };
}

/** Soma volumes do conjunto filtrado por tipo de operação. */
export function computeQuitacaoOtTotals(rows = []) {
  const totals = emptyQuitacaoOtTotals();
  for (const row of rows || []) {
    const vol = Number(row?.volume) || 0;
    if (!(vol > 0)) continue;
    const op = row?.operacao || OPERACAO.CONVENCIONAL;
    if (op === OPERACAO.INDUSTRIALIZACAO) totals[OPERACAO.INDUSTRIALIZACAO] += vol;
    else if (op === OPERACAO.FILTRACAO) totals[OPERACAO.FILTRACAO] += vol;
    else totals[OPERACAO.CONVENCIONAL] += vol;
  }
  return totals;
}

/** Garante flag filtrado + recalcula Operação nos transbordos ChemFlow. */
async function enrichFiltradoOperacao(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const targets = list.filter((r) => r?.origem_fluxo === ORIGEM_FLUXO.TRANSBORDO);
  if (targets.length === 0) return list;

  const codes = [
    ...new Set(targets.map((r) => asText(r.produto_codigo)).filter(Boolean)),
  ];
  const filtradoByCodigo = new Map();
  if (codes.length > 0) {
    try {
      const { data, error } = await chemflowSupabase
        .from('cadastro_produtos')
        .select('codigo,filtrado')
        .in('codigo', codes);
      if (!error) {
        for (const p of data || []) {
          const cod = asText(p?.codigo).toLowerCase();
          if (cod) filtradoByCodigo.set(cod, Boolean(p.filtrado));
        }
      }
    } catch {
      /* ignore */
    }
  }

  return list.map((row) => {
    if (row.origem_fluxo !== ORIGEM_FLUXO.TRANSBORDO) return row;
    const fromCadastro = filtradoByCodigo.get(asText(row.produto_codigo).toLowerCase());
    const produto_filtrado =
      fromCadastro != null ? fromCadastro : Boolean(row.produto_filtrado);
    const operacao = resolveOperacao({ ...row, produto_filtrado });
    return {
      ...row,
      produto_filtrado,
      operacao,
      operacao_label_key:
        OPERACAO_LABEL_KEY[operacao] || OPERACAO_LABEL_KEY[OPERACAO.CONVENCIONAL],
      operacao_badge_class:
        OPERACAO_BADGE_CLASS[operacao] || OPERACAO_BADGE_CLASS[OPERACAO.CONVENCIONAL],
    };
  });
}

/**
 * Lista consolidada paginada (RPC preferencial).
 */
export async function listQuitacaoOt(params = {}) {
  assertConfigured('list');
  const {
    search = '',
    cliente = '',
    dateFrom = '',
    dateTo = '',
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
    sortDir = 'desc',
  } = params;

  const size = clampPageSize(pageSize);
  const p = Math.max(1, Number(page) || 1);

  try {
    const { data, error } = await chemflowSupabase.rpc('painel_quitacao_ot_list', {
      p_search: asText(search) || null,
      p_cliente: asText(cliente) || null,
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_page: p,
      p_page_size: size,
      p_sort_dir: sortDir === 'asc' ? 'asc' : 'desc',
    });

    if (error) throw error;

    const payload = data && typeof data === 'object' ? data : {};
    const rows = await enrichFiltradoOperacao(
      (Array.isArray(payload.rows) ? payload.rows : []).map(normalizeRow)
    );
    const totalsRaw = payload.totals && typeof payload.totals === 'object' ? payload.totals : null;
    const totals = totalsRaw
      ? {
          [OPERACAO.INDUSTRIALIZACAO]: Number(totalsRaw.industrializacao) || 0,
          [OPERACAO.FILTRACAO]: Number(totalsRaw.filtracao) || 0,
          [OPERACAO.CONVENCIONAL]: Number(totalsRaw.convencional) || 0,
        }
      : emptyQuitacaoOtTotals();
    return {
      rows,
      total: Number(payload.total) || 0,
      page: Number(payload.page) || p,
      pageSize: Number(payload.page_size) || size,
      totals,
      source: 'rpc',
    };
  } catch (err) {
    const msg = String(err?.message || err?.details || '');
    const useFallback =
      /painel_quitacao_ot_list/i.test(msg) ||
      /could not find the function/i.test(msg) ||
      /function .* does not exist/i.test(msg) ||
      /ind_lista_receitas/i.test(msg) ||
      /relation .* does not exist/i.test(msg) ||
      /cannot extract elements from a scalar/i.test(msg) ||
      err?.code === 'PGRST202' ||
      err?.code === '42883' ||
      err?.code === '42P01' ||
      err?.code === '22023';
    if (!useFallback) throw err;
    console.warn('[QuitacaoOT] RPC indisponível/desatualizada; usando fallback.', msg);
    return listQuitacaoOtFallback({
      search,
      cliente,
      dateFrom,
      dateTo,
      page: p,
      pageSize: size,
      sortDir,
    });
  }
}

/** Clientes distintos para o filtro (cadastro + nomes já usados nas operações). */
export async function listQuitacaoOtClientes() {
  assertConfigured('clientes');
  const names = new Set();

  try {
    const { data } = await chemflowSupabase
      .from('t_clientes')
      .select('nome')
      .order('nome', { ascending: true })
      .limit(2000);
    for (const c of data || []) {
      const n = asText(c?.nome);
      if (n) names.add(n);
    }
  } catch {
    /* ignore */
  }

  try {
    const [t, p, tr] = await Promise.all([
      chemflowSupabase.from('t_transbordos').select('cliente_nome').limit(2000),
      chemflowSupabase
        .from('ind_lista_producoes')
        .select('client')
        .eq('status', 'Finalizado')
        .limit(2000),
      chemflowSupabase.from('ind_transbordo_ind').select('client').limit(2000),
    ]);
    for (const row of t.data || []) {
      const n = asText(row?.cliente_nome);
      if (n) names.add(n);
    }
    for (const row of p.data || []) {
      const n = asText(row?.client);
      if (n) names.add(n);
    }
    for (const row of tr.data || []) {
      const n = asText(row?.client);
      if (n) names.add(n);
    }
  } catch {
    /* ignore */
  }

  return [...names].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Hidrata o registro completo para o modal de detalhes. */
export async function getQuitacaoOtDetail(origemFluxo, recordId) {
  assertConfigured('detail');
  const id = asText(recordId);
  if (!id) return null;

  if (origemFluxo === ORIGEM_FLUXO.TRANSBORDO) {
    const { data, error } = await chemflowSupabase
      .from('t_transbordos')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  if (origemFluxo === ORIGEM_FLUXO.PRODUCAO) {
    const { data, error } = await chemflowSupabase
      .from('ind_lista_producoes')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  if (origemFluxo === ORIGEM_FLUXO.TRANSBORDO_IND) {
    const { data, error } = await chemflowSupabase
      .from('ind_transbordo_ind')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  return null;
}
