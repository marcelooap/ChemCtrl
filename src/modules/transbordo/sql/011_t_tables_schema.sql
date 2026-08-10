-- Transbordo — Schema consolidado com prefixo t_
-- ============================================================================
-- Consolida 001–010 em tabelas novas exclusivas do módulo Transbordo.
-- Tabelas nascem VAZIAS (sem seed/backfill) — a tela de Cadastro fica limpa.
--
-- Executar no SQL Editor do Supabase ANTES de apontar o app (entities.js).
-- Depois de validar o módulo, executar 012_drop_legacy_tables.sql.
--
-- Tabelas:
--   t_clientes, t_produtos, t_isotanques, t_descontaminacoes,
--   t_entradas, t_estoque, t_transbordos, t_vasilhames, t_saidas,
--   t_filtracoes, t_elementos_filtrantes

create extension if not exists "pgcrypto";

-- Função utilitária para manter `updated_at` sincronizado (prefixo t_).
-- NÃO altera a função legada chemflow_set_updated_at.
create or replace function t_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- t_clientes
-- ============================================================
create table if not exists t_clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger t_clientes_set_updated_at
  before update on t_clientes
  for each row execute function t_set_updated_at();

-- ============================================================
-- t_produtos
-- ============================================================
create table if not exists t_produtos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  produto text not null,
  cliente_id uuid references t_clientes(id) on delete set null,
  cliente_nome text,
  densidade text,
  densidade_tabelada boolean not null default false,
  filtrado boolean not null default false,
  data_cadastro date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger t_produtos_set_updated_at
  before update on t_produtos
  for each row execute function t_set_updated_at();

-- ============================================================
-- t_isotanques
-- ============================================================
create table if not exists t_isotanques (
  id uuid primary key default gen_random_uuid(),
  codigo_itku text not null,
  tanka text,
  produto_id uuid references t_produtos(id) on delete set null,
  produto_nome text,
  cliente_id uuid references t_clientes(id) on delete set null,
  cliente_nome text,
  capacidade numeric,
  inicio_locacao date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger t_isotanques_set_updated_at
  before update on t_isotanques
  for each row execute function t_set_updated_at();

-- ============================================================
-- t_descontaminacoes
-- ============================================================
create table if not exists t_descontaminacoes (
  id uuid primary key default gen_random_uuid(),
  tanka text not null,
  data_descontaminacao date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger t_descontaminacoes_set_updated_at
  before update on t_descontaminacoes
  for each row execute function t_set_updated_at();

-- ============================================================
-- t_entradas (recebimentos de matéria-prima)
-- ============================================================
create table if not exists t_entradas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references t_clientes(id) on delete set null,
  cliente_nome text,
  produto_id uuid references t_produtos(id) on delete set null,
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

create trigger t_entradas_set_updated_at
  before update on t_entradas
  for each row execute function t_set_updated_at();

-- ============================================================
-- t_estoque (saldos por lote, derivados das entradas)
-- ============================================================
create table if not exists t_estoque (
  id uuid primary key default gen_random_uuid(),
  entrada_id uuid references t_entradas(id) on delete cascade,
  entrada_codigo text,
  grupo_entrada text,
  cliente_id uuid references t_clientes(id) on delete set null,
  cliente_nome text,
  produto_id uuid references t_produtos(id) on delete set null,
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
  -- lotes[]: mesmo shape de t_entradas.lotes (normalmente 1 item)
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

comment on column t_estoque.nota_fiscal is
  'Nota fiscal original da entrada (preservada após troca fiscal).';

comment on column t_estoque.nota_fiscal_troca is
  'Nota fiscal após troca fiscal. Quando preenchida, é a NF vigente operacionalmente.';

create trigger t_estoque_set_updated_at
  before update on t_estoque
  for each row execute function t_set_updated_at();

-- ============================================================
-- t_transbordos
-- ============================================================
create table if not exists t_transbordos (
  id uuid primary key default gen_random_uuid(),
  codigo_transbordo text not null,
  data date not null default current_date,
  cliente_id uuid references t_clientes(id) on delete set null,
  cliente_nome text,
  produto_id uuid references t_produtos(id) on delete set null,
  produto_nome text,
  produto_codigo text,
  densidade text,
  volume_total numeric not null default 0,
  massa_total numeric not null default 0,
  -- string[] com nomes dos operadores responsáveis pela operação
  operadores jsonb not null default '[]'::jsonb,
  observacoes text,
  -- origens[]: { tipo_origem: entrada|embalado|tanka|vasilhame, entrada_id
  --   (referência polimórfica a t_estoque.id | t_isotanques.id | t_vasilhames.id),
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

create trigger t_transbordos_set_updated_at
  before update on t_transbordos
  for each row execute function t_set_updated_at();

-- ============================================================
-- t_vasilhames (contentores em pátio/expedidos)
-- ============================================================
create table if not exists t_vasilhames (
  id uuid primary key default gen_random_uuid(),
  codigo text,
  origem text check (origem in ('manual', 'transbordo')),
  transbordo_id uuid references t_transbordos(id) on delete set null,
  numero_op text,
  placa text,
  barril text,
  tipo text,
  produto_id uuid references t_produtos(id) on delete set null,
  produto_nome text,
  produto_codigo text,
  cliente_id uuid references t_clientes(id) on delete set null,
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

create trigger t_vasilhames_set_updated_at
  before update on t_vasilhames
  for each row execute function t_set_updated_at();

-- ============================================================
-- t_saidas (expedições)
-- ============================================================
create table if not exists t_saidas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  cliente_id uuid references t_clientes(id) on delete set null,
  cliente_nome text,
  data_solicitacao date not null default current_date,
  data_programada date,
  observacoes text,
  -- itens[]: { tipo: embalado|convencional, produto_id, produto_nome,
  --   produto_codigo, quantidade_solicitada, peso_liquido_embalagem,
  --   quantidade_embalagens, lote, estoque_atual, estoque_final,
  --   entrada_id (t_estoque.id | t_entradas.id), vasilhame_id, vasilhame_placa,
  --   vasilhame_barril, volume_disponivel, volume_solicitado, saldo_final,
  --   peso_liquido, peso_bruto }
  itens jsonb not null default '[]'::jsonb,
  quantidade_total numeric not null default 0,
  -- Texto livre (nome do usuário da plataforma) — sem FK, pois o Transbordo
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

create trigger t_saidas_set_updated_at
  before update on t_saidas
  for each row execute function t_set_updated_at();

-- ============================================================
-- t_elementos_filtrantes (insumos de filtração)
-- ============================================================
create table if not exists t_elementos_filtrantes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  tipo text not null default 'Cartucho',
  marca text default '',
  data_compra date,
  status text not null default 'Almoxarifado'
    check (status in ('Em uso', 'Almoxarifado', 'Descartado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger t_elementos_filtrantes_set_updated_at
  before update on t_elementos_filtrantes
  for each row execute function t_set_updated_at();

-- ============================================================
-- t_filtracoes
-- ============================================================
create table if not exists t_filtracoes (
  id uuid primary key default gen_random_uuid(),
  vasilhame_id uuid references t_vasilhames(id) on delete cascade,
  transbordo_id uuid references t_transbordos(id) on delete set null,
  codigo text,
  placa text default '',
  barril text default '',
  produto_id uuid,
  produto_codigo text default '',
  produto_nome text default '',
  cliente_id uuid,
  cliente_nome text default '',
  lote text default '',
  composicao jsonb not null default '[]'::jsonb,
  volume numeric default 0,
  sae integer,
  particulas_6 numeric,
  particulas_14 numeric,
  particulas_21 numeric,
  particulas_38 numeric,
  particulas_70 numeric,
  filtro_id uuid references t_elementos_filtrantes(id) on delete set null,
  filtro_codigo text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger t_filtracoes_set_updated_at
  before update on t_filtracoes
  for each row execute function t_set_updated_at();

-- ============================================================
-- Índices
-- ============================================================

-- t_produtos
create index if not exists idx_t_produtos_cliente_id on t_produtos (cliente_id);
create index if not exists idx_t_produtos_codigo on t_produtos (codigo);

-- t_isotanques
create index if not exists idx_t_isotanques_produto_id on t_isotanques (produto_id);
create index if not exists idx_t_isotanques_cliente_id on t_isotanques (cliente_id);
create index if not exists idx_t_isotanques_codigo_itku on t_isotanques (codigo_itku);

-- t_descontaminacoes
create index if not exists idx_t_descontaminacoes_tanka on t_descontaminacoes (tanka);
create index if not exists idx_t_descontaminacoes_data on t_descontaminacoes (data_descontaminacao desc);

-- t_entradas
create index if not exists idx_t_entradas_created_at on t_entradas (created_at desc);
create index if not exists idx_t_entradas_data on t_entradas (data desc);
create index if not exists idx_t_entradas_cliente_id on t_entradas (cliente_id);
create index if not exists idx_t_entradas_produto_id on t_entradas (produto_id);
create index if not exists idx_t_entradas_origem on t_entradas (origem);
create index if not exists idx_t_entradas_comunicacao_enviada on t_entradas (comunicacao_enviada);
create index if not exists idx_t_entradas_grupo_entrada on t_entradas (grupo_entrada);
create index if not exists idx_t_entradas_lotes_gin on t_entradas using gin (lotes);

-- t_estoque
create index if not exists idx_t_estoque_entrada_id on t_estoque (entrada_id);
create index if not exists idx_t_estoque_produto_id on t_estoque (produto_id);
create index if not exists idx_t_estoque_cliente_id on t_estoque (cliente_id);
create index if not exists idx_t_estoque_lote on t_estoque (lote);
create index if not exists idx_t_estoque_status_wms on t_estoque (status_wms);
create index if not exists idx_t_estoque_saldo_atual on t_estoque (saldo_atual);
create index if not exists idx_t_estoque_lotes_gin on t_estoque using gin (lotes);

-- t_transbordos
create index if not exists idx_t_transbordos_created_at on t_transbordos (created_at desc);
create index if not exists idx_t_transbordos_cliente_id on t_transbordos (cliente_id);
create index if not exists idx_t_transbordos_produto_id on t_transbordos (produto_id);
create index if not exists idx_t_transbordos_codigo on t_transbordos (codigo_transbordo);
create index if not exists idx_t_transbordos_origens_gin on t_transbordos using gin (origens);
create index if not exists idx_t_transbordos_destinos_gin on t_transbordos using gin (destinos);

-- t_vasilhames
create index if not exists idx_t_vasilhames_created_at on t_vasilhames (created_at desc);
create index if not exists idx_t_vasilhames_transbordo_id on t_vasilhames (transbordo_id);
create index if not exists idx_t_vasilhames_status on t_vasilhames (status);
create index if not exists idx_t_vasilhames_placa on t_vasilhames (placa);
create index if not exists idx_t_vasilhames_produto_id on t_vasilhames (produto_id);
create index if not exists idx_t_vasilhames_cliente_id on t_vasilhames (cliente_id);
create index if not exists idx_t_vasilhames_origem on t_vasilhames (origem);

-- t_saidas
create index if not exists idx_t_saidas_created_at on t_saidas (created_at desc);
create index if not exists idx_t_saidas_status on t_saidas (status);
create index if not exists idx_t_saidas_cliente_id on t_saidas (cliente_id);
create index if not exists idx_t_saidas_data_programada on t_saidas (data_programada);
create index if not exists idx_t_saidas_enviado_ao_fiscal on t_saidas (enviado_ao_fiscal);
create index if not exists idx_t_saidas_itens_gin on t_saidas using gin (itens);

-- t_elementos_filtrantes
create index if not exists idx_t_elementos_filtrantes_codigo on t_elementos_filtrantes (codigo);
create index if not exists idx_t_elementos_filtrantes_status on t_elementos_filtrantes (status);

-- t_filtracoes
create index if not exists idx_t_filtracoes_vasilhame on t_filtracoes (vasilhame_id);
create index if not exists idx_t_filtracoes_transbordo on t_filtracoes (transbordo_id);
create index if not exists idx_t_filtracoes_codigo on t_filtracoes (codigo);
create index if not exists idx_t_filtracoes_produto on t_filtracoes (produto_id);
create index if not exists idx_t_filtracoes_filtro on t_filtracoes (filtro_id);
create index if not exists idx_t_filtracoes_composicao on t_filtracoes using gin (composicao);

-- ============================================================
-- RLS — mesmo modelo anon/authenticated do módulo legado
-- (autenticação real é da plataforma ChemCtrl)
-- ============================================================
alter table t_clientes             enable row level security;
alter table t_produtos             enable row level security;
alter table t_isotanques           enable row level security;
alter table t_descontaminacoes     enable row level security;
alter table t_entradas             enable row level security;
alter table t_estoque              enable row level security;
alter table t_transbordos          enable row level security;
alter table t_vasilhames           enable row level security;
alter table t_saidas               enable row level security;
alter table t_elementos_filtrantes enable row level security;
alter table t_filtracoes           enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    't_clientes', 't_produtos', 't_isotanques', 't_descontaminacoes',
    't_entradas', 't_estoque', 't_transbordos', 't_vasilhames', 't_saidas',
    't_elementos_filtrantes', 't_filtracoes'
  ]
  loop
    execute format(
      'drop policy if exists t_anon_all_%1$s on %1$s;', t
    );
    execute format(
      'create policy t_anon_all_%1$s on %1$s
         for all
         to anon, authenticated
         using (true)
         with check (true);',
      t
    );
  end loop;
end;
$$;
