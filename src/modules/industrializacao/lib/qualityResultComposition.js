/**
 * Resultados de CQ (resultados_cq) — 1 linha por análise.
 * Agrupa as linhas físicas num certificado virtual com `results[]`.
 * Antes da 053, cada certificado é uma linha e os ensaios estão em `results` jsonb.
 */
import { callRPC } from '@industrializacao/api/rpcClient';
import { invalidate } from '@industrializacao/lib/queryCache';

export function parseResultsField(raw) {
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

/** Linha física pós-053. Objetos já agrupados trazem `_is_grouped`. */
export function isQualityResultLine(row) {
  return Boolean(row && !row._is_grouped && row.resultado_id);
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
    || String(row.result || '').trim()
    || String(row.specification || '').trim()
    || numOrNull(row.min_limit) != null
    || numOrNull(row.max_limit) != null,
  );
}

export function rowToResultItem(row) {
  return {
    analysis_name: row.analysis_name || '',
    methodology: row.methodology || '',
    specification: row.specification || '',
    unit: row.unit || '',
    min_limit: numOrNull(row.min_limit),
    max_limit: numOrNull(row.max_limit),
    result: row.result ?? '',
    status: row.analysis_status || '—',
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
  delete header.result;
  delete header.analysis_status;
  delete header.linha_ordem;
  delete header.results;
  return header;
}

/**
 * Agrupa linhas físicas (pós-053) ou devolve o legado (1 row = certificado, results jsonb).
 * `id` do objeto virtual é a linha âncora (linha_ordem 1).
 */
export function groupQualityResultRows(rows) {
  const list = rows || [];
  if (!list.length) return [];

  if (!list.some(isQualityResultLine)) {
    return list.map((row) => ({
      ...row,
      results: parseResultsField(row.results),
    }));
  }

  const result = [];
  const groups = new Map();
  for (const row of list) {
    if (!isQualityResultLine(row)) {
      result.push({
        ...row,
        results: parseResultsField(row.results),
      });
      continue;
    }
    const key = String(row.resultado_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const [, lines] of groups) {
    const sorted = [...lines].sort(
      (a, b) => (Number(a.linha_ordem) || 0) - (Number(b.linha_ordem) || 0),
    );
    const anchor = sorted[0];
    const fromColumns = sorted.filter(hasAnalysisContent).map(rowToResultItem);
    const results = fromColumns.length
      ? fromColumns
      : parseResultsField(anchor.results);

    result.push({
      ...headerFromAnchor(anchor),
      id: anchor.id,
      resultado_id: anchor.resultado_id,
      results,
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

function normalizeResultItems(items) {
  return (items || []).map((item) => ({
    analysis_name: String(item?.analysis_name || '').trim(),
    methodology: String(item?.methodology || '').trim(),
    specification: String(item?.specification || '').trim(),
    unit: String(item?.unit || '').trim(),
    min_limit: numOrNull(item?.min_limit),
    max_limit: numOrNull(item?.max_limit),
    result: item?.result == null ? '' : String(item.result),
    status: item?.status == null ? '' : String(item.status),
  })).filter((item) => (
    item.analysis_name
    || item.result
    || item.specification
    || item.min_limit != null
    || item.max_limit != null
  ));
}

/**
 * Grava o certificado inteiro (cabeçalho repetido + uma linha por análise).
 * @param {'create'|'replace'} mode
 */
export async function salvarResultado({
  resultadoId = null,
  header,
  results,
  mode = 'replace',
}) {
  const saved = await callRPC('resultados_cq_salvar', {
    p_resultado_id: resultadoId,
    p_header: header && typeof header === 'object' ? header : {},
    p_results: normalizeResultItems(results),
    p_mode: mode,
  });
  invalidate('QualityResult');
  return saved;
}

export function isResultadoSalvarRpcMissing(err) {
  const msg = String(err?.message || err?.body || err || '');
  return (
    err?.status === 404
    || /PGRST202|Could not find the function|resultados_cq_salvar/i.test(msg)
  );
}
