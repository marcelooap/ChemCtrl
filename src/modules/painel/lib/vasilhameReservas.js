import { base44 } from '@industrializacao/api/base44Client';
import {
  containerDisplayNetWeight,
  containerDisplayVolume,
  isContainerFractional,
  productionOfContainer,
} from '@industrializacao/lib/fractionalSupply';
import { resolveProductCode } from '@industrializacao/lib/recipeRevisions';
import { getDominantLote } from '@transbordo/lib/vasilhameComposicao';
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

/** Mesma regra da tela Transbordo → Vasilhames. */
function isTransbordoFracionado(vasilhame) {
  if (!vasilhame?.fracionado) return false;
  const lotes = new Set(
    (vasilhame.composicao || [])
      .map((c) => (c.lote || '').trim())
      .filter(Boolean)
  );
  return lotes.size <= 1;
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

export function isTransbordoVasilhameEmEstoque(vasilhame) {
  if (!vasilhame) return false;
  if ((vasilhame.tipo || '') === 'Tankagem') return false;
  const status =
    vasilhame.status || (vasilhame.data_saida ? 'Expedido' : 'No Pátio');
  return status === 'No Pátio';
}

export function isIndContainerEmEstoque(container) {
  if (!container) return false;
  const type = String(container.type || '').toLowerCase();
  if (type.includes('tank')) return false;
  return (container.status || '') === 'No Pátio';
}

function rowCreatedAtMs(row) {
  const raw = row?.createdAt;
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function mapTransbordoVasilhame(vasilhame, reservas = []) {
  const origemId = vasilhame.id;
  const chave = buildVasilhameReservaChave(ORIGEM_TRANSBORDO, origemId);
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
    volume: Number(vasilhame.volume) || 0,
    massa: Number(vasilhame.peso_liquido) || 0,
    lote: dash(getDominantLote(vasilhame.composicao) || vasilhame.lote),
    createdAt: vasilhame.created_at || null,
    reservado: isVasilhameReservado(reservas, chave),
    fracionado: isTransbordoFracionado(vasilhame),
    source: vasilhame,
  };
}

export function mapIndContainer(
  container,
  reservas = [],
  recipes = [],
  productions = [],
  transfers = []
) {
  const origemId = container.id;
  const chave = buildVasilhameReservaChave(ORIGEM_INDUSTRIALIZACAO, origemId);
  const production = productionOfContainer(container, productions);
  const codigo = resolveProductCode(recipes, container, production);
  return {
    id: chave,
    chave,
    origem: ORIGEM_INDUSTRIALIZACAO,
    origemId,
    displayId: dash(padRegId(container.registration_id) || (origemId ? String(origemId).slice(0, 8) : '')),
    placa: dash(container.container_number),
    barril: dash(container.barril_number),
    clienteId: null,
    produtoId: null,
    clienteNome: dash(container.client),
    codigo: dash(codigo),
    produto: dash(container.product),
    volume: containerDisplayVolume(container, productions),
    massa: containerDisplayNetWeight(container, productions, recipes),
    lote: dash(container.lot),
    createdAt: container.created_date || container.created_at || null,
    reservado: isVasilhameReservado(reservas, chave),
    fracionado: isContainerFractional(container, production, transfers),
    source: container,
  };
}

export function buildVasilhameReservaRows({
  vasilhames = [],
  containers = [],
  reservas = [],
  recipes = [],
  productions = [],
  transfers = [],
} = {}) {
  const transbordo = (vasilhames || [])
    .filter(isTransbordoVasilhameEmEstoque)
    .map((v) => mapTransbordoVasilhame(v, reservas));

  const industrializacao = (containers || [])
    .filter(isIndContainerEmEstoque)
    .map((c) => mapIndContainer(c, reservas, recipes, productions, transfers));

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

/**
 * Reserva comercial unitária do vasilhame (Livre → Reservado).
 * Persistida em t_material_reservas com chave própria, sem alterar o estoque.
 */
export async function reservarVasilhame({ row, user, observacao = '' }) {
  if (!row?.chave || !row?.origemId) {
    throw new Error('Vasilhame inválido.');
  }

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
