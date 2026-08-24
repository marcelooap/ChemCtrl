-- ============================================================================
-- ChemCtrl v2 — Bloco 06: Industrialização
-- PKs UUID; timestamps created_at/updated_at; FKs novas com ON DELETE documentado.
-- Colunas de negócio mantêm nomes em inglês (compatibilidade com entityTableMap / app).
-- ============================================================================

CREATE TABLE IF NOT EXISTS receitas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_id text,
  created_by text,
  code text,
  product_name text NOT NULL,
  client text,
  density numeric,
  price numeric,
  revision text,
  revision_date date,
  revision_number integer NOT NULL DEFAULT 1,
  validity_days numeric,
  raw_materials jsonb,
  fds_url text,
  fds_filename text,
  fds_uploaded_at timestamptz,
  fds_uploaded_by text,
  necessita_n2 boolean NOT NULL DEFAULT false,
  CONSTRAINT uq_receitas_product_revision UNIQUE (product_name, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_receitas_product_revision
  ON receitas (product_name, revision_number DESC);

CREATE TABLE IF NOT EXISTS pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_id text,
  order_number text,
  date timestamptz,
  product text NOT NULL,
  client text,
  requester text,
  client_order text,
  volume_ordered numeric NOT NULL,
  volume_produced numeric,
  volume_pending numeric,
  expected_date date,
  status text DEFAULT 'Pendente',
  observations text
);

CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos (status);

CREATE TABLE IF NOT EXISTS producoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_id text,
  op_number text,
  date timestamptz,
  product text NOT NULL,
  client text,
  client_order text,
  lot text,
  volume numeric NOT NULL,
  mass numeric,
  unit_price numeric,
  total_value numeric,
  recipe_revision text,
  recipe_id uuid REFERENCES receitas(id) ON DELETE SET NULL,
  order_id uuid REFERENCES pedidos(id) ON DELETE SET NULL,
  density numeric,
  status text DEFAULT 'Aguardando Início',
  priority text DEFAULT 'Média',
  packaging_type text,
  packaging_info text,
  bypass_qc boolean DEFAULT false,
  operator text,
  start_time timestamptz,
  end_time timestamptz,
  qc_start_time timestamptz,
  envase_start_time timestamptz,
  pause_start_time timestamptz,
  total_pause_ms numeric DEFAULT 0,
  observations text,
  raw_materials_used jsonb,
  qc_status text DEFAULT 'Pendente',
  qc_analyst text,
  qc_observations text,
  invoiced boolean DEFAULT false,
  public_token text,
  fractional_supply boolean DEFAULT false,
  volume_apontado numeric,
  volume_pendente numeric DEFAULT 0,
  complement_status text DEFAULT 'Completa',
  supply_complements jsonb DEFAULT '[]'::jsonb,
  complement_packaging boolean DEFAULT false,
  complement_container_id text
);

CREATE INDEX IF NOT EXISTS idx_producoes_status ON producoes (status);
CREATE INDEX IF NOT EXISTS idx_producoes_op_number ON producoes (op_number);
CREATE INDEX IF NOT EXISTS idx_producoes_recipe_id ON producoes (recipe_id);
CREATE INDEX IF NOT EXISTS idx_producoes_order_id ON producoes (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_producoes_public_token
  ON producoes (public_token) WHERE public_token IS NOT NULL;

-- Cascade client_order pedido → produções
CREATE OR REPLACE FUNCTION sync_order_client_order_to_productions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.client_order IS DISTINCT FROM OLD.client_order THEN
    UPDATE producoes
    SET client_order = NEW.client_order,
        updated_at = now()
    WHERE order_id = NEW.id
      AND client_order IS DISTINCT FROM NEW.client_order;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_client_order ON pedidos;
CREATE TRIGGER trg_sync_order_client_order
  AFTER UPDATE OF client_order ON pedidos
  FOR EACH ROW EXECUTE FUNCTION sync_order_client_order_to_productions();

CREATE TABLE IF NOT EXISTS estoque_mp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_id text,
  entry_id text,
  entry_date date,
  mp_code text,
  mp_name text NOT NULL,
  client text,
  lot text,
  nota_fiscal text,
  supplier text,
  manufacture_date date,
  expiry_date date,
  initial_stock numeric,
  current_stock numeric,
  unit text NOT NULL,
  unit_price numeric,
  density numeric,
  status text,
  status_wms boolean NOT NULL DEFAULT false,
  observations text,
  tank_storage boolean,
  tank_entries jsonb,
  packaging_type text,
  packaging_capacity numeric,
  packaging_quantity numeric,
  public_token text
);

CREATE INDEX IF NOT EXISTS idx_estoque_mp_status_wms ON estoque_mp (status_wms);
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_mp_public_token
  ON estoque_mp (public_token) WHERE public_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_estoque_mp_mp_code ON estoque_mp (mp_code);
CREATE INDEX IF NOT EXISTS idx_estoque_mp_entry_date ON estoque_mp (entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_estoque_mp_expiry_date ON estoque_mp (expiry_date);

CREATE TABLE IF NOT EXISTS movimentos_mp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_id text,
  stock_id uuid REFERENCES estoque_mp(id) ON DELETE RESTRICT,
  entry_id text,
  mp_code text,
  mp_name text,
  client text,
  lot text,
  quantity numeric,
  unit text,
  destination text,
  observations text,
  operator text,
  movement_date timestamptz,
  balance_before numeric,
  balance_after numeric
);

CREATE INDEX IF NOT EXISTS idx_movimentos_mp_stock_id ON movimentos_mp (stock_id);
CREATE INDEX IF NOT EXISTS idx_movimentos_mp_movement_date ON movimentos_mp (movement_date DESC);

CREATE TABLE IF NOT EXISTS tanques_ind (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_id text,
  name text NOT NULL,
  product text,
  client text NOT NULL,
  capacity numeric DEFAULT 26000,
  lot text,
  density numeric
);

CREATE TABLE IF NOT EXISTS transferencias_ind (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_id text,
  transfer_number text,
  date timestamptz,
  product text NOT NULL,
  client text,
  operator text,
  observations text,
  origins jsonb,
  destinations jsonb,
  destination_type text,
  destination_id text,
  volume numeric,
  mass numeric,
  driver text,
  packaging_type text,
  seals text,
  sling text,
  gps text,
  min_test_date date
);

CREATE TABLE IF NOT EXISTS vasilhames_producao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_id text,
  production_id uuid REFERENCES producoes(id) ON DELETE SET NULL,
  op_number text,
  container_number text,
  barril_number text,
  registration_id numeric,
  product text NOT NULL,
  client text,
  lot text,
  type text,
  volume numeric NOT NULL,
  tare numeric,
  net_weight numeric,
  gross_weight numeric,
  seals text,
  sling text,
  gps text,
  min_test_date date,
  operator text,
  status text DEFAULT 'No Pátio',
  departure_date date,
  is_fractional boolean DEFAULT false,
  original_package_qty integer,
  package_exits jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_vasilhames_producao_status ON vasilhames_producao (status);
CREATE INDEX IF NOT EXISTS idx_vasilhames_producao_production_id ON vasilhames_producao (production_id);

CREATE TABLE IF NOT EXISTS composicao_vasilhame_producao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  container_id uuid NOT NULL REFERENCES vasilhames_producao(id) ON DELETE CASCADE,
  production_id uuid REFERENCES producoes(id) ON DELETE SET NULL,
  op_number text,
  lot text,
  volume numeric NOT NULL DEFAULT 0,
  initial_volume numeric NOT NULL DEFAULT 0,
  operator text
);

CREATE INDEX IF NOT EXISTS idx_composicao_vasilhame_container
  ON composicao_vasilhame_producao (container_id);
CREATE INDEX IF NOT EXISTS idx_composicao_vasilhame_production
  ON composicao_vasilhame_producao (production_id);

CREATE TABLE IF NOT EXISTS checklist_producao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  production_id uuid NOT NULL REFERENCES producoes(id) ON DELETE RESTRICT,
  op_number text,
  product text,
  recipe_id uuid REFERENCES receitas(id) ON DELETE SET NULL,
  recipe_revision text,
  etapa text NOT NULL CHECK (etapa IN (
    'start_production', 'pause_production', 'start_filling', 'finish_filling'
  )),
  question_key text NOT NULL,
  question_label text NOT NULL,
  answer text NOT NULL,
  observacao text,
  usuario_id text,
  usuario_nome text,
  answered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_producao_prod_etapa
  ON checklist_producao (production_id, etapa);
CREATE INDEX IF NOT EXISTS idx_checklist_producao_etapa_answered
  ON checklist_producao (etapa, answered_at);
CREATE INDEX IF NOT EXISTS idx_checklist_producao_recipe_id
  ON checklist_producao (recipe_id);

CREATE TABLE IF NOT EXISTS cq_resultados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_id text,
  production_id uuid NOT NULL REFERENCES producoes(id) ON DELETE RESTRICT,
  op_number text,
  product text NOT NULL,
  client text,
  lot text,
  date timestamptz,
  analyst text,
  status text DEFAULT 'Pendente',
  observations text,
  results jsonb,
  sample_photo_url text
);

CREATE INDEX IF NOT EXISTS idx_cq_resultados_production_id ON cq_resultados (production_id);

CREATE TABLE IF NOT EXISTS cq_especificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_id text,
  created_by text,
  product text NOT NULL,
  client text,
  revision text,
  revision_date date,
  analyses jsonb
);

CREATE TABLE IF NOT EXISTS ensaios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_id text,
  analysis_name text NOT NULL,
  methodology text,
  unit text,
  is_active boolean NOT NULL DEFAULT true,
  created_by text,
  CONSTRAINT uq_ensaios_analysis_name UNIQUE (analysis_name)
);

CREATE TABLE IF NOT EXISTS inventarios_mp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_id text,
  inventory_number text,
  opening_date timestamptz,
  start_date timestamptz,
  closing_date timestamptz,
  opened_by text,
  started_by text,
  closed_by text,
  clients text,
  products text,
  lots text,
  status text DEFAULT 'Aberto',
  items jsonb DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_inventarios_mp_status ON inventarios_mp (status);
CREATE INDEX IF NOT EXISTS idx_inventarios_mp_number ON inventarios_mp (inventory_number);

CREATE TABLE IF NOT EXISTS equipamentos_lab (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_id text,
  name text NOT NULL,
  type text,
  manufacturer text,
  model text,
  serial_number text,
  patrimony_number text,
  location text,
  responsible text,
  lab_responsible text,
  acquisition_date date,
  calibration_periodicity_days integer DEFAULT 365,
  calibration_company text,
  calibration_responsible text,
  certificate_number text,
  last_calibration_date date,
  next_calibration_date date,
  observations text,
  image_url text,
  certificate_url text,
  manual_url text,
  attachments jsonb DEFAULT '[]'::jsonb,
  calibration_history jsonb DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS programacao_demanda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by text,
  scheduled_date date NOT NULL,
  product text NOT NULL,
  client text NOT NULL DEFAULT '',
  volume numeric NOT NULL DEFAULT 0,
  order_id uuid REFERENCES pedidos(id) ON DELETE SET NULL,
  produced boolean NOT NULL DEFAULT false,
  produced_at timestamptz,
  produced_by text
);

CREATE INDEX IF NOT EXISTS idx_programacao_demanda_date ON programacao_demanda (scheduled_date);
CREATE INDEX IF NOT EXISTS idx_programacao_demanda_order_id ON programacao_demanda (order_id);
CREATE INDEX IF NOT EXISTS idx_programacao_demanda_produced
  ON programacao_demanda (scheduled_date, produced);

CREATE TABLE IF NOT EXISTS validacoes_mp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero integer NOT NULL UNIQUE DEFAULT nextval('validacoes_mp_numero_seq'),
  tipo text NOT NULL DEFAULT 'entrada'
    CHECK (tipo IN ('entrada', 'granel_transbordo', 'transbordo')),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'processando', 'validado')),
  data date NOT NULL DEFAULT current_date,
  cliente_nome text,
  produto_nome text,
  produto_codigo text,
  lote text,
  quantidade numeric,
  unidade_medida text,
  origem_tipo text,
  entrada_payload jsonb,
  estoque_mp_ids jsonb,
  transbordo_payload jsonb,
  transbordo_id text,
  entrada_id text,
  criado_por_id text,
  criado_por_nome text,
  validado_por_id text,
  validado_por_nome text,
  validado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER SEQUENCE validacoes_mp_numero_seq OWNED BY validacoes_mp.numero;
CREATE INDEX IF NOT EXISTS idx_validacoes_mp_status ON validacoes_mp (status);
CREATE INDEX IF NOT EXISTS idx_validacoes_mp_created ON validacoes_mp (created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'receitas','pedidos','producoes','estoque_mp','movimentos_mp','tanques_ind',
    'transferencias_ind','vasilhames_producao','composicao_vasilhame_producao',
    'checklist_producao','cq_resultados','cq_especificacoes','ensaios',
    'inventarios_mp','equipamentos_lab','programacao_demanda','validacoes_mp'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_set_updated_at ON %1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_set_updated_at BEFORE UPDATE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()', t
    );
  END LOOP;
END $$;
