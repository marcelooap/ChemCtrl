const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

export const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
};

/** Origins belonging to a container, sorted oldest-first. */
export const originsOfContainer = (origins, containerId) => {
  if (!containerId || !origins?.length) return [];
  return origins
    .filter((o) => o.container_id === containerId)
    .sort((a, b) => {
      const ta = a.created_date ? new Date(a.created_date).getTime() : 0;
      const tb = b.created_date ? new Date(b.created_date).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
};

export const sumOriginVolumes = (origins) =>
  round3((origins || []).reduce((s, o) => s + (parseFloat(o.volume) || 0), 0));

/**
 * Packaging header lot = the origin lot with the greatest total volume.
 * Same lot across multiple origin rows is summed. Tie-break: newest created_date.
 */
export function dominantLotFromOrigins(origins) {
  const totals = new Map();
  for (const o of origins || []) {
    const vol = parseFloat(o.volume) || 0;
    if (vol <= 0.0005) continue;
    const lot = (o.lot == null ? '' : String(o.lot)).trim();
    if (!lot) continue;
    const t = o.created_date ? new Date(o.created_date).getTime() : 0;
    const prev = totals.get(lot);
    if (!prev) totals.set(lot, { volume: vol, latest: t });
    else {
      prev.volume = round3(prev.volume + vol);
      if (t > prev.latest) prev.latest = t;
    }
  }
  if (totals.size === 0) return null;

  let bestLot = null;
  let bestVol = -1;
  let bestLatest = -1;
  for (const [lot, info] of totals) {
    if (
      info.volume > bestVol
      || (info.volume === bestVol && info.latest > bestLatest)
      || (info.volume === bestVol && info.latest === bestLatest && (!bestLot || lot.localeCompare(bestLot) > 0))
    ) {
      bestLot = lot;
      bestVol = info.volume;
      bestLatest = info.latest;
    }
  }
  return bestLot;
}

/**
 * Reduce origin volumes proportionally when volume is withdrawn.
 * Last origin absorbs rounding residual so sum(new) === remainingTotal.
 * Returns updated origin objects (same ids); volumes may be 0.
 */
export function reduceContainerOriginsProportionally(origins, withdrawnVolume, decimals = 3) {
  const list = (origins || []).map((o) => ({ ...o }));
  if (list.length === 0) return list;

  const factor = 10 ** decimals;
  const round = (v) => Math.round((Number(v) || 0) * factor) / factor;

  const oldTotal = list.reduce((s, o) => s + (parseFloat(o.volume) || 0), 0);
  const withdrawn = Math.max(0, parseFloat(withdrawnVolume) || 0);
  if (oldTotal <= 0 || withdrawn <= 0) return list;

  const remainingTotal = Math.max(0, round(oldTotal - withdrawn));
  if (remainingTotal <= 0) {
    return list.map((o) => ({ ...o, volume: 0 }));
  }

  const ratio = remainingTotal / oldTotal;
  let allocated = 0;
  for (let i = 0; i < list.length; i++) {
    if (i === list.length - 1) {
      list[i].volume = round(remainingTotal - allocated);
    } else {
      const next = round((parseFloat(list[i].volume) || 0) * ratio);
      list[i].volume = next;
      allocated += next;
    }
  }
  return list;
}

/**
 * Split a withdrawn volume across origins proportionally (for TB destination composition).
 * Returns slices { ...origin fields, volume } summing to withdrawnVolume.
 */
export function sliceOriginsForWithdrawal(origins, withdrawnVolume, decimals = 3) {
  const list = (origins || []).filter((o) => (parseFloat(o.volume) || 0) > 0);
  if (list.length === 0) return [];

  const factor = 10 ** decimals;
  const round = (v) => Math.round((Number(v) || 0) * factor) / factor;
  const oldTotal = list.reduce((s, o) => s + (parseFloat(o.volume) || 0), 0);
  const withdrawn = Math.min(oldTotal, Math.max(0, parseFloat(withdrawnVolume) || 0));
  if (oldTotal <= 0 || withdrawn <= 0) return [];

  const ratio = withdrawn / oldTotal;
  const slices = [];
  let allocated = 0;
  for (let i = 0; i < list.length; i++) {
    let vol;
    if (i === list.length - 1) {
      vol = round(withdrawn - allocated);
    } else {
      vol = round((parseFloat(list[i].volume) || 0) * ratio);
      allocated += vol;
    }
    if (vol > 0) {
      slices.push({
        production_id: list[i].production_id || null,
        op_number: list[i].op_number || null,
        lot: list[i].lot || null,
        volume: vol,
        initial_volume: vol,
      });
    }
  }
  return slices;
}

/** Synthetic origin from legacy container when no ind_composicao_vasilhame rows exist. */
export const legacyOriginFromContainer = (container) => {
  if (!container?.id) return null;
  if (!container.production_id && !container.op_number) return null;
  const vol = parseFloat(container.volume) || 0;
  return {
    id: `legacy:${container.id}`,
    container_id: container.id,
    production_id: container.production_id || null,
    op_number: container.op_number || null,
    lot: container.lot || null,
    volume: vol,
    initial_volume: vol,
    created_date: container.created_date,
    operator: container.operator || null,
    _legacy: true,
  };
};

/**
 * Identity key for merging composition rows of the same OP/lote on one packaging.
 * Prefer production_id; fall back to op_number + lot.
 */
export function originMergeKey(origin) {
  if (!origin) return '';
  const productionId = (origin.production_id == null ? '' : String(origin.production_id)).trim();
  if (productionId) return `p:${productionId}`;
  const op = (origin.op_number == null ? '' : String(origin.op_number)).trim();
  const lot = (origin.lot == null ? '' : String(origin.lot)).trim();
  if (op || lot) return `ol:${op}|${lot}`;
  return '';
}

export function findMatchingOrigin(origins, slice) {
  const key = originMergeKey(slice);
  if (!key) return null;
  return (origins || []).find((o) => !o._legacy && originMergeKey(o) === key) || null;
}

/**
 * Collapse duplicate composition rows for the same OP/lote on one packaging.
 * - Distinct volumes for the same OP are merged (complement / top-up).
 * - Near-identical copies that inflate past the physical container volume are dropped.
 * - Near-identical copies without a reliable container cap are also collapsed to one row.
 */
export function collapseDuplicateOrigins(origins, containerVolume = null) {
  const list = origins || [];
  if (list.length <= 1) return list.map((o) => ({ ...o }));

  const cap = containerVolume != null && Number.isFinite(parseFloat(containerVolume))
    ? parseFloat(containerVolume)
    : null;
  const map = new Map();
  const order = [];

  for (const o of list) {
    const key = originMergeKey(o) || (o.id ? `id:${o.id}` : `row:${order.length}`);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...o });
      order.push(key);
      continue;
    }

    const v1 = parseFloat(prev.volume) || 0;
    const v2 = parseFloat(o.volume) || 0;
    const merged = round3(v1 + v2);
    const nearEqual = Math.abs(v1 - v2) <= Math.max(0.001, Math.max(v1, v2) * 0.001);
    const inflatesPastCap = Number.isFinite(cap) && cap > 0 && merged > round3(cap * 1.01);

    // False duplicate of the same volume (classic double-write of full tank volume)
    if (nearEqual && (inflatesPastCap || !Number.isFinite(cap) || cap <= 0)) {
      continue;
    }

    prev.volume = merged;
    prev.initial_volume = round3(
      (parseFloat(prev.initial_volume) || 0) + (parseFloat(o.initial_volume) || 0)
    );
    if (!prev.production_id && o.production_id) prev.production_id = o.production_id;
    if (!prev.op_number && o.op_number) prev.op_number = o.op_number;
    if (!prev.lot && o.lot) prev.lot = o.lot;
  }

  return order.map((k) => map.get(k));
}

/**
 * Effective origins for a container (DB rows or single legacy synthetic).
 */
export const effectiveOriginsOfContainer = (origins, container) => {
  const fromDb = originsOfContainer(origins, container?.id);
  if (fromDb.length > 0) {
    return collapseDuplicateOrigins(fromDb, container?.volume);
  }
  const legacy = legacyOriginFromContainer(container);
  return legacy ? [legacy] : [];
};

/**
 * Packaging rows for Production View: one virtual line per origin contribution
 * for containers linked to this production (via origins or legacy fields / lot).
 */
export function packagingRowsForProduction(containers, origins, production) {
  if (!production || !containers?.length) return [];

  const lot = (production.lot || '').trim();
  const related = [];
  const seen = new Set();

  for (const c of containers) {
    const cOrigins = effectiveOriginsOfContainer(origins, c);
    const linkedByOrigin = cOrigins.some(
      (o) =>
        (production.id && o.production_id === production.id)
        || (production.op_number && o.op_number === production.op_number)
    );
    const linkedByLegacy =
      (production.id && c.production_id === production.id)
      || (production.op_number && c.op_number === production.op_number)
      || (lot && (c.lot || '').trim() === lot)
      || (production.id && c.id && production.complement_container_id === c.id);

    if (!linkedByOrigin && !linkedByLegacy) continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    related.push(c);
  }

  related.sort((a, b) => {
    const ra = a.registration_id != null && a.registration_id !== '' ? Number(a.registration_id) : NaN;
    const rb = b.registration_id != null && b.registration_id !== '' ? Number(b.registration_id) : NaN;
    const aHasReg = Number.isFinite(ra);
    const bHasReg = Number.isFinite(rb);
    if (aHasReg && bHasReg && ra !== rb) return ra - rb;
    if (aHasReg !== bHasReg) return aHasReg ? -1 : 1;
    const ta = a.created_date ? new Date(a.created_date).getTime() : 0;
    const tb = b.created_date ? new Date(b.created_date).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return String(a.container_number || '').localeCompare(String(b.container_number || ''));
  });

  const rows = [];
  for (const c of related) {
    const cOrigins = effectiveOriginsOfContainer(origins, c);
    if (cOrigins.length === 0) {
      rows.push({
        key: `c:${c.id}`,
        container: c,
        origin: null,
        volume: parseFloat(c.volume) || 0,
        production_id: c.production_id,
        op_number: c.op_number,
        lot: c.lot,
      });
      continue;
    }
    // Show ALL origins of the container so fiscal can select any combination
    for (const o of cOrigins) {
      rows.push({
        key: o.id || `o:${c.id}:${o.production_id || o.op_number}`,
        container: c,
        origin: o,
        volume: parseFloat(o.volume) || 0,
        production_id: o.production_id,
        op_number: o.op_number,
        lot: o.lot,
      });
    }
  }
  return rows;
}

export const originShareKey = (row) => row?.key || containerOriginKey(row?.container, row?.origin);

export function containerOriginKey(container, origin, index = 0) {
  if (origin?.id) return origin.id;
  if (container?.id && origin?.production_id) return `${container.id}|${origin.production_id}`;
  if (container?.id) return `${container.id}|${index}`;
  return `row-${index}`;
}

/** Scale raw_materials_used by origin.volume / production.volume */
export function scaleMaterialsByVolumeRatio(mps, originVolume, productionVolume, decimals = 3) {
  const list = Array.isArray(mps) ? mps : [];
  const ov = parseFloat(originVolume) || 0;
  const pv = parseFloat(productionVolume) || 0;
  if (list.length === 0 || ov <= 0) return [];
  const ratio = pv > 0 ? Math.min(1, ov / pv) : 1;
  const factor = 10 ** decimals;
  const round = (v) => Math.round((Number(v) || 0) * factor) / factor;
  return list.map((mp) => ({
    ...mp,
    qty_fiscal: round((Number(mp.qty_fiscal) || 0) * ratio),
    qty_operational: round((Number(mp.qty_operational) || 0) * ratio),
  }));
}

/** Merge materials from multiple origins (sum by mp_code + stock_id + lot). */
export function mergeScaledMaterials(materialLists, decimals = 3) {
  const factor = 10 ** decimals;
  const round = (v) => Math.round((Number(v) || 0) * factor) / factor;
  const map = new Map();
  for (const list of materialLists || []) {
    for (const mp of list || []) {
      const key = `${mp.mp_code || ''}|${mp.stock_id || ''}|${mp.lot || ''}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, {
          ...mp,
          qty_fiscal: Number(mp.qty_fiscal) || 0,
          qty_operational: Number(mp.qty_operational) || 0,
        });
      } else {
        prev.qty_fiscal += Number(mp.qty_fiscal) || 0;
        prev.qty_operational += Number(mp.qty_operational) || 0;
      }
    }
  }
  return Array.from(map.values()).map((mp) => ({
    ...mp,
    qty_fiscal: round(mp.qty_fiscal),
    qty_operational: round(mp.qty_operational),
  }));
}

/**
 * Build fiscal materials from selected packaging origin rows.
 * productionsById: Map or array of productions.
 */
export function materialsFromOriginRows(selectedRows, productions, decimals = 3) {
  const byId = Array.isArray(productions)
    ? Object.fromEntries(productions.map((p) => [p.id, p]))
    : productions || {};
  const byOp = Array.isArray(productions)
    ? Object.fromEntries(productions.filter((p) => p.op_number).map((p) => [p.op_number, p]))
    : {};

  const lists = [];
  for (const row of selectedRows || []) {
    const prod =
      (row.production_id && byId[row.production_id])
      || (row.op_number && byOp[row.op_number])
      || null;
    if (!prod) continue;
    const mps = parseArr(prod.raw_materials_used);
    lists.push(scaleMaterialsByVolumeRatio(mps, row.volume, prod.volume, decimals));
  }
  return mergeScaledMaterials(lists, decimals);
}

/**
 * Persist proportional reduction for a container after withdrawal.
 * entities: { ContainerOrigin } with update/delete.
 */
export async function applyProportionalOriginReduction(entities, origins, containerId, withdrawnVolume) {
  const current = originsOfContainer(origins, containerId);
  if (current.length === 0) return [];

  const updated = reduceContainerOriginsProportionally(current, withdrawnVolume);
  const ContainerOrigin = entities.ContainerOrigin;
  const result = [];

  for (const o of updated) {
    if (o._legacy) continue;
    const vol = parseFloat(o.volume) || 0;
    if (vol <= 0.0005) {
      await ContainerOrigin.delete(o.id);
    } else {
      const saved = await ContainerOrigin.update(o.id, { volume: vol });
      result.push(saved || o);
    }
  }
  return result;
}

/**
 * Create or merge an origin slice into an existing row with the same OP/lote.
 * Prevents duplicate composition lines for the same production on one container.
 */
export async function upsertOriginFromSlice(entities, containerId, slice, operator, existingOrigins = null) {
  const ContainerOrigin = entities.ContainerOrigin;
  const vol = parseFloat(slice?.volume) || 0;
  if (!containerId || vol <= 0) return null;

  const current = existingOrigins
    ?? (await ContainerOrigin.filter({ container_id: containerId }))
    ?? [];
  const match = findMatchingOrigin(current, slice);

  if (match?.id) {
    const nextVol = round3((parseFloat(match.volume) || 0) + vol);
    const nextInitial = round3(
      (parseFloat(match.initial_volume) || 0) + (parseFloat(slice.initial_volume ?? slice.volume) || 0)
    );
    const saved = await ContainerOrigin.update(match.id, {
      volume: nextVol,
      initial_volume: nextInitial,
      op_number: match.op_number || slice.op_number || null,
      lot: match.lot || slice.lot || null,
      production_id: match.production_id || slice.production_id || null,
      operator: operator || match.operator || null,
    });
    const result = saved || { ...match, volume: nextVol, initial_volume: nextInitial };
    const idx = current.findIndex((o) => o.id === match.id);
    if (idx >= 0) current[idx] = result;
    return result;
  }

  const row = await ContainerOrigin.create({
    container_id: containerId,
    production_id: slice.production_id || null,
    op_number: slice.op_number || null,
    lot: slice.lot || null,
    volume: vol,
    initial_volume: slice.initial_volume ?? vol,
    operator: operator || null,
  });
  if (row) current.push(row);
  return row;
}

/**
 * Create origin rows on a destination container from proportional slices.
 * Same OP/lote on the same packaging is merged into a single composition row.
 */
export async function createOriginsFromSlices(entities, containerId, slices, operator) {
  const existing = (await entities.ContainerOrigin.filter({ container_id: containerId })) || [];
  const created = [];
  for (const slice of slices || []) {
    if ((parseFloat(slice.volume) || 0) <= 0) continue;
    const row = await upsertOriginFromSlice(entities, containerId, slice, operator, existing);
    if (row) created.push(row);
  }
  return created;
}

/**
 * Ensure container has at least one origin row (lazy backfill for envase/TB).
 */
export async function ensureContainerHasOrigin(entities, container, operator) {
  if (!container?.id) return null;
  const existing = await entities.ContainerOrigin.filter({ container_id: container.id });
  if (existing?.length) return existing;
  if (!container.production_id && !container.op_number) return [];
  const vol = parseFloat(container.volume) || 0;
  const row = await entities.ContainerOrigin.create({
    container_id: container.id,
    production_id: container.production_id || null,
    op_number: container.op_number || null,
    lot: container.lot || null,
    volume: vol,
    initial_volume: vol,
    operator: operator || container.operator || null,
  });
  return row ? [row] : [];
}

export { round3 };
