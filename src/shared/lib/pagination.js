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
  Production: 'id,created_date,updated_date,op_number,product,client,lot,status,volume,density,mass,order_id,client_order,recipe_id,end_time,invoiced,fractional_supply,complement_status,packaging_type,packaging_info,unit_price,total_value',
  RawMaterialStock: 'id,created_date,updated_date,entry_id,mp_code,mp_name,client,lot,current_stock,unit,status_wms,expiry_date',
  Container: 'id,created_date,op_number,production_id,container_number,product,volume,status,packaging_type,lot,net_weight,mass',
  Recipe: 'id,created_date,product_name,revision_number,client,status,price,density',
  Order: 'id,created_date,order_number,client,client_id,status,client_order,volume,priority',
  // ChemFlow / Transbordo
  t_clientes: 'id,nome,created_at',
  t_saidas:
    'id,created_at,data_solicitacao,data_programada,cliente_id,cliente_nome,status,modulo_origem,itens,validacao_modulos,enviado_ao_fiscal,destino,observacao,tipo',
  t_vasilhames:
    'id,created_at,codigo,cliente_id,cliente_nome,produto_id,produto_nome,status,volume,massa,densidade,lote,composicao,transbordo_id,placa,fracionado,capacidade,tipo',
  t_transbordos:
    'id,created_at,data,produto_id,produto_nome,cliente_id,cliente_nome,status,densidade,volume_total,massa_total,origens,destinos,operadores,lote',
  t_agendamentos_carregamento:
    'id,created_at,data,hora_carregamento,status,saida_ids,cliente_nome,destino,placa,motorista,transportadora,checklist,grupo_conclusao_id',
};
