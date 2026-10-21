/**
 * Lista o Cadastro CQ já agrupado (1 objeto virtual por ensaio, com analyses[]).
 * Compatível com o legado (1 row + JSON) e com o modelo pós-051 (1 row por análise).
 */
import { useMemo } from 'react';
import { base44 } from '@industrializacao/api/base44Client';
import { useRealtimeEntity } from '@industrializacao/hooks/useRealtimeEntity';
import { groupQualityTestRows } from '@industrializacao/lib/qualitySpecComposition';

export const QUALITY_TEST_LIST_LIMIT = 2000;

export async function listQualityTestsGrouped(sort = '-created_date', limit = QUALITY_TEST_LIST_LIMIT) {
  const rows = await base44.entities.QualityTest.list(sort, limit);
  return groupQualityTestRows(rows || []);
}

export function useQualityTests(sort = '-created_date', limit = QUALITY_TEST_LIST_LIMIT) {
  const { data: rows, loading, reload, error } = useRealtimeEntity(
    'QualityTest',
    () => base44.entities.QualityTest.list(sort, limit),
    [sort, limit],
    (row) => row,
  );

  const tests = useMemo(() => groupQualityTestRows(rows || []), [rows]);

  return { data: tests, rows: rows || [], loading, reload, error };
}
