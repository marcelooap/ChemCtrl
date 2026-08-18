-- Transbordo — Validação de operações antes da efetivação
-- ============================================================
-- Toda ordem lançada pelo operador (Painel → Ordem de Transbordo) é gravada
-- aqui como "pendente". A tela Transbordo → Validação confere/aprova e, só
-- então, dispara os fluxos existentes de Entrada + Transbordo.
--
-- Numeração própria (independente de Entradas), sem reuso: SEQUENCE.
-- Idempotência: transições status 'pendente' → 'processando' → 'validado'
--   permitem detectar duplo-clique / reload usando um único UPDATE atômico.

create extension if not exists "pgcrypto";

create or replace function t_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create sequence if not exists t_transbordo_validacoes_numero_seq;

create table if not exists t_transbordo_validacoes (
  id uuid primary key default gen_random_uuid(),
  numero integer not null unique default nextval('t_transbordo_validacoes_numero_seq'),

  -- 'granel_transbordo' quando origem é granel (cria Entrada + Transbordo ao validar).
  -- 'transbordo' quando origem é tanka/vasilhame/embalado (cria apenas Transbordo).
  tipo text not null check (tipo in ('granel_transbordo', 'transbordo')),

  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'validado')),

  data date not null default current_date,

  cliente_id uuid references t_clientes(id) on delete set null,
  cliente_nome text,
  produto_id uuid references t_produtos(id) on delete set null,
  produto_nome text,
  produto_codigo text,

  -- Sumário para exibição em tabela.
  lote text,
  quantidade numeric,
  unidade_medida text,

  origem_tipo text, -- granel|tanka|vasilhame|embalado

  -- Payload completo para permitir efetivar a operação depois.
  -- granel_payload: contrato aceito por createGranelEntrada({ data }).
  -- transbordo_payload: contrato aceito por persistTransbordo({ data, ... }).
  granel_payload jsonb,
  transbordo_payload jsonb,

  -- Vínculos criados após a validação (para auditoria/consulta).
  entrada_id uuid references t_entradas(id) on delete set null,
  transbordo_id uuid references t_transbordos(id) on delete set null,

  -- Auditoria (IDs vêm da plataforma ChemCtrl — TEXT, não UUID).
  criado_por_id text,
  criado_por_nome text,
  validado_por_id text,
  validado_por_nome text,
  validado_em timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter sequence t_transbordo_validacoes_numero_seq
  owned by t_transbordo_validacoes.numero;

drop trigger if exists t_transbordo_validacoes_set_updated_at on t_transbordo_validacoes;
create trigger t_transbordo_validacoes_set_updated_at
  before update on t_transbordo_validacoes
  for each row execute function t_set_updated_at();

create index if not exists idx_t_transbordo_validacoes_status
  on t_transbordo_validacoes (status);
create index if not exists idx_t_transbordo_validacoes_created
  on t_transbordo_validacoes (created_at desc);
create index if not exists idx_t_transbordo_validacoes_cliente
  on t_transbordo_validacoes (cliente_id);
create index if not exists idx_t_transbordo_validacoes_produto
  on t_transbordo_validacoes (produto_id);

alter table t_transbordo_validacoes enable row level security;

drop policy if exists t_anon_all_t_transbordo_validacoes on t_transbordo_validacoes;
create policy t_anon_all_t_transbordo_validacoes on t_transbordo_validacoes
  for all
  to anon, authenticated
  using (true)
  with check (true);
