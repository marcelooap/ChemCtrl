import { base44 } from '@/api/base44Client';

const parseArr = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

/**
 * When a vasilhame (container) of type "Tankagem" is registered to a tanka,
 * zero out the raw material stock entries' tank_entries for that tanka.
 * This ensures there's never more than one product in the same tanka.
 */
export async function zeroOutTankaStock(tankaName) {
  if (!tankaName) return;
  const stockEntries = await base44.entities.RawMaterialStock.list('-created_date', 500);
  for (const stock of stockEntries) {
    const entries = parseArr(stock.tank_entries);
    let modified = false;
    const updated = entries.map(te => {
      if (te.tank_name === tankaName && (te.volume > 0 || te.mass > 0)) {
        modified = true;
        return { ...te, volume: 0, mass: 0 };
      }
      return te;
    });
    if (modified) {
      await base44.entities.RawMaterialStock.update(stock.id, { tank_entries: updated });
    }
  }
}
