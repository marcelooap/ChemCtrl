/**
 * Upsert em lotes no target (idempotente).
 */

export const BATCH_SIZE = 200;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} table
 * @param {object[]} rows
 * @param {object} [opts]
 * @param {string} [opts.onConflict='id']
 * @param {boolean} [opts.ignoreDuplicates=true]
 * @param {number} [opts.batchSize]
 */
export async function upsertBatch(sb, table, rows, opts = {}) {
  if (!rows.length) {
    console.log(`  ${table}: 0 rows (skip)`);
    return { inserted: 0 };
  }

  const onConflict = opts.onConflict ?? 'id';
  const ignoreDuplicates = opts.ignoreDuplicates ?? true;
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await sb.from(table).upsert(batch, {
      onConflict,
      ignoreDuplicates,
    });
    if (error) {
      throw new Error(
        `${table} upsert [${i}..${i + batch.length}): ${error.message}`
      );
    }
    inserted += batch.length;
  }

  console.log(`  ${table}: ${inserted} row(s) upserted`);
  return { inserted };
}
