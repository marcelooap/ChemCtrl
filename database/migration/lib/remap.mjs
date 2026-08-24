/**
 * Transformações de linha: timestamps e FKs text → uuid.
 */

/**
 * Renomeia created_date/updated_date → created_at/updated_at e remove as antigas.
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function renameTimestamps(row) {
  const out = { ...row };
  if ('created_date' in out) {
    out.created_at = out.created_date ?? out.created_at ?? null;
    delete out.created_date;
  }
  if ('updated_date' in out) {
    out.updated_at = out.updated_date ?? out.updated_at ?? null;
    delete out.updated_date;
  }
  return out;
}

/**
 * Aplica mapa old→new em campos. Null/undefined/ausente no mapa → null.
 * @param {Record<string, unknown>} row
 * @param {Record<string, string>} map
 * @param {string[]} fields
 * @param {object} [opts]
 * @param {boolean} [opts.required=false]  se true e valor presente sem mapa → erro
 * @param {string} [opts.context='']
 */
export function applyRemap(row, map, fields, opts = {}) {
  const out = { ...row };
  for (const field of fields) {
    const oldVal = out[field];
    if (oldVal == null || oldVal === '') {
      out[field] = null;
      continue;
    }
    const key = String(oldVal);
    const mapped = map[key];
    if (!mapped) {
      if (opts.required) {
        throw new Error(
          `${opts.context || 'remap'}: ${field}=${key} sem entrada no mapa`
        );
      }
      out[field] = null;
      continue;
    }
    out[field] = mapped;
  }
  return out;
}

/**
 * Substitui id pelo new_id do mapa (obrigatório).
 * @param {Record<string, unknown>} row
 * @param {Record<string, string>} map
 * @param {string} [context]
 */
export function remapPrimaryKey(row, map, context = 'pk') {
  const oldId = String(row.id);
  const newId = map[oldId];
  if (!newId) {
    throw new Error(`${context}: id origem ${oldId} sem mapa`);
  }
  return { ...row, id: newId };
}

/**
 * Pipeline: timestamps + PK remap + FK remaps.
 * @param {Record<string, unknown>} row
 * @param {object} cfg
 * @param {Record<string, string>} cfg.idMap
 * @param {Array<{ map: Record<string, string>, fields: string[], required?: boolean }>} [cfg.fks]
 * @param {string} [cfg.context]
 * @param {(row: Record<string, unknown>) => Record<string, unknown>} [cfg.transform]
 */
export function transformIndRow(row, cfg) {
  let out = renameTimestamps(row);
  out = remapPrimaryKey(out, cfg.idMap, cfg.context);
  for (const fk of cfg.fks || []) {
    out = applyRemap(out, fk.map, fk.fields, {
      required: fk.required ?? false,
      context: cfg.context,
    });
  }
  if (cfg.transform) {
    out = cfg.transform(out);
  }
  return out;
}

/**
 * Pick only columns that exist on target (intersection with allowlist).
 * @param {Record<string, unknown>} row
 * @param {string[]} columns
 */
export function pickColumns(row, columns) {
  const out = {};
  for (const col of columns) {
    if (col in row) out[col] = row[col];
  }
  return out;
}
