-- Transbordo / Painel Comercial — Reservas de material
-- ============================================================
-- Tabela de reservas comerciais sobre o estoque do Transbordo.
-- O saldo_atual em t_estoque NÃO é alterado; a reserva é um hold comercial.
-- Executar no SQL Editor do Supabase do ChemFlow.
--
-- usuario_id / removido_por_id são TEXT porque o ID do usuário vem da
-- plataforma ChemCtrl (não é UUID do ChemFlow).

create extension if not exists "pgcrypto";

create or replace function t_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists t_material_reservas (
  id uuid primary key default gen_random_uuid(),
  -- Chave de agregação (cliente + produto + lote + unidade)
  chave text not null,
  cliente_id uuid,
  cliente_nome text,
  produto_id uuid,
  produto_codigo text not null default '',
  produto_nome text,
  lote text not null default '',
  unidade_medida text not null default 'kg',
  -- Quantidade sempre positiva na unidade do produto
  quantidade numeric not null check (quantidade > 0),
  status text not null default 'ativa' check (status in ('ativa', 'removida')),
  -- Auditoria de criação (ID do usuário da plataforma ChemCtrl)
  usuario_id text,
  usuario_nome text,
  observacao text,
  -- Auditoria de remoção / redução
  removido_em timestamptz,
  removido_por_id text,
  removido_por_nome text,
  motivo_remocao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists t_material_reservas_set_updated_at on t_material_reservas;
create trigger t_material_reservas_set_updated_at
  before update on t_material_reservas
  for each row execute function t_set_updated_at();

create index if not exists idx_t_material_reservas_chave on t_material_reservas (chave);
create index if not exists idx_t_material_reservas_status on t_material_reservas (status);
create index if not exists idx_t_material_reservas_produto on t_material_reservas (produto_codigo);
create index if not exists idx_t_material_reservas_cliente on t_material_reservas (cliente_id);
create index if not exists idx_t_material_reservas_lote on t_material_reservas (lote);
create index if not exists idx_t_material_reservas_created on t_material_reservas (created_at desc);

alter table t_material_reservas enable row level security;

drop policy if exists t_anon_all_t_material_reservas on t_material_reservas;
create policy t_anon_all_t_material_reservas on t_material_reservas
  for all
  to anon, authenticated
  using (true)
  with check (true);
