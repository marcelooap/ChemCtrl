-- Industrialização — fila de validação de recebimento (embalado/vasilhame)
-- Origem: Painel → Logística → Recebimento (destino Industrialização).
-- Após Validar, o material é gravado em ind_estoque_mp.

create extension if not exists "pgcrypto";

create sequence if not exists ind_validacoes_numero_seq;

create table if not exists ind_validacoes (
  id text primary key default gen_random_uuid()::text,
  numero integer not null unique default nextval('ind_validacoes_numero_seq'),
  tipo text not null default 'entrada'
    check (tipo in ('entrada')),
  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'validado')),
  data date not null default current_date,
  cliente_nome text,
  produto_nome text,
  produto_codigo text,
  lote text,
  quantidade numeric,
  unidade_medida text,
  origem_tipo text,
  entrada_payload jsonb,
  estoque_mp_ids jsonb,
  criado_por_id text,
  criado_por_nome text,
  validado_por_id text,
  validado_por_nome text,
  validado_em timestamptz,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

alter sequence ind_validacoes_numero_seq owned by ind_validacoes.numero;

drop trigger if exists update_updated_date_ind_validacoes on ind_validacoes;
create trigger update_updated_date_ind_validacoes
  before update on ind_validacoes
  for each row execute function update_updated_date();

create index if not exists idx_ind_validacoes_status on ind_validacoes (status);
create index if not exists idx_ind_validacoes_created on ind_validacoes (created_date desc);

alter table ind_validacoes enable row level security;
drop policy if exists allow_all_ind_validacoes on ind_validacoes;
create policy allow_all_ind_validacoes on ind_validacoes
  for all using (true) with check (true);

select pg_notify('pgrst', 'reload schema');
