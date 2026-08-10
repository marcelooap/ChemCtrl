import { useCallback, useEffect, useMemo, useState } from 'react';
import { base44 } from '@industrializacao/api/base44Client';

const normalizeName = (name) => (name || '').trim();
const nameKey = (name) => normalizeName(name).toLocaleUpperCase('pt-BR');

const isActiveValue = (value) => value !== false && value !== 'false' && value !== 0;

/**
 * Catalog of analyses from Lista de Ensaios (quality_analyses),
 * with fallback to unique analyses already used in Cadastro CQ.
 * Combobox options include only analyses marked as active (Em uso).
 */
export function useQualityAnalysisCatalog(tests = []) {
  const [catalog, setCatalog] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await base44.entities.QualityAnalysis.list('analysis_name', 500);
        if (!cancelled) setCatalog(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setCatalog([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const entries = useMemo(() => {
    const map = new Map();

    for (const row of catalog) {
      const analysisName = normalizeName(row.analysis_name);
      if (!analysisName) continue;
      map.set(nameKey(analysisName), {
        analysis_name: analysisName,
        methodology: normalizeName(row.methodology),
        unit: normalizeName(row.unit),
        is_active: isActiveValue(row.is_active),
      });
    }

    for (const test of tests) {
      for (const analysis of test.analyses || []) {
        const analysisName = normalizeName(analysis.analysis_name);
        if (!analysisName) continue;
        const key = nameKey(analysisName);
        const existing = map.get(key);
        if (!existing) {
          map.set(key, {
            analysis_name: analysisName,
            methodology: normalizeName(analysis.methodology),
            unit: normalizeName(analysis.unit),
            is_active: true,
          });
          continue;
        }
        if (!existing.methodology && analysis.methodology) {
          existing.methodology = normalizeName(analysis.methodology);
        }
        if (!existing.unit && analysis.unit) {
          existing.unit = normalizeName(analysis.unit);
        }
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.analysis_name.localeCompare(b.analysis_name, 'pt-BR'),
    );
  }, [catalog, tests]);

  const byName = useMemo(() => {
    const map = new Map();
    for (const entry of entries) {
      map.set(nameKey(entry.analysis_name), entry);
    }
    return map;
  }, [entries]);

  const options = useMemo(
    () => entries
      .filter((entry) => entry.is_active !== false)
      .map((entry) => ({
        value: entry.analysis_name,
        label: entry.analysis_name,
        item: entry,
      })),
    [entries],
  );

  const findByName = useCallback((name) => {
    if (!normalizeName(name)) return null;
    return byName.get(nameKey(name)) || null;
  }, [byName]);

  return { entries, options, findByName };
}
