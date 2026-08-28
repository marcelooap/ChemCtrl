/**
 * Helpers de paginação / projeção para listagens.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function clampPageSize(size, fallback = DEFAULT_PAGE_SIZE) {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_PAGE_SIZE, Math.floor(n));
}

/**
 * Calcula range PostgREST (from, to) inclusivo.
 */
export function pageRange(page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const size = clampPageSize(pageSize);
  const p = Math.max(1, Number(page) || 1);
  const from = (p - 1) * size;
  const to = from + size - 1;
  return { from, to, page: p, pageSize: size };
}

/** Colunas mínimas comuns para listagens (evitar select *). */
export const LIST_PROJECTIONS = {
  Production: 'id,created_date,updated_date,op_number,product,client,lot,status,volume,density,order_id,client_order,recipe_id,end_time,invoiced,fractional_supply,complement_status',
  RawMaterialStock: 'id,created_date,updated_date,entry_id,mp_code,mp_name,client,lot,current_stock,unit,status_wms,expiry_date',
  Container: 'id,created_date,op_number,production_id,container_number,product,volume,status,packaging_type,lot,net_weight',
  Recipe: 'id,created_date,product_name,revision_number,client,status,price,density',
  Order: 'id,created_date,order_number,client,client_id,status,client_order,volume,priority',
};
