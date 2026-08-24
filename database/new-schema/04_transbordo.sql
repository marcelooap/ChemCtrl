-- ============================================================================
-- ChemCtrl v2 — Bloco 04: Transbordo (domínio específico)
-- Substitui: t_produtos, t_isotanques, t_descontaminacoes, t_elementos_filtrantes,
--            t_entradas, t_estoque, t_transbordos, t_vasilhames, t_filtracoes,
--            t_material_reservas, t_agendamentos_carregamento, t_transbordo_validacoes
-- Snapshots históricos (cliente_nome, produto_nome, …) preservados.
-- ============================================================================

CREATE TABLE IF NOT EXISTS produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  produto text NOT NULL,
  cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome text,
  densidade text,
  densidade_tabelada boolean NOT NULL DEFAULT false,
  filtrado boolean NOT NULL DEFAULT false,
  data_cadastro date NOT NULL DEFAULT current_date,
  fds_url text,
  fds_filename text,
  fds_uploaded_at timestamptz,
  fds_uploaded_by text,
  public_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_produtos_cliente_id ON produtos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_produtos_codigo ON produtos (codigo);
CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_public_token
  ON produtos (public_token) WHERE public_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS isotanques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_itku text NOT NULL,
  tanka text,
  produto_id uuid REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome text,
  cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome text,
  capacidade numeric,
  inicio_locacao date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_isotanques_produto_id ON isotanques (produto_id);
CREATE INDEX IF NOT EXISTS idx_isotanques_cliente_id ON isotanques (cliente_id);
CREATE INDEX IF NOT EXISTS idx_isotanques_codigo_itku ON isotanques (codigo_itku);

CREATE TABLE IF NOT EXISTS descontaminacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tanka text NOT NULL,
  data_descontaminacao date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_descontaminacoes_tanka ON descontaminacoes (tanka);
CREATE INDEX IF NOT EXISTS idx_descontaminacoes_data ON descontaminacoes (data_descontaminacao DESC);

CREATE TABLE IF NOT EXISTS elementos_filtrantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  tipo text NOT NULL DEFAULT 'Cartucho',
  marca text DEFAULT '',
  data_compra date,
  status text NOT NULL DEFAULT 'Almoxarifado'
    CHECK (status IN ('Em uso', 'Almoxarifado', 'Descartado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_elementos_filtrantes_status ON elementos_filtrantes (status);

CREATE TABLE IF NOT EXISTS entradas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome text,
  produto_id uuid REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome text,
  produto_codigo text,
  nota_fiscal text,
  lote text,
  densidade text,
  data_fabricacao date,
  data_validade date,
  quantidade numeric NOT NULL DEFAULT 0,
  unidade_medida text NOT NULL DEFAULT 'kg',
  preco_unitario numeric,
  custo_total numeric,
  saldo_atual numeric NOT NULL DEFAULT 0,
  embalado boolean NOT NULL DEFAULT false,
  peso_liquido numeric,
  quantidade_embalagens integer,
  status_wms boolean NOT NULL DEFAULT false,
  granel_pesagem boolean NOT NULL DEFAULT false,
  granel_ticket text,
  granel_peso_bruto numeric,
  granel_validacao_bruto numeric,
  granel_peso_liquido numeric,
  granel_validacao_liquido numeric,
  granel_erro_admissivel numeric,
  granel_peso_minimo numeric,
  granel_peso_maximo numeric,
  granel_margem text CHECK (granel_margem IS NULL OR granel_margem IN ('dentro', 'fora')),
  grupo_entrada text,
  lotes jsonb NOT NULL DEFAULT '[]'::jsonb,
  origem text NOT NULL DEFAULT 'convencional'
    CHECK (origem IN ('convencional', 'industrializacao')),
  fornecedor text,
  comunicacao_enviada boolean NOT NULL DEFAULT false,
  data date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entradas_created_at ON entradas (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entradas_data ON entradas (data DESC);
CREATE INDEX IF NOT EXISTS idx_entradas_cliente_id ON entradas (cliente_id);
CREATE INDEX IF NOT EXISTS idx_entradas_produto_id ON entradas (produto_id);
CREATE INDEX IF NOT EXISTS idx_entradas_origem ON entradas (origem);
CREATE INDEX IF NOT EXISTS idx_entradas_grupo_entrada ON entradas (grupo_entrada);
CREATE INDEX IF NOT EXISTS idx_entradas_lotes_gin ON entradas USING gin (lotes);

CREATE TABLE IF NOT EXISTS estoque (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_estoque integer NOT NULL DEFAULT nextval('estoque_codigo_seq'),
  entrada_id uuid REFERENCES entradas(id) ON DELETE CASCADE,
  entrada_codigo text,
  grupo_entrada text,
  cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome text,
  produto_id uuid REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome text,
  produto_codigo text,
  nota_fiscal text,
  nota_fiscal_troca text,
  lote text,
  densidade text,
  data_fabricacao date,
  data_validade date,
  quantidade numeric NOT NULL DEFAULT 0,
  unidade_medida text NOT NULL DEFAULT 'kg',
  saldo_atual numeric NOT NULL DEFAULT 0,
  preco_unitario numeric,
  custo_total numeric,
  embalado boolean NOT NULL DEFAULT false,
  peso_liquido numeric,
  quantidade_embalagens integer,
  status_wms boolean NOT NULL DEFAULT false,
  lotes jsonb NOT NULL DEFAULT '[]'::jsonb,
  origem text,
  granel_pesagem boolean NOT NULL DEFAULT false,
  granel_ticket text,
  granel_peso_bruto numeric,
  granel_validacao_bruto numeric,
  granel_peso_liquido numeric,
  granel_validacao_liquido numeric,
  granel_erro_admissivel numeric,
  granel_peso_minimo numeric,
  granel_peso_maximo numeric,
  granel_margem text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER SEQUENCE estoque_codigo_seq OWNED BY estoque.codigo_estoque;
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_codigo_estoque ON estoque (codigo_estoque);
CREATE INDEX IF NOT EXISTS idx_estoque_entrada_id ON estoque (entrada_id);
CREATE INDEX IF NOT EXISTS idx_estoque_produto_id ON estoque (produto_id);
CREATE INDEX IF NOT EXISTS idx_estoque_cliente_id ON estoque (cliente_id);
CREATE INDEX IF NOT EXISTS idx_estoque_lote ON estoque (lote);
CREATE INDEX IF NOT EXISTS idx_estoque_status_wms ON estoque (status_wms);
CREATE INDEX IF NOT EXISTS idx_estoque_saldo_atual ON estoque (saldo_atual);
CREATE INDEX IF NOT EXISTS idx_estoque_lotes_gin ON estoque USING gin (lotes);

DROP TRIGGER IF EXISTS trg_estoque_assign_codigo ON estoque;
CREATE TRIGGER trg_estoque_assign_codigo
  BEFORE INSERT ON estoque
  FOR EACH ROW EXECUTE FUNCTION fn_estoque_assign_codigo();

CREATE TABLE IF NOT EXISTS transbordos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_transbordo text NOT NULL,
  data date NOT NULL DEFAULT current_date,
  cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome text,
  produto_id uuid REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome text,
  produto_codigo text,
  densidade text,
  volume_total numeric NOT NULL DEFAULT 0,
  massa_total numeric NOT NULL DEFAULT 0,
  operadores jsonb NOT NULL DEFAULT '[]'::jsonb,
  observacoes text,
  origens jsonb NOT NULL DEFAULT '[]'::jsonb,
  destinos jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transbordos_created_at ON transbordos (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transbordos_cliente_id ON transbordos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_transbordos_produto_id ON transbordos (produto_id);
CREATE INDEX IF NOT EXISTS idx_transbordos_codigo ON transbordos (codigo_transbordo);
CREATE INDEX IF NOT EXISTS idx_transbordos_origens_gin ON transbordos USING gin (origens);
CREATE INDEX IF NOT EXISTS idx_transbordos_destinos_gin ON transbordos USING gin (destinos);

CREATE TABLE IF NOT EXISTS vasilhames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text,
  origem text CHECK (origem IS NULL OR origem IN ('manual', 'transbordo')),
  transbordo_id uuid REFERENCES transbordos(id) ON DELETE SET NULL,
  numero_op text,
  placa text,
  barril text,
  tipo text,
  produto_id uuid REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome text,
  produto_codigo text,
  cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome text,
  lote text,
  densidade text,
  volume numeric NOT NULL DEFAULT 0,
  capacidade numeric,
  tara numeric,
  peso_liquido numeric,
  peso_bruto numeric,
  lacres text,
  eslinga text,
  gps text,
  menor_teste date,
  status text NOT NULL DEFAULT 'No Pátio'
    CHECK (status IN ('No Pátio', 'Expedido')),
  data_saida date,
  responsavel text,
  fracionado boolean NOT NULL DEFAULT false,
  composicao jsonb NOT NULL DEFAULT '[]'::jsonb,
  destino_index integer,
  original_package_qty integer,
  package_exits jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vasilhames_created_at ON vasilhames (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vasilhames_transbordo_id ON vasilhames (transbordo_id);
CREATE INDEX IF NOT EXISTS idx_vasilhames_status ON vasilhames (status);
CREATE INDEX IF NOT EXISTS idx_vasilhames_placa ON vasilhames (placa);
CREATE INDEX IF NOT EXISTS idx_vasilhames_produto_id ON vasilhames (produto_id);
CREATE INDEX IF NOT EXISTS idx_vasilhames_cliente_id ON vasilhames (cliente_id);
CREATE INDEX IF NOT EXISTS idx_vasilhames_origem ON vasilhames (origem);

CREATE TABLE IF NOT EXISTS filtracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vasilhame_id uuid REFERENCES vasilhames(id) ON DELETE CASCADE,
  transbordo_id uuid REFERENCES transbordos(id) ON DELETE SET NULL,
  codigo text,
  placa text DEFAULT '',
  barril text DEFAULT '',
  produto_id uuid,
  produto_codigo text DEFAULT '',
  produto_nome text DEFAULT '',
  cliente_id uuid,
  cliente_nome text DEFAULT '',
  lote text DEFAULT '',
  composicao jsonb NOT NULL DEFAULT '[]'::jsonb,
  volume numeric DEFAULT 0,
  sae integer,
  particulas_6 numeric,
  particulas_14 numeric,
  particulas_21 numeric,
  particulas_38 numeric,
  particulas_70 numeric,
  filtro_id uuid REFERENCES elementos_filtrantes(id) ON DELETE SET NULL,
  filtro_codigo text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_filtracoes_vasilhame ON filtracoes (vasilhame_id);
CREATE INDEX IF NOT EXISTS idx_filtracoes_transbordo ON filtracoes (transbordo_id);
CREATE INDEX IF NOT EXISTS idx_filtracoes_codigo ON filtracoes (codigo);
CREATE INDEX IF NOT EXISTS idx_filtracoes_produto ON filtracoes (produto_id);
CREATE INDEX IF NOT EXISTS idx_filtracoes_filtro ON filtracoes (filtro_id);
CREATE INDEX IF NOT EXISTS idx_filtracoes_composicao ON filtracoes USING gin (composicao);

CREATE TABLE IF NOT EXISTS material_reservas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL,
  cliente_id uuid,
  cliente_nome text,
  produto_id uuid,
  produto_codigo text NOT NULL DEFAULT '',
  produto_nome text,
  lote text NOT NULL DEFAULT '',
  unidade_medida text NOT NULL DEFAULT 'kg',
  quantidade numeric NOT NULL CHECK (quantidade > 0),
  status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'removida')),
  usuario_id text,
  usuario_nome text,
  observacao text,
  removido_em timestamptz,
  removido_por_id text,
  removido_por_nome text,
  motivo_remocao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_reservas_chave ON material_reservas (chave);
CREATE INDEX IF NOT EXISTS idx_material_reservas_status ON material_reservas (status);
CREATE INDEX IF NOT EXISTS idx_material_reservas_produto ON material_reservas (produto_codigo);
CREATE INDEX IF NOT EXISTS idx_material_reservas_cliente ON material_reservas (cliente_id);
CREATE INDEX IF NOT EXISTS idx_material_reservas_lote ON material_reservas (lote);
CREATE INDEX IF NOT EXISTS idx_material_reservas_created ON material_reservas (created_at DESC);

CREATE TABLE IF NOT EXISTS transbordo_validacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero integer NOT NULL UNIQUE DEFAULT nextval('transbordo_validacoes_numero_seq'),
  tipo text NOT NULL CHECK (tipo IN ('granel_transbordo', 'transbordo', 'entrada')),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'processando', 'validado')),
  data date NOT NULL DEFAULT current_date,
  cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome text,
  produto_id uuid REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome text,
  produto_codigo text,
  lote text,
  quantidade numeric,
  unidade_medida text,
  origem_tipo text,
  granel_payload jsonb,
  transbordo_payload jsonb,
  entrada_id uuid REFERENCES entradas(id) ON DELETE SET NULL,
  transbordo_id uuid REFERENCES transbordos(id) ON DELETE SET NULL,
  criado_por_id text,
  criado_por_nome text,
  validado_por_id text,
  validado_por_nome text,
  validado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER SEQUENCE transbordo_validacoes_numero_seq OWNED BY transbordo_validacoes.numero;
CREATE INDEX IF NOT EXISTS idx_transbordo_validacoes_status ON transbordo_validacoes (status);
CREATE INDEX IF NOT EXISTS idx_transbordo_validacoes_created ON transbordo_validacoes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transbordo_validacoes_cliente ON transbordo_validacoes (cliente_id);
CREATE INDEX IF NOT EXISTS idx_transbordo_validacoes_produto ON transbordo_validacoes (produto_id);

-- updated_at triggers
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'produtos','isotanques','descontaminacoes','elementos_filtrantes',
    'entradas','estoque','transbordos','vasilhames','filtracoes',
    'material_reservas','transbordo_validacoes'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_set_updated_at ON %1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_set_updated_at BEFORE UPDATE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()', t
    );
  END LOOP;
END $$;
