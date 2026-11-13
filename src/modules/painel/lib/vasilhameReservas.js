import { base44 } from '@industrializacao/api/base44Client';
import {
  containerDisplayNetWeight,
  containerDisplayVolume,
  isContainerFractional,
  productionOfContainer,
} from '@industrializacao/lib/fractionalSupply';
import { resolveContainerFabricacao } from '@industrializacao/lib/containerLoteDatas';
import { containerLabelDateOverride } from '@industrializacao/lib/containerLabelDateOverride';
import { calcValidityDate } from '@industrializacao/lib/labelprint';
import {
  resolveProductCode,
  resolveValidityDays,
} from '@industrializacao/lib/recipeRevisions';
import { toDateInputValue } from '@/i18n/formatters';
import {
  getDominantLote,
  resolveVasilhameLoteDatas,
} from '@transbordo/lib/vasilhameComposicao';
import { resolveVasilhameExpedidoDisplay } from '@transbordo/lib/vasilhamePatio';
import { buildContainerYardRestorePatch } from '@transbordo/lib/saidaIndContainer';
import { parseNumero } from '@transbordo/lib/format';
import { entities } from '@transbordo/services/entities';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ORIGEM_TRANSBORDO = 'transbordo';
export const ORIGEM_INDUSTRIALIZACAO = 'industrializacao';
export const VASILHAME_RESERVA_PREFIX = 'vasilhame';

function toUuidOrNull(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return UUID_RE.test(s) ? s : null;
}

function toUserIdText(value) {
  if (value == null || value === '') return null;
  return String(value).trim() || null;
}

function dash(value) {
  const s = String(value ?? '').trim();
  return s || '—';
}

function padRegId(value) {
  if (value == null || value === '') return null;
  return String(value).padStart(2, '0');
}

/** Mesma regra da tela Transbordo → Vasilhames: o flag do tanque, mesmo com vários lotes. */
function isTransbordoFracionado(vasilhame) {
  return vasilhame?.fracionado === true;
}

/** True quando a reserva comercial é de um vasilhame (não de estoque embalado). */
export function isVasilhameReservaChave(chave) {
  return String(chave || '').startsWith(`${VASILHAME_RESERVA_PREFIX}||`);
}

export function buildVasilhameReservaChave(origem, origemId) {
  return `${VASILHAME_RESERVA_PREFIX}||${origem}||${origemId}`;
}

export function isVasilhameReservado(reservas = [], chave) {
  return (reservas || []).some((r) => r?.chave === chave && r.status === 'ativa');
}

function isTankagemTransbordo(vasilhame) {
  return (vasilhame?.tipo || '') === 'Tankagem';
}

function isTankContainer(container) {
  return String(container?.type || '').toLowerCase().includes('tank');
}

function transbordoStatus(vasilhame) {
  return vasilhame?.status || (vasilhame?.data_saida ? 'Expedido' : 'No Pátio');
}

export function isTransbordoVasilhameEmEstoque(vasilhame) {
  if (!vasilhame || isTankagemTransbordo(vasilhame)) return false;
  return transbordoStatus(vasilhame) === 'No Pátio';
}

export function isIndContainerEmEstoque(container) {
  if (!container || isTankContainer(container)) return false;
  return (container.status || '') === 'No Pátio';
}

function isTransbordoVasilhameElegivel(vasilhame, includeSaidos) {
  if (!vasilhame || isTankagemTransbordo(vasilhame)) return false;
  const status = transbordoStatus(vasilhame);
  if (status === 'No Pátio') return true;
  if (!includeSaidos) return false;
  return status === 'Expedido' || Boolean(String(vasilhame.data_saida || '').trim());
}

function isIndContainerElegivel(container, includeSaidos) {
  if (!container || isTankContainer(container)) return false;
  const status = container.status || '';
  if (status === 'No Pátio') return true;
  if (!includeSaidos) return false;
  return status === 'Expedido' || Boolean(String(container.departure_date || '').trim());
}

function exitDateOrNull(value) {
  const raw = String(value ?? '').trim();
  return raw || null;
}

function rowCreatedAtMs(row) {
  const raw = row?.createdAt;
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normPlacaBarril(placa, barril) {
  return `${String(placa ?? '')
    .trim()
    .toUpperCase()}|${String(barril ?? '')
    .trim()
    .toUpperCase()}`;
}

function saidaItemsByVasilhameId(saidas = []) {
  const map = new Map();
  for (const saida of saidas || []) {
    for (const item of saida?.itens || []) {
      if (item?.tipo !== 'convencional' && item?.tipo !== 'ind_vasilhame') continue;
      const id = item.vasilhame_id || item.container_id;
      if (!id) continue;
      const key = String(id);
      const list = map.get(key);
      if (list) list.push({ saida, item });
      else map.set(key, [{ saida, item }]);
    }
  }
  return map;
}

/** Amplia match por placa/barril quando o id da saída ficou defasado (regravação OP). */
function resolveLinkedSaidaItems(vasilhame, saidaItems, saidas = []) {
  const byId = saidaItems.get(String(vasilhame?.id)) || [];
  if (byId.length > 0) return byId;

  const placa = vasilhame?.placa;
  const barril = vasilhame?.barril;
  if (!placa && !barril) return [];

  const selfKey = normPlacaBarril(placa, barril);
  if (selfKey === '|') return [];

  const linked = [];
  for (const saida of saidas || []) {
    for (const item of saida?.itens || []) {
      if (item?.tipo !== 'convencional') continue;
      const itemKey = normPlacaBarril(
        item.vasilhame_placa || item.placa,
        item.vasilhame_barril || item.barril
      );
      if (itemKey !== '|' && itemKey === selfKey) {
        linked.push({ saida, item });
      }
    }
  }
  return linked;
}

function resolveIndContainerLoteSummary(container, productions = [], recipes = []) {
  const production = productionOfContainer(container, productions);
  const override = containerLabelDateOverride(container);
  if (override) {
    return {
      dataFabricacao: override.manufactureDate || null,
      dataValidade: override.expiryDate || null,
      lacres: String(container?.seals || '').trim() || null,
    };
  }
  const fabricacao = resolveContainerFabricacao(container, production);
  const validityDays = resolveValidityDays(recipes || [], container, production);
  return {
    dataFabricacao: toDateInputValue(fabricacao) || null,
    dataValidade: toDateInputValue(calcValidityDate(fabricacao, validityDays)) || null,
    lacres: String(container?.seals || '').trim() || null,
  };
}

export function mapTransbordoVasilhame(vasilhame, reservas = [], context = {}) {
  const display = resolveVasilhameExpedidoDisplay(vasilhame, {
    linkedItems: context.linkedItems || [],
    transbordos: context.transbordos || [],
  });
  const origemId = vasilhame.id;
  const chave = buildVasilhameReservaChave(ORIGEM_TRANSBORDO, origemId);
  const loteDatas = resolveVasilhameLoteDatas(vasilhame, context.estoqueById || null, {
    transbordos: context.transbordos || [],
  });
  return {
    id: chave,
    chave,
    origem: ORIGEM_TRANSBORDO,
    origemId,
    displayId: dash(vasilhame.codigo || (origemId ? String(origemId).slice(0, 8) : '')),
    placa: dash(vasilhame.placa),
    barril: dash(vasilhame.barril),
    clienteId: vasilhame.cliente_id || null,
    produtoId: vasilhame.produto_id || null,
    clienteNome: dash(vasilhame.cliente_nome),
    codigo: dash(vasilhame.produto_codigo),
    produto: dash(vasilhame.produto_nome),
    volume: Number(display.volume) || 0,
    massa: Number(display.peso_liquido) || 0,
    tara: Number(vasilhame.tara) || 0,
    lote: dash(getDominantLote(vasilhame.composicao) || vasilhame.lote),
    dataFabricacao: loteDatas.data_fabricacao || null,
    dataValidade: loteDatas.data_validade || null,
    lacres: String(vasilhame.lacres || '').trim() || null,
    createdAt: vasilhame.created_at || null,
    reservado: isVasilhameReservado(reservas, chave),
    fracionado: isTransbordoFracionado(vasilhame),
    emPatio: transbordoStatus(vasilhame) === 'No Pátio',
    dataSaida: exitDateOrNull(vasilhame.data_saida),
    observacao: dash(vasilhame.observacao),
    source: display,
  };
}

function resolveIndContainerDisplay(container, linkedItems = [], productions = []) {
  if (!container) return container;
  const status = (container.status || '').trim();
  const expedido =
    status === 'Expedido' || Boolean(String(container.departure_date || '').trim());
  const currentVol = Number(container.volume) || 0;
  if (!expedido || currentVol > 0.001) return container;

  const restored = buildContainerYardRestorePatch(container, linkedItems);
  if (!restored || !(Number(restored.volume) > 0)) {
    // Fallback: volume apontado / nominal da OP (boleta de tanque já saído).
    const production = productionOfContainer(container, productions);
    const apontado = parseFloat(production?.volume_apontado);
    const opVol = parseFloat(production?.volume) || 0;
    const fallbackVol =
      Number.isFinite(apontado) && apontado > 0 ? apontado : opVol > 0 ? opVol : 0;
    if (fallbackVol <= 0) return container;
    const dens =
      parseFloat(production?.density) ||
      (fallbackVol > 0 && container.net_weight
        ? Number(container.net_weight) / fallbackVol
        : 0);
    const net =
      dens > 0
        ? Math.round(fallbackVol * dens)
        : Number(container.net_weight) || 0;
    const tare = Number(container.tare) || 0;
    return {
      ...container,
      volume: fallbackVol,
      net_weight: net,
      gross_weight: Math.round(tare + net),
    };
  }

  return {
    ...container,
    volume: restored.volume,
    net_weight: restored.net_weight,
    gross_weight: restored.gross_weight,
  };
}

export function mapIndContainer(
  container,
  reservas = [],
  recipes = [],
  productions = [],
  transfers = [],
  context = {}
) {
  const display = resolveIndContainerDisplay(
    container,
    context.linkedItems || [],
    productions
  );
  const origemId = container.id;
  const chave = buildVasilhameReservaChave(ORIGEM_INDUSTRIALIZACAO, origemId);
  const production = productionOfContainer(display, productions);
  const codigo = resolveProductCode(recipes, display, production);
  const loteSummary = resolveIndContainerLoteSummary(display, productions, recipes);
  return {
    id: chave,
    chave,
    origem: ORIGEM_INDUSTRIALIZACAO,
    origemId,
    displayId: dash(padRegId(display.registration_id) || (origemId ? String(origemId).slice(0, 8) : '')),
    placa: dash(display.container_number),
    barril: dash(display.barril_number),
    clienteId: null,
    produtoId: null,
    clienteNome: dash(display.client),
    codigo: dash(codigo),
    produto: dash(display.product),
    volume: containerDisplayVolume(display, productions),
    massa: containerDisplayNetWeight(display, productions, recipes),
    tara: Number(display.tare ?? display.tara) || 0,
    lote: dash(display.lot),
    dataFabricacao: loteSummary.dataFabricacao,
    dataValidade: loteSummary.dataValidade,
    lacres: loteSummary.lacres,
    createdAt: display.created_date || display.created_at || null,
    reservado: isVasilhameReservado(reservas, chave),
    fracionado: isContainerFractional(display, production, transfers),
    emPatio: (display.status || '') === 'No Pátio',
    dataSaida: exitDateOrNull(display.departure_date),
    observacao: dash(display.observations),
    source: display,
    // Referências (sem cópia) usadas para calcular pesos/volume da boleta.
    boletaContext: { productions, recipes },
  };
}

/**
 * Garante volume/massa da linha de reserva no payload da boleta.
 * Tanque expedido pode ter volume zerado no cadastro; a row já traz o valor
 * restaurado para exibição — a boleta precisa do mesmo conteúdo.
 */
function sourceForBoleta(row) {
  const source = row?.source;
  if (!source) return source;

  const rowVol = Number(row.volume) || 0;
  const rowMassa = Number(row.massa) || 0;
  if (rowVol <= 0 && rowMassa <= 0) return source;

  if (row.origem === ORIGEM_INDUSTRIALIZACAO) {
    const srcVol = Number(source.volume) || 0;
    const srcNet = Number(source.net_weight) || 0;
    if (srcVol > 0 && srcNet > 0) return source;
    const tare = Number(source.tare ?? source.tara) || Number(row.tara) || 0;
    const volume = srcVol > 0 ? srcVol : rowVol;
    const net_weight = srcNet > 0 ? srcNet : rowMassa;
    return {
      ...source,
      volume,
      net_weight,
      gross_weight: Math.round(tare + net_weight),
    };
  }

  const srcVol = Number(source.volume) || 0;
  const srcPeso = Number(source.peso_liquido) || 0;
  if (srcVol > 0 && srcPeso > 0) return source;
  const tara = Number(source.tara) || Number(row.tara) || 0;
  const volume = srcVol > 0 ? srcVol : rowVol;
  const peso_liquido = srcPeso > 0 ? srcPeso : rowMassa;
  return {
    ...source,
    volume,
    peso_liquido,
    peso_bruto: Math.round(tara + peso_liquido),
  };
}

/**
 * Gera o PDF da boleta do vasilhame, reutilizando o gerador de cada módulo
 * (mesmo layout das telas de Vasilhames). Geradores carregados sob demanda.
 */
export async function generateVasilhameBoleta(row) {
  if (!row?.source) throw new Error('Vasilhame inválido.');

  const source = sourceForBoleta(row);

  if (row.origem === ORIGEM_INDUSTRIALIZACAO) {
    const { generateBoletaPDF } = await import('@industrializacao/lib/pdfReports');
    const { productions = [], recipes = [] } = row.boletaContext || {};
    generateBoletaPDF(source, productions, recipes);
    return;
  }

  const { generateBoletaPDF } = await import('@transbordo/lib/pdfBoleta');
  generateBoletaPDF(source);
}

export function buildVasilhameReservaRows({
  vasilhames = [],
  containers = [],
  reservas = [],
  recipes = [],
  productions = [],
  transfers = [],
  includeSaidos = false,
  saidas = [],
  transbordos = [],
  estoque = [],
} = {}) {
  const saidaItems = saidaItemsByVasilhameId(saidas);
  const estoqueById = new Map(
    (estoque || []).filter((row) => row?.id != null).map((row) => [String(row.id), row])
  );
  const transbordo = (vasilhames || [])
    .filter((v) => isTransbordoVasilhameElegivel(v, includeSaidos))
    .map((v) =>
      mapTransbordoVasilhame(v, reservas, {
        linkedItems: resolveLinkedSaidaItems(v, saidaItems, saidas),
        transbordos,
        estoqueById,
      })
    );

  const industrializacao = (containers || [])
    .filter((c) => isIndContainerElegivel(c, includeSaidos))
    .map((c) =>
      mapIndContainer(c, reservas, recipes, productions, transfers, {
        linkedItems: saidaItems.get(String(c.id)) || [],
      })
    );

  // Mais recente no topo (último cadastrado primeiro), sem agrupar por origem.
  return [...transbordo, ...industrializacao].sort((a, b) => {
    const byCreated = rowCreatedAtMs(b) - rowCreatedAtMs(a);
    if (byCreated !== 0) return byCreated;
    return String(a.displayId).localeCompare(String(b.displayId), 'pt-BR', { numeric: true });
  });
}

export async function loadIndustrializacaoVasilhames() {
  try {
    const [containers, productions, recipes, transfers] = await Promise.all([
      base44.entities.Container.list('-created_date', 500),
      base44.entities.Production.list('-created_date', 500),
      base44.entities.Recipe.list('-updated_date', 500),
      base44.entities.Transfer.list('-created_date', 500).catch(() => []),
    ]);
    return {
      containers: containers || [],
      productions: productions || [],
      recipes: recipes || [],
      transfers: transfers || [],
    };
  } catch (err) {
    console.warn('[ReservarMaterial] industrialização:', err);
    return { containers: [], productions: [], recipes: [], transfers: [] };
  }
}

function normKey(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isUnidadeVolume(unidade) {
  const u = String(unidade || '')
    .trim()
    .toLowerCase();
  return u === 'l' || u === 'lt' || u === 'litro' || u === 'litros' || u === 'gal';
}

function isUnidadeMassa(unidade) {
  const u = String(unidade || '')
    .trim()
    .toLowerCase();
  return (
    u === 'kg' ||
    u === 'kgs' ||
    u === 'quilo' ||
    u === 'quilos' ||
    u === 'lb' ||
    u === 'lbs'
  );
}

/** Litros: trata milhar BR ("5.000") que Number/parseFloat interpretaria como 5. */
function parseLitros(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const s = String(value).trim();
  if (!s || s === '-') return 0;
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    const n = parseFloat(s.replace(/\./g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return parseNumero(s);
}

/**
 * Soma o conteúdo dos vasilhames de transbordo com reserva comercial ativa,
 * na unidade do estoque de produtos (L → volume; kg → peso líquido).
 */
export function sumReservadoVasilhamesConteudo(
  vasilhames = [],
  reservas = [],
  { clienteId, clienteNome, produtoCodigo, produtoNome, unidade } = {}
) {
  const cod = normKey(produtoCodigo);
  const nome = produtoNome != null ? normKey(produtoNome) : '';
  const cliNome = normKey(clienteNome);
  const cliId = clienteId ? String(clienteId).trim() : '';
  const asVolume = isUnidadeVolume(unidade);
  const asMassa = isUnidadeMassa(unidade);
  if (!asVolume && !asMassa) return 0;

  return (vasilhames || []).reduce((sum, v) => {
    if (!v || (v.tipo || '') === 'Tankagem') return sum;
    if ((v.status || 'No Pátio') !== 'No Pátio') return sum;

    const chave = buildVasilhameReservaChave(ORIGEM_TRANSBORDO, v.id);
    if (!isVasilhameReservado(reservas, chave)) return sum;

    if (cod && normKey(v.produto_codigo) !== cod) return sum;
    if (nome && nome !== '—') {
      const vNome = normKey(v.produto_nome);
      if (vNome && vNome !== '—' && vNome !== nome) return sum;
    }

    const vId = v.cliente_id ? String(v.cliente_id).trim() : '';
    const vCliNome = normKey(v.cliente_nome);
    let sameCliente = false;
    if (cliId && vId) sameCliente = cliId === vId;
    else if (cliNome && vCliNome) sameCliente = cliNome === vCliNome;
    else if (cliId && !vId && cliNome && vCliNome) sameCliente = cliNome === vCliNome;
    else if (!cliId && cliNome && vId && vCliNome) sameCliente = cliNome === vCliNome;
    else sameCliente = !cliId && !cliNome && !vId && !vCliNome;
    if (!sameCliente) return sum;

    if (asVolume) {
      const volume = parseLitros(v.volume);
      const capacidade = parseLitros(v.capacidade);
      return sum + (volume > 0 ? volume : capacidade);
    }

    return sum + (parseNumero(v.peso_liquido) || 0);
  }, 0);
}

function normalizeSolicitante(value) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return name.slice(0, 120);
}

/**
 * Reserva comercial unitária do vasilhame (Livre → Reservado).
 * Persistida em t_material_reservas com chave própria, sem alterar o estoque.
 */
export async function reservarVasilhame({ row, user, observacao = '', solicitante }) {
  if (!row?.chave || !row?.origemId) {
    throw new Error('Vasilhame inválido.');
  }

  const solicitanteNome = normalizeSolicitante(solicitante);
  if (!solicitanteNome) throw new Error('Informe o solicitante da reserva.');

  const existing = await entities.materialReservas.filter({ chave: row.chave });
  const ativa = (existing || []).find((r) => r.status === 'ativa');
  if (ativa) return { changed: false };

  const usuarioNome =
    user?.nome || user?.full_name || user?.username || user?.email || '—';

  await entities.materialReservas.create({
    chave: row.chave,
    cliente_id: toUuidOrNull(row.clienteId),
    cliente_nome: row.clienteNome === '—' ? null : row.clienteNome,
    produto_id: toUuidOrNull(row.produtoId),
    produto_codigo: row.codigo === '—' ? '' : row.codigo,
    produto_nome: row.produto === '—' ? null : row.produto,
    lote: row.lote === '—' ? '' : row.lote,
    unidade_medida: 'un',
    quantidade: 1,
    status: 'ativa',
    usuario_id: toUserIdText(user?.id),
    usuario_nome: usuarioNome,
    solicitante: solicitanteNome,
    observacao: observacao || null,
  });

  return { changed: true };
}

/**
 * Remove a reserva comercial do vasilhame (Reservado → Livre).
 * Mantém auditoria em t_material_reservas (status removida).
 */
export async function liberarVasilhame({ row, user, motivoRemocao = '' }) {
  if (!row?.chave) {
    throw new Error('Vasilhame inválido.');
  }

  const existing = await entities.materialReservas.filter({ chave: row.chave });
  const ativas = (existing || []).filter((r) => r.status === 'ativa');
  if (ativas.length === 0) return { changed: false };

  const now = new Date().toISOString();
  const usuarioNome =
    user?.nome || user?.full_name || user?.username || user?.email || '—';
  const usuarioId = toUserIdText(user?.id);

  await Promise.all(
    ativas.map((reserva) =>
      entities.materialReservas.update(reserva.id, {
        status: 'removida',
        removido_em: now,
        removido_por_id: usuarioId,
        removido_por_nome: usuarioNome,
        motivo_remocao: motivoRemocao || 'Reserva de vasilhame removida',
      })
    )
  );

  return { changed: true };
}
