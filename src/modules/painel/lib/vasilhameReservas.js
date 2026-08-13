import { base44 } from '@industrializacao/api/base44Client';
import {
  containerDisplayNetWeight,
  containerDisplayVolume,
  productionOfContainer,
} from '@industrializacao/lib/fractionalSupply';
import { resolveProductCode } from '@industrializacao/lib/recipeRevisions';
import { getDominantLote } from '@transbordo/lib/vasilhameComposicao';
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

export function mapTransbordoVasilhame(vasilhame, reservas = []) {
  const origemId = vasilhame.id;
  const chave = buildVasilhameReservaChave(ORIGEM_TRANSBORDO, origemId);
  return {
    id: chave,
    chave,
    origem: ORIGEM_TRANSBORDO,
    origemId,
    displayId: dash(vasilhame.codigo || (origemId ? String(origemId).slice(0, 8) : '')),
    clienteId: vasilhame.cliente_id || null,
    produtoId: vasilhame.produto_id || null,
    clienteNome: dash(vasilhame.cliente_nome),
    codigo: dash(vasilhame.produto_codigo),
    produto: dash(vasilhame.produto_nome),
    volume: Number(vasilhame.volume) || 0,
    massa: Number(vasilhame.peso_liquido) || 0,
    lote: dash(getDominantLote(vasilhame.composicao) || vasilhame.lote),
    reservado: isVasilhameReservado(reservas, chave),
    source: vasilhame,
  };
}

export function mapIndContainer(container, reservas = [], recipes = [], productions = []) {
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
    clienteId: null,
    produtoId: null,
    clienteNome: dash(container.client),
    codigo: dash(codigo),
    produto: dash(container.product),
    volume: containerDisplayVolume(container, productions),
    massa: containerDisplayNetWeight(container, productions, recipes),
    lote: dash(container.lot),
    reservado: isVasilhameReservado(reservas, chave),
    source: container,
  };
}

export function buildVasilhameReservaRows({
  vasilhames = [],
  containers = [],
  reservas = [],
  recipes = [],
  productions = [],
} = {}) {
  const transbordo = (vasilhames || [])
    .filter(isTransbordoVasilhameEmEstoque)
    .map((v) => mapTransbordoVasilhame(v, reservas));

  const industrializacao = (containers || [])
    .filter(isIndContainerEmEstoque)
    .map((c) => mapIndContainer(c, reservas, recipes, productions));

  return [...transbordo, ...industrializacao].sort((a, b) => {
    const byOrigem = String(a.origem).localeCompare(String(b.origem), 'pt-BR');
    if (byOrigem !== 0) return byOrigem;
    const byCliente = String(a.clienteNome).localeCompare(String(b.clienteNome), 'pt-BR');
    if (byCliente !== 0) return byCliente;
    return String(a.displayId).localeCompare(String(b.displayId), 'pt-BR', { numeric: true });
  });
}

export async function loadIndustrializacaoVasilhames() {
  try {
    const [containers, productions, recipes] = await Promise.all([
      base44.entities.Container.list('-created_date', 500),
      base44.entities.Production.list('-created_date', 500),
      base44.entities.Recipe.list('-updated_date', 500),
    ]);
    return {
      containers: containers || [],
      productions: productions || [],
      recipes: recipes || [],
    };
  } catch (err) {
    console.warn('[ReservarMaterial] industrialização:', err);
    return { containers: [], productions: [], recipes: [] };
  }
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
