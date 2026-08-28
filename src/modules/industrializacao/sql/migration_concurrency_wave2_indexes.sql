-- ============================================================================
-- Onda 2 — Índices de FK e ordenação faltantes
-- Idempotente e tolerante a colunas/tabelas ausentes.
-- Sem CONCURRENTLY (SQL Editor do Supabase usa transação).
-- ============================================================================

CREATE OR REPLACE FUNCTION _chemctrl_create_index_if_cols(
  p_index_name text,
  p_table text,
  p_columns text[],  -- ex.: ARRAY['status','created_date']
  p_extra text DEFAULT ''  -- ex.: 'DESC NULLS LAST' aplicado só à última, ou WHERE ...
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_col text;
  v_def text;
BEGIN
  IF to_regclass('public.' || p_table) IS NULL THEN
    RAISE NOTICE 'skip %: tabela % inexistente', p_index_name, p_table;
    RETURN;
  END IF;

  FOREACH v_col IN ARRAY p_columns
  LOOP
    -- remove DESC/ASC/NULLS do nome da coluna para checagem
    v_col := lower(trim(regexp_replace(v_col, '\s+(desc|asc|nulls\s+(first|last)).*$', '', 'i')));
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = p_table
        AND column_name = v_col
    ) THEN
      RAISE NOTICE 'skip %: coluna %.% inexistente', p_index_name, p_table, v_col;
      RETURN;
    END IF;
  END LOOP;

  v_def := format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (%s) %s',
    p_index_name,
    p_table,
    array_to_string(p_columns, ', '),
    COALESCE(p_extra, '')
  );
  EXECUTE v_def;
END;
$$;

-- Produções
SELECT _chemctrl_create_index_if_cols(
  'idx_ind_lista_producoes_created_date',
  'ind_lista_producoes',
  ARRAY['created_date DESC NULLS LAST']
);

SELECT _chemctrl_create_index_if_cols(
  'idx_ind_lista_producoes_status_created',
  'ind_lista_producoes',
  ARRAY['status', 'created_date DESC NULLS LAST']
);

SELECT _chemctrl_create_index_if_cols(
  'idx_ind_lista_producoes_client',
  'ind_lista_producoes',
  ARRAY['client']
);

SELECT _chemctrl_create_index_if_cols(
  'idx_ind_lista_producoes_lot',
  'ind_lista_producoes',
  ARRAY['lot']
);

-- Pedidos: coluna é "client" (texto), NÃO client_id
SELECT _chemctrl_create_index_if_cols(
  'idx_ind_lista_pedidos_client',
  'ind_lista_pedidos',
  ARRAY['client']
);

SELECT _chemctrl_create_index_if_cols(
  'idx_ind_lista_pedidos_created',
  'ind_lista_pedidos',
  ARRAY['created_date DESC NULLS LAST']
);

-- Estoque MP
SELECT _chemctrl_create_index_if_cols(
  'idx_ind_estoque_mp_client_lot',
  'ind_estoque_mp',
  ARRAY['client', 'lot']
);

SELECT _chemctrl_create_index_if_cols(
  'idx_ind_estoque_mp_status_expiry',
  'ind_estoque_mp',
  ARRAY['status_wms', 'expiry_date']
);

-- CQ
SELECT _chemctrl_create_index_if_cols(
  'idx_ind_cq_resultados_prod_created',
  'ind_cq_resultados',
  ARRAY['production_id', 'created_date DESC NULLS LAST']
);

-- Vasilhames / transbordo ind
SELECT _chemctrl_create_index_if_cols(
  'idx_ind_lista_vasilhames_production',
  'ind_lista_vasilhames',
  ARRAY['production_id']
);

SELECT _chemctrl_create_index_if_cols(
  'idx_ind_transbordo_ind_production',
  'ind_transbordo_ind',
  ARRAY['production_id']
);

-- Transbordo (t_*)
SELECT _chemctrl_create_index_if_cols(
  'idx_t_estoque_cliente_status',
  't_estoque',
  ARRAY['cliente_id', 'status_wms'],
  'WHERE saldo_atual > 0'
);

SELECT _chemctrl_create_index_if_cols(
  'idx_t_saidas_status_data',
  't_saidas',
  ARRAY['status', 'data_programada DESC NULLS LAST']
);

DROP FUNCTION IF EXISTS _chemctrl_create_index_if_cols(text, text, text[], text);

SELECT pg_notify('pgrst', 'reload schema');
