/**
 * Lista os inventários já agrupados (1 objeto virtual por inventário, com items[]).
 * Compatível com o legado (1 row + JSON) e com o modelo pós-058 (1 row por produto).
 */
import { useMemo } from 'react';
import { base44 } from '@industrializacao/api/base44Client';
import { useRealtimeEntity } from '@industrializacao/hooks/useRealtimeEntity';
import { groupInventoryRows } from '@industrializacao/lib/inventoryComposition';

const PAGE_SIZE = 1000;
const MAX_PAGES = 30;

export async function listInventoryRows() {
  const all = [];
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await base44.entities.Inventory.list('-created_date', PAGE_SIZE, {
      offset: page * PAGE_SIZE,
    }) || [];
    for (const row of batch) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      all.push(row);
    }
    if (batch.length < PAGE_SIZE) break;
  }
  return all;
}

export function useInventories() {
  const { data: rows, loading, reload, error } = useRealtimeEntity(
    'Inventory',
    () => listInventoryRows(),
    [],
  );

  const inventories = useMemo(() => groupInventoryRows(rows || []), [rows]);

  return { data: inventories, rows: rows || [], loading, reload, error };
}
