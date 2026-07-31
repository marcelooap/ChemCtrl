-- ChemFlow — Supabase Projeto B — Schema inicial
-- Gerado a partir do inventário de campos das entities Base44 usadas pelo
-- app ChemFlow legado (CHEMFLOW/src). Substitui 1:1 as entities por tabelas
-- snake_case equivalentes, preservando a lógica de negócio observada nas
-- telas (Cadastro, Entrada, Estoque, Transbordo, Vasilhames, Tankagem, Saída).
--
-- Este projeto NÃO possui tabela de usuários: a autenticação do ChemFlow é
-- feita exclusivamente pela plataforma ChemCtrl (Supabase Projeto A). Ver
-- 003_rls.sql para o modelo de acesso via anon key.
--
-- Executar em ordem: 001_init_tables.sql -> 002_indexes.sql -> 003_rls.sql

create extension if not exists "pgcrypto";

-- Função utilitária para manter `updated_at` sincronizado em todas as tabelas.
create or replace function chemflow_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- clientes
-- ============================================================
create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger clientes_set_updated_at
  before update on clientes
  for each row execute function chemflow_set_updated_at();

-- ============================================================
-- produtos
-- ============================================================
create table if not exists produtos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  produto text not null,
  cliente_id uuid references clientes(id) on delete set null,
  cliente_nome text,
  densidade text,
  densidade_tabelada boolean not null default false,
  filtrado boolean not null default false,
  data_cadastro date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger produtos_set_updated_at
  before update on produtos
  for each row execute function chemflow_set_updated_at();

-- ============================================================
-- isotanques
-- ============================================================
create table if not exists isotanques (
  id uuid primary key default gen_random_uuid(),
  codigo_itku text not null,
  tanka text,
  produto_id uuid references produtos(id) on delete set null,
  produto_nome text,
  cliente_id uuid references clientes(id) on delete set null,
  cliente_nome text,
  capacidade numeric,
  inicio_locacao date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger isotanques_set_updated_at
  before update on isotanques
  for each row execute function chemflow_set_updated_at();

-- ============================================================
-- entradas (recebimentos de matéria-prima)
-- ============================================================
create table if not exists entradas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id) on delete set null,
  cliente_nome text,
  produto_id uuid references produtos(id) on delete set null,
  produto_nome text,
  produto_codigo text,
  nota_fiscal text,
  lote text,
  densidade text,
  data_fabricacao date,
  data_validade date,
  quantidade numeric not null default 0,
  unidade_medida text not null default 'kg',
  preco_unitario numeric,
  custo_total numeric,
  saldo_atual numeric not null default 0,
  embalado boolean not null default false,
  peso_liquido numeric,
  quantidade_embalagens integer,
  status_wms boolean not null default false,
  granel_pesagem boolean not null default false,
  granel_ticket text,
  granel_peso_bruto numeric,
  granel_validacao_bruto numeric,
  granel_peso_liquido numeric,
  granel_validacao_liquido numeric,
  granel_erro_admissivel numeric,
  granel_peso_minimo numeric,
  granel_peso_maximo numeric,
  granel_margem text check (granel_margem in ('dentro', 'fora')),
  grupo_entrada text,
  -- lotes[]: { produto_id, produto_nome, produto_codigo, nota_fiscal, lote,
  --   densidade, quantidade, unidade_medida, data_fabricacao, data_validade,
  --   preco_unitario, embalado, peso_liquido, quantidade_embalagens }
  lotes jsonb not null default '[]'::jsonb,
  origem text not null default 'convencional' check (origem in ('convencional', 'industrializacao')),
  fornecedor text,
  comunicacao_enviada boolean not null default false,
  data date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger entradas_set_updated_at
  before update on entradas
  for each row execute function chemflow_set_updated_at();

-- ============================================================
-- estoque (saldos por lote, derivados das entradas)
-- ============================================================
create table if not exists estoque (
  id uuid primary key default gen_random_uuid(),
  entrada_id uuid references entradas(id) on delete cascade,
  entrada_codigo text,
  grupo_entrada text,
  cliente_id uuid references clientes(id) on delete set null,
  cliente_nome text,
  produto_id uuid references produtos(id) on delete set null,
  produto_nome text,
  produto_codigo text,
  nota_fiscal text,
  nota_fiscal_troca text,
  lote text,
  densidade text,
  data_fabricacao date,
  data_validade date,
  quantidade numeric not null default 0,
  unidade_medida text not null default 'kg',
  saldo_atual numeric not null default 0,
  preco_unitario numeric,
  custo_total numeric,
  embalado boolean not null default false,
  peso_liquido numeric,
  quantidade_embalagens integer,
  status_wms boolean not null default false,
  -- lotes[]: mesmo shape de entradas.lotes (normalmente 1 item)
  lotes jsonb not null default '[]'::jsonb,
  origem text,
  granel_pesagem boolean not null default false,
  granel_ticket text,
  granel_peso_bruto numeric,
  granel_validacao_bruto numeric,
  granel_peso_liquido numeric,
  granel_validacao_liquido numeric,
  granel_erro_admissivel numeric,
  granel_peso_minimo numeric,
  granel_peso_maximo numeric,
  granel_margem text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger estoque_set_updated_at
  before update on estoque
  for each row execute function chemflow_set_updated_at();

-- ============================================================
-- transbordos
-- ============================================================
create table if not exists transbordos (
  id uuid primary key default gen_random_uuid(),
  codigo_transbordo text not null,
  data date not null default current_date,
  cliente_id uuid references clientes(id) on delete set null,
  cliente_nome text,
  produto_id uuid references produtos(id) on delete set null,
  produto_nome text,
  produto_codigo text,
  densidade text,
  volume_total numeric not null default 0,
  massa_total numeric not null default 0,
  -- string[] com nomes dos operadores responsáveis pela operação
  operadores jsonb not null default '[]'::jsonb,
  observacoes text,
  -- origens[]: { tipo_origem: entrada|embalado|tanka|vasilhame, entrada_id
  --   (referência polimórfica a estoque.id | isotanques.id | vasilhames.id),
  --   entrada_codigo, lote, volume_retirado, massa_retirada, saldo_restante,
  --   saldo_disponivel }
  origens jsonb not null default '[]'::jsonb,
  -- destinos[]: { tipo_embalagem, placa, barril, tara, volume, volume_total,
  --   peso_liquido, peso_bruto, lacres, eslinga, gps, menor_teste,
  --   fracionado, tanka_id, tanka_codigo, quantidade_embalagens,
  --   volume_por_embalagem }
  destinos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger transbordos_set_updated_at
  before update on transbordos
  for each row execute function chemflow_set_updated_at();

-- ============================================================
-- vasilhames (contentores em pátio/expedidos)
-- ============================================================
create table if not exists vasilhames (
  id uuid primary key default gen_random_uuid(),
  codigo text,
  origem text check (origem in ('manual', 'transbordo')),
  transbordo_id uuid references transbordos(id) on delete set null,
  numero_op text,
  placa text,
  barril text,
  tipo text,
  produto_id uuid references produtos(id) on delete set null,
  produto_nome text,
  produto_codigo text,
  cliente_id uuid references clientes(id) on delete set null,
  cliente_nome text,
  lote text,
  densidade text,
  volume numeric not null default 0,
  capacidade numeric,
  tara numeric,
  peso_liquido numeric,
  peso_bruto numeric,
  lacres text,
  eslinga text,
  gps text,
  menor_teste date,
  status text not null default 'No Pátio' check (status in ('No Pátio', 'Expedido')),
  data_saida date,
  responsavel text,
  fracionado boolean not null default false,
  -- composicao[]: { lote, origem_index, quantidade_l, quantidade_kg } — FIFO
  composicao jsonb not null default '[]'::jsonb,
  destino_index integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger vasilhames_set_updated_at
  before update on vasilhames
  for each row execute function chemflow_set_updated_at();

-- ============================================================
-- saidas (expedições)
-- ============================================================
create table if not exists saidas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  cliente_id uuid references clientes(id) on delete set null,
  cliente_nome text,
  data_solicitacao date not null default current_date,
  data_programada date,
  observacoes text,
  -- itens[]: { tipo: embalado|convencional, produto_id, produto_nome,
  --   produto_codigo, quantidade_solicitada, peso_liquido_embalagem,
  --   quantidade_embalagens, lote, estoque_atual, estoque_final,
  --   entrada_id (estoque.id | entradas.id), vasilhame_id, vasilhame_placa,
  --   vasilhame_barril, volume_disponivel, volume_solicitado, saldo_final,
  --   peso_liquido, peso_bruto }
  itens jsonb not null default '[]'::jsonb,
  quantidade_total numeric not null default 0,
  -- Texto livre (nome do usuário da plataforma) — sem FK, pois o ChemFlow
  -- não possui tabela própria de usuários (autenticação é da plataforma).
  usuario_criador text,
  usuario_responsavel text,
  status text not null default 'aguardando' check (status in ('aguardando', 'enviado_fiscal')),
  enviado_ao_fiscal boolean not null default false,
  enviado_fiscal_usuario text,
  enviado_fiscal_data timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger saidas_set_updated_at
  before update on saidas
  for each row execute function chemflow_set_updated_at();
