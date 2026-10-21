/**
 * Lista os certificados de CQ já agrupados (1 objeto virtual por resultado, com results[]).
 * Compatível com o legado (1 row + JSON) e com o modelo pós-053 (1 row por análise).
 */
import { useMemo } from 'react';
import { base44 } from '@industrializacao/api/base44Client';
import { useRealtimeEntity } from '@industrializacao/hooks/useRealtimeEntity';
import { groupQualityResultRows } from '@industrializacao/lib/qualityResultComposition';

const PAGE_SIZE = 1000;
const MAX_PAGES = 30;

export async function listQualityResultRows() {
  const all = [];
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await base44.entities.QualityResult.list('-created_date', PAGE_SIZE, {
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

export function useQualityResults() {
  const { data: rows, loading, reload, error } = useRealtimeEntity(
    'QualityResult',
    () => listQualityResultRows(),
    [],
  );

  const results = useMemo(() => groupQualityResultRows(rows || []), [rows]);

  return { data: results, rows: rows || [], loading, reload, error };
}
