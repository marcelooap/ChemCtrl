/**
 * Composição de receitas — modelo pós-047 (1 linha por MP por revisão).
 * Agrupa linhas físicas em um objeto virtual com `raw_materials[]` para
 * compatibilidade com telas existentes.
 */
import { callRPC } from '@industrializacao/api/rpcClient';
import { getRevisionNumber } from '@industrializacao/lib/recipeRevisions';

/** Parse legado: array, string JSON ou já agrupado. */
export function parseRawMaterialsField(raw) {
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

export function isLineModelRow(row) {
  return Boolean(
    row &&
      (row.receita_id ||
        (row.mp_code != null && String(row.mp_code).trim() !== '') ||
        (row.linha_ordem != null && Number(row.linha_ordem) > 0 && row.materia_prima_id))
  );
}

export function rowToMpItem(row) {
  return {
    mp_code: row.mp_code || '',
    mp_name: row.mp_name || '',
    mp_density: row.mp_density != null ? Number(row.mp_density) : 1,
    percentage: row.percentage != null ? Number(row.percentage) : 0,
    quantity_kg: row.quantity_kg != null ? Number(row.quantity_kg) : 0,
    controlado: Boolean(row.controlado),
    orgao_regulamentador: row.orgao_regulamentador || null,
    materia_prima_id: row.materia_prima_id || null,
    linha_ordem: row.linha_ordem != null ? Number(row.linha_ordem) : 1,
    line_id: row.id,
  };
}

/**
 * Agrupa linhas físicas (pós-047) OU normaliza linhas legado (1 row = revisão).
 * Retorna objetos com `id` = âncora (linha_ordem 1 / id legado) e `raw_materials[]`.
 */
export function groupRecipeRows(rows) {
  const list = rows || [];
  if (!list.length) return [];

  const anyLineModel = list.some(isLineModelRow);
  if (!anyLineModel) {
    return list.map((r) => ({
      ...r,
      receita_id: r.receita_id || r.id,
      raw_materials: parseRawMaterialsField(r.raw_materials),
    }));
  }

  const groups = new Map();
  for (const row of list) {
    const receitaId = row.receita_id || row.id;
    const rev = getRevisionNumber(row);
    const key = `${receitaId}::${rev}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const result = [];
  for (const [, lines] of groups) {
    const sorted = [...lines].sort(
      (a, b) => (Number(a.linha_ordem) || 0) - (Number(b.linha_ordem) || 0)
    );
    const anchor = sorted[0];
    const mpsFromCols = sorted
      .filter((l) => String(l.mp_code || '').trim() && String(l.mp_name || '').trim())
      .map(rowToMpItem);

    const rawMaterials =
      mpsFromCols.length > 0
        ? mpsFromCols
        : parseRawMaterialsField(anchor.raw_materials);

    result.push({
      ...anchor,
      id: anchor.id,
      receita_id: anchor.receita_id || anchor.id,
      revision_number: getRevisionNumber(anchor),
      raw_materials: rawMaterials,
      _line_ids: sorted.map((l) => l.id),
      _is_grouped: true,
    });
  }

  return result;
}

/** Encontra a revisão virtual cujo id âncora ou alguma linha = recipeId. */
export function findRevisionByAnchorId(groupedRecipes, recipeId) {
  if (recipeId == null || recipeId === '') return null;
  const id = String(recipeId);
  return (
    (groupedRecipes || []).find(
      (r) =>
        String(r.id) === id ||
        (Array.isArray(r._line_ids) && r._line_ids.some((x) => String(x) === id))
    ) || null
  );
}

/**
 * Salva revisão via RPC atômica.
 * @param {'create'|'replace'|'new_revision'} mode
 */
export async function salvarRevisaoReceita({
  receitaId = null,
  revisionNumber = 1,
  header,
  rawMaterials,
  mode = 'replace',
}) {
  const mps = (rawMaterials || []).map((m) => ({
    mp_code: m.mp_code || '',
    mp_name: m.mp_name || '',
    mp_density: m.mp_density,
    percentage: m.percentage,
    quantity_kg: m.quantity_kg,
    controlado: Boolean(m.controlado),
    orgao_regulamentador: m.controlado ? m.orgao_regulamentador || null : null,
  }));

  const result = await callRPC('receitas_salvar_revisao', {
    p_receita_id: receitaId,
    p_revision_number: revisionNumber,
    p_header: header && typeof header === 'object' ? header : {},
    p_mps: mps,
    p_mode: mode,
  });
  return result;
}

export function isReceitasSalvarRpcMissing(err) {
  const msg = String(err?.message || err?.body || err || '');
  return (
    err?.status === 404 ||
    /PGRST202|Could not find the function|receitas_salvar_revisao/i.test(msg)
  );
}
