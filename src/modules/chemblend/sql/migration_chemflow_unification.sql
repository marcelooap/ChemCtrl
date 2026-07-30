-- ============================================================================
-- ChemCtrl — Unificação de bancos: ChemFlow -> ChemBlend (Projeto A)
-- ============================================================================
-- PARTE 1/2 — SCHEMA
--
-- Consolida em um único script idempotente o estado final do schema do
-- ChemFlow (antes no Supabase Projeto B / putkyadaefivnqyinbnz), equivalente a
-- executar em ordem os arquivos src/modules/chemflow/sql/001..009.
--
-- EXECUTAR NO SQL EDITOR DO PROJETO CHEMBLEND (cpzibnwytukcgxeamfhp):
--   1. Este arquivo (schema).
--   2. migration_chemflow_unification_data.sql (dados reais migrados).
--
-- Garantias:
--   - Nenhum nome colide com objetos existentes do ChemBlend (tabelas em
--     português vs. inglês; função utilitária prefixada `chemflow_`).
--   - Script idempotente: pode ser reexecutado sem efeitos colaterais.
--   - Modelo de RLS preservado 1:1 (acesso anon/authenticated liberado nas
--     tabelas do domínio ChemFlow — o controle de acesso real permanece na
--     camada de aplicação via sessão da plataforma, como documentado no
--     antigo 003_rls.sql).
-- ============================================================================

create extension if not exists "pgcrypto";

-- Função utilitária para manter `updated_at` sincronizado nas tabelas ChemFlow.
-- Prefixada para não colidir com utilitários existentes do ChemBlend.
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

drop trigger if exists clientes_set_updated_at on clientes;
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

drop trigger if exists produtos_set_updated_at on produtos;
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

drop trigger if exists isotanques_set_updated_at on isotanques;
create trigger isotanques_set_updated_at
  before update on isotanques
  for each row execute function chemflow_set_updated_at();

-- ============================================================
-- descontaminacoes (limpezas de tanka — histórico de locação)
-- ============================================================
create table if not exists descontaminacoes (
  id uuid primary key default gen_random_uuid(),
  tanka text not null,
  data_descontaminacao date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists descontaminacoes_set_updated_at on descontaminacoes;
create trigger descontaminacoes_set_updated_at
  before update on descontaminacoes
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists entradas_set_updated_at on entradas;
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

comment on column estoque.nota_fiscal is
  'Nota fiscal original da entrada (preservada após troca fiscal).';

comment on column estoque.nota_fiscal_troca is
  'Nota fiscal após troca fiscal. Quando preenchida, é a NF vigente operacionalmente.';

drop trigger if exists estoque_set_updated_at on estoque;
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

drop trigger if exists transbordos_set_updated_at on transbordos;
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

drop trigger if exists vasilhames_set_updated_at on vasilhames;
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
  -- Texto livre (nome do usuário da plataforma) — sem FK para usuarios do
  -- ChemBlend, preservando o comportamento original do módulo.
  usuario_criador text,
  usuario_responsavel text,
  status text not null default 'aguardando' check (status in ('aguardando', 'enviado_fiscal')),
  enviado_ao_fiscal boolean not null default false,
  enviado_fiscal_usuario text,
  enviado_fiscal_data timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists saidas_set_updated_at on saidas;
create trigger saidas_set_updated_at
  before update on saidas
  for each row execute function chemflow_set_updated_at();

-- ============================================================
-- elementos_filtrantes (insumos de filtração — cartuchos F001, F002…)
-- ============================================================
create table if not exists elementos_filtrantes (
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

drop trigger if exists elementos_filtrantes_set_updated_at on elementos_filtrantes;
create trigger elementos_filtrantes_set_updated_at
  before update on elementos_filtrantes
  for each row execute function chemflow_set_updated_at();

-- ============================================================
-- filtracoes (controles de SAE e contagem de partículas por µm)
-- ============================================================
create table if not exists filtracoes (
  id uuid primary key default gen_random_uuid(),
  vasilhame_id uuid references vasilhames(id) on delete cascade,
  transbordo_id uuid references transbordos(id) on delete set null,
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
  filtro_id uuid references elementos_filtrantes(id) on delete set null,
  filtro_codigo text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists filtracoes_set_updated_at on filtracoes;
create trigger filtracoes_set_updated_at
  before update on filtracoes
  for each row execute function chemflow_set_updated_at();

-- ============================================================
-- Índices
-- ============================================================

-- produtos
create index if not exists idx_produtos_cliente_id on produtos (cliente_id);
create index if not exists idx_produtos_codigo on produtos (codigo);

-- isotanques
create index if not exists idx_isotanques_produto_id on isotanques (produto_id);
create index if not exists idx_isotanques_cliente_id on isotanques (cliente_id);
create index if not exists idx_isotanques_codigo_itku on isotanques (codigo_itku);

-- descontaminacoes
create index if not exists idx_descontaminacoes_tanka on descontaminacoes (tanka);
create index if not exists idx_descontaminacoes_data on descontaminacoes (data_descontaminacao desc);

-- entradas
create index if not exists idx_entradas_created_at on entradas (created_at desc);
create index if not exists idx_entradas_cliente_id on entradas (cliente_id);
create index if not exists idx_entradas_produto_id on entradas (produto_id);
create index if not exists idx_entradas_origem on entradas (origem);
create index if not exists idx_entradas_comunicacao_enviada on entradas (comunicacao_enviada);
create index if not exists idx_entradas_grupo_entrada on entradas (grupo_entrada);

-- estoque
create index if not exists idx_estoque_entrada_id on estoque (entrada_id);
create index if not exists idx_estoque_produto_id on estoque (produto_id);
create index if not exists idx_estoque_cliente_id on estoque (cliente_id);
create index if not exists idx_estoque_lote on estoque (lote);
create index if not exists idx_estoque_status_wms on estoque (status_wms);
create index if not exists idx_estoque_saldo_atual on estoque (saldo_atual);

-- transbordos
create index if not exists idx_transbordos_created_at on transbordos (created_at desc);
create index if not exists idx_transbordos_cliente_id on transbordos (cliente_id);
create index if not exists idx_transbordos_produto_id on transbordos (produto_id);
create index if not exists idx_transbordos_codigo on transbordos (codigo_transbordo);

-- vasilhames
create index if not exists idx_vasilhames_created_at on vasilhames (created_at desc);
create index if not exists idx_vasilhames_transbordo_id on vasilhames (transbordo_id);
create index if not exists idx_vasilhames_status on vasilhames (status);
create index if not exists idx_vasilhames_placa on vasilhames (placa);
create index if not exists idx_vasilhames_produto_id on vasilhames (produto_id);
create index if not exists idx_vasilhames_cliente_id on vasilhames (cliente_id);
create index if not exists idx_vasilhames_origem on vasilhames (origem);

-- saidas
create index if not exists idx_saidas_created_at on saidas (created_at desc);
create index if not exists idx_saidas_status on saidas (status);
create index if not exists idx_saidas_cliente_id on saidas (cliente_id);
create index if not exists idx_saidas_data_programada on saidas (data_programada);
create index if not exists idx_saidas_enviado_ao_fiscal on saidas (enviado_ao_fiscal);

-- elementos_filtrantes
create index if not exists idx_elementos_filtrantes_codigo on elementos_filtrantes (codigo);
create index if not exists idx_elementos_filtrantes_status on elementos_filtrantes (status);

-- filtracoes
create index if not exists idx_filtracoes_vasilhame on filtracoes (vasilhame_id);
create index if not exists idx_filtracoes_transbordo on filtracoes (transbordo_id);
create index if not exists idx_filtracoes_codigo on filtracoes (codigo);
create index if not exists idx_filtracoes_produto on filtracoes (produto_id);
create index if not exists idx_filtracoes_filtro on filtracoes (filtro_id);
create index if not exists idx_filtracoes_composicao on filtracoes using gin (composicao);

-- Índices GIN para consultas eventuais dentro dos campos jsonb.
create index if not exists idx_entradas_lotes_gin on entradas using gin (lotes);
create index if not exists idx_estoque_lotes_gin on estoque using gin (lotes);
create index if not exists idx_transbordos_origens_gin on transbordos using gin (origens);
create index if not exists idx_transbordos_destinos_gin on transbordos using gin (destinos);
create index if not exists idx_saidas_itens_gin on saidas using gin (itens);

-- ============================================================
-- Row Level Security
-- ============================================================
-- Mesmo modelo do antigo Projeto B (003_rls.sql): RLS habilitado com política
-- única liberando anon + authenticated nas tabelas do domínio ChemFlow.
-- O controle de acesso real é feito na aplicação (rotas /chemflow/* atrás de
-- ProtectedRoute + sessão da plataforma). As tabelas do ChemBlend não são
-- afetadas — as políticas abaixo aplicam-se somente às tabelas deste domínio.
do $$
declare
  t text;
begin
  foreach t in array array[
    'clientes', 'produtos', 'isotanques', 'descontaminacoes', 'entradas',
    'estoque', 'transbordos', 'vasilhames', 'saidas', 'filtracoes',
    'elementos_filtrantes'
  ]
  loop
    execute format('alter table %1$I enable row level security;', t);
    execute format('drop policy if exists chemflow_anon_all_%1$s on %1$I;', t);
    execute format(
      'create policy chemflow_anon_all_%1$s on %1$I
         for all
         to anon, authenticated
         using (true)
         with check (true);',
      t
    );
  end loop;
end;
$$;
