-- Marca de produção na programação do dia (acompanhamento do que resta)
-- Idempotente — pode rodar de novo. Não cria Ordem de Produção.

ALTER TABLE ind_programacao_demanda
  ADD COLUMN IF NOT EXISTS produced BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ind_programacao_demanda
  ADD COLUMN IF NOT EXISTS produced_at TIMESTAMPTZ;

ALTER TABLE ind_programacao_demanda
  ADD COLUMN IF NOT EXISTS produced_by TEXT;

CREATE INDEX IF NOT EXISTS idx_ind_programacao_demanda_produced
  ON ind_programacao_demanda (scheduled_date, produced);

SELECT pg_notify('pgrst', 'reload schema');
