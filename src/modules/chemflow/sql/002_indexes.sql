-- ChemFlow — Supabase Projeto B — Índices
-- Cobre os padrões de filtro/ordenação observados nas telas legadas
-- (list('-created_date'), deleteMany por FK, filtros client-side por status).

-- produtos
create index if not exists idx_produtos_cliente_id on produtos (cliente_id);
create index if not exists idx_produtos_codigo on produtos (codigo);

-- isotanques
create index if not exists idx_isotanques_produto_id on isotanques (produto_id);
create index if not exists idx_isotanques_cliente_id on isotanques (cliente_id);
create index if not exists idx_isotanques_codigo_itku on isotanques (codigo_itku);

-- entradas
create index if not exists idx_entradas_created_at on entradas (created_at desc);
create index if not exists idx_entradas_cliente_id on entradas (cliente_id);
create index if not exists idx_entradas_produto_id on entradas (produto_id);
create index if not exists idx_entradas_origem on entradas (origem);
create index if not exists idx_entradas_comunicacao_enviada on entradas (comunicacao_enviada);
create index if not exists idx_entradas_grupo_entrada on entradas (grupo_entrada);

-- estoque
create index if not exists idx_estoque_entrada_id on estoque (entrada_id);
create index if not exists idx_estoque_produto_id on estoque (produto_id);
create index if not exists idx_estoque_cliente_id on estoque (cliente_id);
create index if not exists idx_estoque_lote on estoque (lote);
create index if not exists idx_estoque_status_wms on estoque (status_wms);
create index if not exists idx_estoque_saldo_atual on estoque (saldo_atual);

-- transbordos
create index if not exists idx_transbordos_created_at on transbordos (created_at desc);
create index if not exists idx_transbordos_cliente_id on transbordos (cliente_id);
create index if not exists idx_transbordos_produto_id on transbordos (produto_id);
create index if not exists idx_transbordos_codigo on transbordos (codigo_transbordo);

-- vasilhames
create index if not exists idx_vasilhames_created_at on vasilhames (created_at desc);
create index if not exists idx_vasilhames_transbordo_id on vasilhames (transbordo_id);
create index if not exists idx_vasilhames_status on vasilhames (status);
create index if not exists idx_vasilhames_placa on vasilhames (placa);
create index if not exists idx_vasilhames_produto_id on vasilhames (produto_id);
create index if not exists idx_vasilhames_cliente_id on vasilhames (cliente_id);
create index if not exists idx_vasilhames_origem on vasilhames (origem);

-- saidas
create index if not exists idx_saidas_created_at on saidas (created_at desc);
create index if not exists idx_saidas_status on saidas (status);
create index if not exists idx_saidas_cliente_id on saidas (cliente_id);
create index if not exists idx_saidas_data_programada on saidas (data_programada);
create index if not exists idx_saidas_enviado_ao_fiscal on saidas (enviado_ao_fiscal);

-- Índices GIN para consultas eventuais dentro dos campos jsonb.
create index if not exists idx_entradas_lotes_gin on entradas using gin (lotes);
create index if not exists idx_estoque_lotes_gin on estoque using gin (lotes);
create index if not exists idx_transbordos_origens_gin on transbordos using gin (origens);
create index if not exists idx_transbordos_destinos_gin on transbordos using gin (destinos);
create index if not exists idx_saidas_itens_gin on saidas using gin (itens);
