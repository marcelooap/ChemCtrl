-- Momento do último lançamento de resultado SAE.
-- A aba Analisado ordena por este instante (mais recente primeiro).
-- Alinhamentos de volume/produto não mexem nesta coluna.
-- Idempotente: pode rodar mais de uma vez com segurança.
-- Execute no: Supabase Dashboard → SQL Editor

alter table t_filtracoes
  add column if not exists resultado_lancado_em timestamptz;

comment on column t_filtracoes.resultado_lancado_em is
  'Último lançamento de resultado SAE. Ordena a aba Analisado da Filtração.';

create index if not exists idx_t_filtracoes_resultado_lancado_em
  on t_filtracoes (resultado_lancado_em desc nulls last);

update t_filtracoes
set resultado_lancado_em = updated_at
where sae is not null
  and resultado_lancado_em is null;
