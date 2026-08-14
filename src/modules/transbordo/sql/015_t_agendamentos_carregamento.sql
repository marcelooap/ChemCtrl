-- Transbordo / Painel Comercial — Agendamentos de carregamento
-- ============================================================
-- Grade de horários (seg–sáb) vinculada às saídas (t_saidas).
-- Executar no SQL Editor do Supabase do ChemFlow.
--
-- usuario_id é TEXT porque o ID do usuário vem da plataforma ChemCtrl.

create extension if not exists "pgcrypto";

create or replace function t_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists t_agendamentos_carregamento (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  -- '07:30' … '16:30' ou 'encaixe'
  horario text not null,
  tipo text not null default 'regular' check (tipo in ('regular', 'encaixe')),
  saida_id uuid references t_saidas(id) on delete cascade,
  saida_codigo text,
  cliente_id uuid,
  cliente_nome text,
  status text not null default 'agendado' check (status in ('agendado', 'cancelado', 'concluido')),
  usuario_id text,
  usuario_nome text,
  observacao text,
  transportadora text,
  motorista text,
  placa text,
  -- Horário real do carregamento (HH:MM, fuso America/Sao_Paulo)
  hora_carregamento text,
  operador_conclusao_id text,
  operador_conclusao_nome text,
  grupo_conclusao_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists t_agendamentos_carregamento_set_updated_at on t_agendamentos_carregamento;
create trigger t_agendamentos_carregamento_set_updated_at
  before update on t_agendamentos_carregamento
  for each row execute function t_set_updated_at();

-- Um horário pode ter várias saídas; cada saída só pode estar em um horário ativo.
create index if not exists idx_t_agendamentos_slot
  on t_agendamentos_carregamento (data, horario);

create unique index if not exists uq_t_agendamentos_saida_ativa
  on t_agendamentos_carregamento (saida_id)
  where status = 'agendado' and saida_id is not null;

create index if not exists idx_t_agendamentos_data on t_agendamentos_carregamento (data);
create index if not exists idx_t_agendamentos_status on t_agendamentos_carregamento (status);
create index if not exists idx_t_agendamentos_saida on t_agendamentos_carregamento (saida_id);

alter table t_agendamentos_carregamento enable row level security;

drop policy if exists t_anon_all_t_agendamentos_carregamento on t_agendamentos_carregamento;
create policy t_anon_all_t_agendamentos_carregamento on t_agendamentos_carregamento
  for all
  to anon, authenticated
  using (true)
  with check (true);
