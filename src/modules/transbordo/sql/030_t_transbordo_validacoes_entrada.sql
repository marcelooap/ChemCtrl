-- Transbordo — tipo 'entrada' em t_transbordo_validacoes
-- Recebimentos (embalado/vasilhame) do Painel → Logística aguardam
-- conferência em Transbordo → Validação antes de ir para t_entradas/t_estoque.

alter table t_transbordo_validacoes
  drop constraint if exists t_transbordo_validacoes_tipo_check;

alter table t_transbordo_validacoes
  add constraint t_transbordo_validacoes_tipo_check
  check (tipo in ('granel_transbordo', 'transbordo', 'entrada'));

select pg_notify('pgrst', 'reload schema');
