/**
 * Cadastro CQ (cadastro_analises) — modelo com 1 linha por análise.
 * Agrupa as linhas físicas num objeto virtual com `analyses[]`,
 * no mesmo espírito de recipeComposition.js.
 */
import { callRPC } from '@industrializacao/api/rpcClient';
import { base44 } from '@industrializacao/api/base44Client';

const nameKey = (name) => String(name || '').trim().toLocaleUpperCase('pt-BR');

export function parseAnalysesField(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Linha física pós-051. Objetos já agrupados trazem `_is_grouped`. */
export function isLineModelRow(row) {
  return Boolean(row && !row._is_grouped && row.ensaio_id);
}

function numOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasAnalysisContent(row) {
  if (!row) return false;
  return Boolean(
    String(row.analysis_name || '').trim()
    || String(row.specification || '').trim()
    || numOrNull(row.min_limit) != null
    || numOrNull(row.max_limit) != null,
  );
}

export function rowToAnalysis(row) {
  return {
    analysis_name: row.analysis_name || '',
    methodology: row.methodology || '',
    specification: row.specification || '',
    unit: row.unit || '',
    min_limit: numOrNull(row.min_limit),
    max_limit: numOrNull(row.max_limit),
    linha_ordem: row.linha_ordem != null ? Number(row.linha_ordem) : 1,
    line_id: row.id,
  };
}

function headerFromAnchor(anchor) {
  const header = { ...anchor };
  delete header.analysis_name;
  delete header.methodology;
  delete header.specification;
  delete header.unit;
  delete header.min_limit;
  delete header.max_limit;
  delete header.linha_ordem;
  delete header.analyses;
  return header;
}

/**
 * Agrupa linhas físicas (pós-051) ou devolve o legado (1 row = ensaio, analyses jsonb).
 * `id` do objeto virtual é a linha âncora (linha_ordem 1).
 */
export function groupQualityTestRows(rows) {
  const list = rows || [];
  if (!list.length) return [];

  if (!list.some(isLineModelRow)) {
    return list.map((row) => ({
      ...row,
      analyses: parseAnalysesField(row.analyses),
    }));
  }

  const groups = new Map();
  for (const row of list) {
    if (!isLineModelRow(row)) continue;
    const key = String(row.ensaio_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const result = [];
  for (const [, lines] of groups) {
    const sorted = [...lines].sort(
      (a, b) => (Number(a.linha_ordem) || 0) - (Number(b.linha_ordem) || 0),
    );
    const anchor = sorted[0];
    const fromColumns = sorted.filter(hasAnalysisContent).map(rowToAnalysis);
    const analyses = fromColumns.length
      ? fromColumns
      : parseAnalysesField(anchor.analyses);

    result.push({
      ...headerFromAnchor(anchor),
      id: anchor.id,
      ensaio_id: anchor.ensaio_id,
      registro: anchor.registro != null ? Number(anchor.registro) : null,
      codigo_en: anchor.codigo_en || null,
      analyses,
      _line_ids: sorted.map((line) => line.id),
      _is_grouped: true,
    });
  }

  result.sort((a, b) => {
    const ta = new Date(a.created_date || 0).getTime();
    const tb = new Date(b.created_date || 0).getTime();
    return tb - ta;
  });
  return result;
}

export function formatEnsaioCode(registro) {
  const n = Number(registro);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `EN${String(n).padStart(2, '0')}`;
}

/** ID estável da tela (EN01). Antes da 051, cai no mapa calculado no cliente. */
export function displayEnsaioCode(item, regNumMap = {}) {
  if (item?.codigo_en) return item.codigo_en;
  const fromRegistro = formatEnsaioCode(item?.registro);
  if (fromRegistro) return fromRegistro;
  const n = regNumMap[item?.id] || 0;
  return `EN${String(n).padStart(2, '0')}`;
}

function normalizeAnalyses(analyses) {
  return (analyses || []).map((item) => ({
    analysis_name: String(item?.analysis_name || '').trim(),
    methodology: String(item?.methodology || '').trim(),
    specification: String(item?.specification || '').trim(),
    unit: String(item?.unit || '').trim(),
    min_limit: numOrNull(item?.min_limit),
    max_limit: numOrNull(item?.max_limit),
  })).filter((item) => (
    item.analysis_name
    || item.specification
    || item.min_limit != null
    || item.max_limit != null
  ));
}

/**
 * Grava o ensaio inteiro (cabeçalho repetido + uma linha por análise).
 * @param {'create'|'replace'} mode
 */
export async function salvarEnsaio({
  ensaioId = null,
  header,
  analyses,
  mode = 'replace',
}) {
  return callRPC('cadastro_analises_salvar', {
    p_ensaio_id: ensaioId,
    p_header: header && typeof header === 'object' ? header : {},
    p_analyses: normalizeAnalyses(analyses),
    p_mode: mode,
  });
}

export function isCqEspTecSalvarRpcMissing(err) {
  const msg = String(err?.message || err?.body || err || '');
  return (
    err?.status === 404
    || /PGRST202|Could not find the function|cadastro_analises_salvar/i.test(msg)
  );
}

/**
 * Renomeia / atualiza metodologia e unidade nas linhas do Cadastro CQ.
 * No modelo novo atualiza colunas; no legado, o JSON `analyses`.
 */
export async function propagateAnalysisOnSpecs(rows, originalName, next) {
  const key = nameKey(originalName);
  const physical = rows || [];
  if (physical.some(isLineModelRow)) {
    const matches = physical.filter((row) => isLineModelRow(row) && nameKey(row.analysis_name) === key);
    if (!matches.length) return 0;
    await base44.entities.QualityTest.bulkUpdate(matches.map((row) => ({
      id: row.id,
      analysis_name: next.analysis_name,
      methodology: next.methodology || null,
      unit: next.unit || null,
    })));
    return matches.length;
  }

  const tests = groupQualityTestRows(physical);
  const updates = [];
  for (const test of tests) {
    const analyses = parseAnalysesField(test.analyses);
    let changed = false;
    const nextAnalyses = analyses.map((item) => {
      if (nameKey(item.analysis_name) !== key) return item;
      changed = true;
      return {
        ...item,
        analysis_name: next.analysis_name,
        methodology: next.methodology,
        unit: next.unit,
      };
    });
    if (changed) {
      updates.push(base44.entities.QualityTest.update(test.id, { ...test, analyses: nextAnalyses }));
    }
  }
  if (updates.length) await Promise.all(updates);
  return updates.length;
}

/**
 * Tira uma análise do Cadastro CQ.
 * Se for a última do ensaio, a linha âncora permanece (o produto acabado continua cadastrado).
 */
export async function removeAnalysisFromSpecs(rows, analysisName) {
  const key = nameKey(analysisName);
  const physical = rows || [];
  if (physical.some(isLineModelRow)) {
    const byEnsaio = new Map();
    for (const row of physical) {
      if (!isLineModelRow(row)) continue;
      const id = String(row.ensaio_id);
      if (!byEnsaio.has(id)) byEnsaio.set(id, []);
      byEnsaio.get(id).push(row);
    }

    let touched = 0;
    for (const lines of byEnsaio.values()) {
      const drop = lines.filter((row) => nameKey(row.analysis_name) === key);
      if (!drop.length) continue;
      const keep = lines.filter((row) => nameKey(row.analysis_name) !== key);
      if (!keep.length) {
        const sorted = [...drop].sort(
          (a, b) => (Number(a.linha_ordem) || 0) - (Number(b.linha_ordem) || 0),
        );
        const survivor = sorted[0];
        for (const row of sorted.slice(1)) {
          await base44.entities.QualityTest.delete(row.id);
        }
        await base44.entities.QualityTest.update(survivor.id, {
          analysis_name: null,
          methodology: null,
          specification: null,
          unit: null,
          min_limit: null,
          max_limit: null,
          linha_ordem: 1,
        });
      } else {
        for (const row of drop) {
          await base44.entities.QualityTest.delete(row.id);
        }
      }
      touched += 1;
    }
    return touched;
  }

  const tests = groupQualityTestRows(physical);
  const updates = [];
  for (const test of tests) {
    const analyses = parseAnalysesField(test.analyses);
    const nextAnalyses = analyses.filter((item) => nameKey(item.analysis_name) !== key);
    if (nextAnalyses.length !== analyses.length) {
      updates.push(base44.entities.QualityTest.update(test.id, { ...test, analyses: nextAnalyses }));
    }
  }
  if (updates.length) await Promise.all(updates);
  return updates.length;
}
