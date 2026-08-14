-- Leitura e validação de saídas por módulo (Transbordo vs Industrialização)
-- ============================================================
-- 1) t_saida_leituras.modulo — visualizar no Transbordo não marca
--    como lida na Industrialização (e vice-versa).
-- 2) t_saidas.validacao_modulos — cada módulo valida/baixa só os
--    próprios itens; o status global só fecha quando todos os
--    módulos relevantes tiverem validado.
--
-- Idempotente. Executar no SQL Editor do Supabase.

-- ----------------------------------------------------------------
-- Leituras por usuário + módulo
-- ----------------------------------------------------------------
alter table t_saida_leituras
  add column if not exists modulo text;

update t_saida_leituras
set modulo = 'transbordo'
where modulo is null or btrim(modulo) = '';

alter table t_saida_leituras
  alter column modulo set default 'transbordo';

alter table t_saida_leituras
  alter column modulo set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 't_saida_leituras_modulo_check'
  ) then
    alter table t_saida_leituras
      add constraint t_saida_leituras_modulo_check
      check (modulo in ('transbordo', 'industrializacao'));
  end if;
end $$;

alter table t_saida_leituras
  drop constraint if exists uq_t_saida_leituras_saida_usuario;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_t_saida_leituras_saida_usuario_modulo'
  ) then
    alter table t_saida_leituras
      add constraint uq_t_saida_leituras_saida_usuario_modulo
      unique (saida_id, usuario_id, modulo);
  end if;
end $$;

create index if not exists idx_t_saida_leituras_usuario_modulo
  on t_saida_leituras (usuario_id, modulo);

comment on column t_saida_leituras.modulo is
  'Módulo em que a saída foi visualizada: transbordo | industrializacao.';

-- ----------------------------------------------------------------
-- Validação independente por módulo
-- ----------------------------------------------------------------
alter table t_saidas
  add column if not exists validacao_modulos jsonb not null default '{}'::jsonb;

comment on column t_saidas.validacao_modulos is
  'Estado de validação por módulo, ex.: {"transbordo":{"validado":true},"industrializacao":{"validado":false}}.';
