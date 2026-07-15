import { containerLiveNetWeight } from '@/lib/productionViewUtils';

const roundTo = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
};

/** Stable key for a container row (matches table identity when id is missing). */
export const containerShareKey = (container, index = 0) =>
  container?.id
  || `${container?.container_number || ''}|${container?.barril_number || ''}|${container?.registration_id ?? index}`;

/**
 * Allocates each MP quantity across all containers by live net weight.
 * For each qty field, containers 1..N-1 get rounded shares; the last absorbs residual
 * so the sum of all tank reports equals the OP totals exactly (at `decimals` precision).
 *
 * @returns {{ totalNet: number, perContainer: Array<{ key: string, net: number, shares: Array<{ qty_fiscal: number, qty_operational: number }> }> }}
 */
export function allocateMpQuantitiesByNetWeight(mps, containers, production, recipes = [], decimals = 3) {
  const list = Array.isArray(mps) ? mps : [];
  const pkgs = Array.isArray(containers) ? containers : [];

  const weights = pkgs.map((c, i) => ({
    key: containerShareKey(c, i),
    net: containerLiveNetWeight(c, production, recipes),
  }));
  const totalNet = weights.reduce((s, w) => s + w.net, 0);

  const perContainer = weights.map((w) => ({
    key: w.key,
    net: w.net,
    shares: list.map(() => ({ qty_fiscal: 0, qty_operational: 0 })),
  }));

  if (pkgs.length === 0 || list.length === 0 || totalNet <= 0) {
    return { totalNet, perContainer };
  }

  for (let mpIdx = 0; mpIdx < list.length; mpIdx++) {
    const mp = list[mpIdx];
    for (const field of ['qty_fiscal', 'qty_operational']) {
      const totalQty = Number(mp[field]) || 0;
      let allocated = 0;
      for (let i = 0; i < perContainer.length; i++) {
        if (i === perContainer.length - 1) {
          perContainer[i].shares[mpIdx][field] = roundTo(totalQty - allocated, decimals);
        } else {
          const share = roundTo(totalQty * (weights[i].net / totalNet), decimals);
          perContainer[i].shares[mpIdx][field] = share;
          allocated += share;
        }
      }
    }
  }

  return { totalNet, perContainer };
}

/**
 * Sums allocated shares for selected containers into materials shaped like raw_materials_used.
 * `allContainers` must be the same ordered list used in allocateMpQuantitiesByNetWeight.
 */
export function aggregateAllocatedMaterials(mps, allocation, selectedContainers, allContainers = []) {
  const list = Array.isArray(mps) ? mps : [];
  const all = Array.isArray(allContainers) ? allContainers : [];

  const keys = new Set();
  for (const sc of selectedContainers || []) {
    const idx = all.findIndex((c) =>
      (sc.id && c.id === sc.id)
      || (
        c.container_number === sc.container_number
        && (c.registration_id ?? null) === (sc.registration_id ?? null)
        && (c.barril_number || '') === (sc.barril_number || '')
      )
    );
    keys.add(containerShareKey(sc, idx >= 0 ? idx : 0));
  }

  const rows = (allocation?.perContainer || []).filter((row) => keys.has(row.key));

  return list.map((mp, mpIdx) => {
    const qty_fiscal = rows.reduce((s, row) => s + (row.shares[mpIdx]?.qty_fiscal || 0), 0);
    const qty_operational = rows.reduce((s, row) => s + (row.shares[mpIdx]?.qty_operational || 0), 0);
    return {
      ...mp,
      qty_fiscal: roundTo(qty_fiscal, 3),
      qty_operational: roundTo(qty_operational, 3),
    };
  });
}
