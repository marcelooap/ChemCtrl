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
  // raw_materials_used é necessário na lista: visualizar e cancelar OP usam o
  // registro da listagem; sem ele as MPs somem e o estoque não é devolvido.
  // volume_apontado/volume_pendente: necessários para isComplementPending (badge + ícone PackagePlus).
  Production: 'id,created_date,updated_date,op_number,product,client,lot,status,volume,density,mass,order_id,client_order,recipe_id,recipe_revision,end_time,invoiced,fractional_supply,complement_status,volume_apontado,volume_pendente,packaging_type,packaging_info,unit_price,total_value,raw_materials_used,public_token',
  RawMaterialStock: 'id,created_date,updated_date,entry_id,mp_code,mp_name,client,lot,current_stock,unit,status_wms,expiry_date',
  Container: 'id,created_date,op_number,production_id,container_number,product,volume,status,packaging_type,lot,net_weight,mass',
  Recipe: 'id,created_date,product_name,revision_number,client,status,price,density',
  Order: 'id,created_date,order_number,client,client_id,status,client_order,volume,priority',
  // ChemFlow / Transbordo
  t_clientes: 'id,nome,created_at',
  t_saidas:
    'id,created_at,codigo,data_solicitacao,data_programada,cliente_id,cliente_nome,status,modulo_origem,itens,validacao_modulos,enviado_ao_fiscal,destino,pedido_cliente,observacoes,quantidade_total,usuario_criador,usuario_responsavel',
  t_vasilhames:
    'id,created_at,codigo,cliente_id,cliente_nome,produto_id,produto_nome,status,volume,massa,densidade,lote,composicao,transbordo_id,placa,fracionado,capacidade,tipo',
  t_transbordos:
    'id,created_at,data,produto_id,produto_nome,cliente_id,cliente_nome,status,densidade,volume_total,massa_total,origens,destinos,operadores,lote',
  // Colunas reais de t_agendamentos_carregamento (saida_id singular; destino vem de t_saidas).
  t_agendamentos_carregamento:
    'id,created_at,updated_at,data,horario,hora_carregamento,data_carregamento,status,saida_id,saida_codigo,cliente_nome,placa,motorista,transportadora,checklist_respostas,grupo_conclusao_id,operador_conclusao_nome,usuario_nome,justificativa_atraso_responsavel,justificativa_atraso_motivo',
};
