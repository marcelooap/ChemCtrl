/**
 * Paginação PostgREST (1000 linhas/página).
 */

export const PAGE_SIZE = 1000;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} table
 * @param {object} [opts]
 * @param {string} [opts.orderBy='id']
 * @param {boolean} [opts.ascending=true]
 * @param {string} [opts.select='*']
 */
export async function fetchAllRows(sb, table, opts = {}) {
  const orderBy = opts.orderBy ?? 'id';
  const ascending = opts.ascending ?? true;
  const select = opts.select ?? '*';
  const rows = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    let q = sb.from(table).select(select);
    if (orderBy) {
      q = q.order(orderBy, { ascending });
    }
    const { data, error } = await q.range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}

/**
 * Contagem exact via head request.
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} table
 */
export async function countRows(sb, table) {
  const { count, error } = await sb
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) {
    throw new Error(`${table} count: ${error.message}`);
  }
  return count ?? 0;
}
