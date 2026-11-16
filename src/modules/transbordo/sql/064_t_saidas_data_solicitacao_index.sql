-- 064: índice aditivo para ordenação/filtro server-side de t_saidas.data_solicitacao
-- Aplicar somente após EXPLAIN ANALYZE confirmar Seq Scan relevante.
-- Não destrutivo: CREATE INDEX IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_t_saidas_data_solicitacao
  ON public.t_saidas (data_solicitacao DESC NULLS LAST);

-- Opcional: filtro combinado Painel + data (listagens comerciais)
CREATE INDEX IF NOT EXISTS idx_t_saidas_modulo_origem_data_solicitacao
  ON public.t_saidas (modulo_origem, data_solicitacao DESC NULLS LAST);
