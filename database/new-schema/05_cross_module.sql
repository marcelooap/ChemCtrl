-- ============================================================================
-- ChemCtrl v2 — Bloco 05: Cross-module (saidas, leituras, agendamentos)
-- ============================================================================

CREATE TABLE IF NOT EXISTS saidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome text,
  data_solicitacao date NOT NULL DEFAULT current_date,
  data_programada date,
  observacoes text,
  itens jsonb NOT NULL DEFAULT '[]'::jsonb,
  quantidade_total numeric NOT NULL DEFAULT 0,
  usuario_criador text,
  usuario_responsavel text,
  -- Fase A: mantém 'chemflow' por compatibilidade de dados/código
  modulo_origem text CHECK (
    modulo_origem IS NULL
    OR modulo_origem IN ('chemflow', 'painel', 'industrializacao')
  ),
  status text NOT NULL DEFAULT 'aguardando'
    CHECK (status IN ('aguardando', 'enviado_fiscal')),
  enviado_ao_fiscal boolean NOT NULL DEFAULT false,
  enviado_fiscal_usuario text,
  enviado_fiscal_data timestamptz,
  validacao_modulos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saidas_created_at ON saidas (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saidas_status ON saidas (status);
CREATE INDEX IF NOT EXISTS idx_saidas_cliente_id ON saidas (cliente_id);
CREATE INDEX IF NOT EXISTS idx_saidas_data_programada ON saidas (data_programada);
CREATE INDEX IF NOT EXISTS idx_saidas_enviado_ao_fiscal ON saidas (enviado_ao_fiscal);
CREATE INDEX IF NOT EXISTS idx_saidas_modulo_origem ON saidas (modulo_origem);
CREATE INDEX IF NOT EXISTS idx_saidas_itens_gin ON saidas USING gin (itens);

CREATE TABLE IF NOT EXISTS saida_leituras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saida_id uuid NOT NULL REFERENCES saidas(id) ON DELETE CASCADE,
  usuario_id text NOT NULL,
  visualizado_at timestamptz NOT NULL DEFAULT now(),
  modulo text NOT NULL DEFAULT 'transbordo'
    CHECK (modulo IN ('transbordo', 'industrializacao')),
  CONSTRAINT uq_saida_leituras_saida_usuario_modulo
    UNIQUE (saida_id, usuario_id, modulo)
);

CREATE INDEX IF NOT EXISTS idx_saida_leituras_usuario_modulo
  ON saida_leituras (usuario_id, modulo);
CREATE INDEX IF NOT EXISTS idx_saida_leituras_saida ON saida_leituras (saida_id);

CREATE TABLE IF NOT EXISTS agendamentos_carregamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  horario text NOT NULL,
  tipo text NOT NULL DEFAULT 'regular' CHECK (tipo IN ('regular', 'encaixe')),
  saida_id uuid REFERENCES saidas(id) ON DELETE CASCADE,
  saida_codigo text,
  cliente_id uuid,
  cliente_nome text,
  status text NOT NULL DEFAULT 'agendado'
    CHECK (status IN ('agendado', 'cancelado', 'concluido')),
  usuario_id text,
  usuario_nome text,
  observacao text,
  transportadora text,
  motorista text,
  placa text,
  hora_carregamento text,
  operador_conclusao_id text,
  operador_conclusao_nome text,
  grupo_conclusao_id uuid,
  checklist_respostas jsonb,
  checklist_validado_em timestamptz,
  checklist_operador_id text,
  checklist_operador_nome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agendamentos_slot
  ON agendamentos_carregamento (data, horario);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agendamentos_saida_ativa
  ON agendamentos_carregamento (saida_id)
  WHERE status = 'agendado' AND saida_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agendamentos_data ON agendamentos_carregamento (data);
CREATE INDEX IF NOT EXISTS idx_agendamentos_status ON agendamentos_carregamento (status);
CREATE INDEX IF NOT EXISTS idx_agendamentos_saida ON agendamentos_carregamento (saida_id);
CREATE INDEX IF NOT EXISTS idx_agendamentos_placa ON agendamentos_carregamento (placa);
CREATE INDEX IF NOT EXISTS idx_agendamentos_hora_carregamento
  ON agendamentos_carregamento (hora_carregamento)
  WHERE hora_carregamento IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agendamentos_concluidos
  ON agendamentos_carregamento (status, data DESC, hora_carregamento DESC)
  WHERE status = 'concluido';
CREATE INDEX IF NOT EXISTS idx_agendamentos_grupo_conclusao
  ON agendamentos_carregamento (grupo_conclusao_id)
  WHERE grupo_conclusao_id IS NOT NULL;

-- validacao_id polimórfico (uuid de transbordo_validacoes ou validacoes_mp)
CREATE TABLE IF NOT EXISTS validacao_leituras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  validacao_id text NOT NULL,
  usuario_id text NOT NULL,
  modulo text NOT NULL CHECK (modulo IN ('transbordo', 'industrializacao')),
  visualizado_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_validacao_leituras_item UNIQUE (validacao_id, usuario_id, modulo)
);

CREATE INDEX IF NOT EXISTS idx_validacao_leituras_usuario
  ON validacao_leituras (usuario_id, modulo);
CREATE INDEX IF NOT EXISTS idx_validacao_leituras_validacao
  ON validacao_leituras (validacao_id);

-- Leituras não possuem updated_at (apenas visualizado_at)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'saidas','agendamentos_carregamento'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_set_updated_at ON %1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_set_updated_at BEFORE UPDATE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()', t
    );
  END LOOP;
END $$;
