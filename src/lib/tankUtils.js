/**
 * ChemCtrl - Tanka stock management
 *
 * Remove volumes/massas de uma tanka quando ela recebe
 * um vasilhame do tipo Tankagem.
 */

import { createSupabaseEntities } from '@/api/supabaseClient';

const entities = createSupabaseEntities();

const parseArr = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Zera entradas de tanque no estoque de matéria-prima.
 *
 * @param {string} tankaName
 */
export async function zeroOutTankaStock(tankaName) {
  if (!tankaName) return;

  const stockEntries = await entities.RawMaterialStock.list('-created_date', 500);

  for (const stock of stockEntries || []) {
    const entries = parseArr(stock.tank_entries);
    let modified = false;

    const updated = entries.map((te) => {
      if (
        te.tank_name === tankaName &&
        (Number(te.volume) > 0 || Number(te.mass) > 0)
      ) {
        modified = true;
        return { ...te, volume: 0, mass: 0 };
      }
      return te;
    });

    if (modified) {
      await entities.RawMaterialStock.update(stock.id, { tank_entries: updated });
    }
  }
}
