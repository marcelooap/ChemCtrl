-- ============================================================
-- Migration: Checklists Operacionais Obrigatórios
-- Tabela production_checklists + RPC + trigger de gate
-- Execute no: Supabase Dashboard → SQL Editor
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_checklists (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  production_id text NOT NULL,
  op_number text,
  product text,
  recipe_id text,
  recipe_revision text,
  etapa text NOT NULL
    CHECK (etapa IN (
      'start_production',
      'pause_production',
      'start_filling',
      'finish_filling'
    )),
  question_key text NOT NULL,
  question_label text NOT NULL,
  answer text NOT NULL,
  observacao text,
  usuario_id text,
  usuario_nome text,
  answered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_production_checklists_prod_etapa
  ON production_checklists (production_id, etapa);

CREATE INDEX IF NOT EXISTS idx_production_checklists_etapa_answered
  ON production_checklists (etapa, answered_at);

DROP TRIGGER IF EXISTS update_updated_date_production_checklists ON production_checklists;
CREATE TRIGGER update_updated_date_production_checklists
  BEFORE UPDATE ON production_checklists
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_date();

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE production_checklists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "production_checklists_select" ON production_checklists;
DROP POLICY IF EXISTS "production_checklists_insert" ON production_checklists;
DROP POLICY IF EXISTS "production_checklists_update" ON production_checklists;
DROP POLICY IF EXISTS "production_checklists_delete" ON production_checklists;

CREATE POLICY "production_checklists_select" ON production_checklists
  FOR SELECT USING (is_internal_user() OR can_write());

CREATE POLICY "production_checklists_insert" ON production_checklists
  FOR INSERT WITH CHECK (can_write());

CREATE POLICY "production_checklists_update" ON production_checklists
  FOR UPDATE USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "production_checklists_delete" ON production_checklists
  FOR DELETE USING (is_admin());

-- ---------------------------------------------------------------------------
-- 3. Helper: checklist concluído para etapa
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION has_operational_checklist(
  p_production_id text,
  p_etapa text,
  p_since timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM production_checklists pc
    WHERE pc.production_id = p_production_id
      AND pc.etapa = p_etapa
      AND (p_since IS NULL OR pc.answered_at >= p_since)
  );
$$;

GRANT EXECUTE ON FUNCTION has_operational_checklist(text, text, timestamptz) TO anon;
GRANT EXECUTE ON FUNCTION has_operational_checklist(text, text, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC: submit_operational_checklist
-- p_answers: jsonb array of { question_key, question_label, answer, observacao }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_operational_checklist(
  p_production_id text,
  p_etapa text,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session jsonb;
  v_user_id text;
  v_user_nome text;
  v_prod record;
  v_necessita_n2 boolean := false;
  v_answer jsonb;
  v_key text;
  v_ans text;
  v_obs text;
  v_label text;
  v_keys text[] := ARRAY[]::text[];
  v_required text[];
  v_inserted int := 0;
BEGIN
  IF p_production_id IS NULL OR btrim(p_production_id) = '' THEN
    RAISE EXCEPTION 'production_id é obrigatório';
  END IF;

  IF p_etapa NOT IN ('start_production', 'pause_production', 'start_filling', 'finish_filling') THEN
    RAISE EXCEPTION 'etapa inválida: %', p_etapa;
  END IF;

  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'array' OR jsonb_array_length(p_answers) = 0 THEN
    RAISE EXCEPTION 'respostas do checklist são obrigatórias';
  END IF;

  IF NOT can_write() THEN
    RAISE EXCEPTION 'sem permissão para registrar checklist operacional';
  END IF;

  v_session := get_current_session();
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'sessão inválida';
  END IF;

  v_user_id := v_session ->> 'user_id';
  v_user_nome := COALESCE(
    NULLIF(v_session ->> 'nome_completo', ''),
    NULLIF(v_session ->> 'usuario', ''),
    'desconhecido'
  );

  SELECT * INTO v_prod FROM productions WHERE id = p_production_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'produção não encontrada';
  END IF;

  IF v_prod.recipe_id IS NOT NULL AND btrim(v_prod.recipe_id) <> '' THEN
    SELECT COALESCE(r.necessita_n2, false)
      INTO v_necessita_n2
    FROM recipes r
    WHERE r.id = v_prod.recipe_id;
    IF NOT FOUND THEN
      v_necessita_n2 := false;
    END IF;
  END IF;

  -- Index answers by key for validation
  FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    v_key := v_answer ->> 'question_key';
    v_ans := lower(btrim(COALESCE(v_answer ->> 'answer', '')));
    v_obs := NULLIF(btrim(COALESCE(v_answer ->> 'observacao', '')), '');
    v_label := COALESCE(NULLIF(btrim(v_answer ->> 'question_label'), ''), v_key);

    IF v_key IS NULL OR btrim(v_key) = '' THEN
      RAISE EXCEPTION 'question_key é obrigatório';
    END IF;
    IF v_ans = '' THEN
      RAISE EXCEPTION 'resposta obrigatória para %', v_key;
    END IF;

    v_keys := array_append(v_keys, v_key);

    -- ---- Validação por etapa / pergunta (espelha o frontend) ----
    IF p_etapa = 'start_production' THEN
      IF v_key = 'equipment_grounding' THEN
        IF v_necessita_n2 THEN
          IF v_ans <> 'sim' THEN
            RAISE EXCEPTION 'Produtos inflamáveis somente podem ser produzidos com equipamentos devidamente aterrados.';
          END IF;
        ELSIF v_ans NOT IN ('sim', 'nao', 'nao_se_aplica') THEN
          RAISE EXCEPTION 'resposta inválida para aterramento';
        END IF;
      ELSIF v_key = 'n2_inertization' THEN
        IF NOT v_necessita_n2 THEN
          RAISE EXCEPTION 'pergunta de inertização N2 não se aplica a esta receita';
        END IF;
        IF v_ans <> 'sim' THEN
          RAISE EXCEPTION 'Produtos inflamáveis somente podem ser produzidos após a inertização do misturador com N₂ e confirmação de teor de oxigênio igual ou inferior a 8%%.';
        END IF;
      ELSIF v_key IN ('scale_ok', 'mixer_empty', 'joints_hoses', 'ppe_used') THEN
        IF v_ans <> 'sim' THEN
          IF v_key = 'ppe_used' THEN
            RAISE EXCEPTION 'É obrigatório utilizar os EPIs antes do início da produção.';
          END IF;
          RAISE EXCEPTION 'resposta obrigatória Sim para %', v_key;
        END IF;
      END IF;

    ELSIF p_etapa = 'pause_production' THEN
      IF v_key = 'valves_double_block' AND v_ans <> 'confirmado' THEN
        RAISE EXCEPTION 'Esta confirmação é obrigatória antes de pausar a produção.';
      END IF;

    ELSIF p_etapa = 'start_filling' THEN
      IF v_key = 'packaging_clean' THEN
        IF v_ans NOT IN ('sim', 'nao') THEN
          RAISE EXCEPTION 'resposta inválida para limpeza da embalagem';
        END IF;
        IF v_ans = 'nao' AND v_obs IS NULL THEN
          RAISE EXCEPTION 'observação obrigatória quando a embalagem não está limpa';
        END IF;
      ELSIF v_key = 'packaging_damage' THEN
        IF v_ans NOT IN ('sim', 'nao') THEN
          RAISE EXCEPTION 'resposta inválida para avaria da embalagem';
        END IF;
        IF v_ans = 'sim' AND v_obs IS NULL THEN
          RAISE EXCEPTION 'observação obrigatória quando há avaria na embalagem';
        END IF;
      ELSIF v_key = 'packaging_grounding' THEN
        IF v_necessita_n2 THEN
          IF v_ans <> 'sim' THEN
            RAISE EXCEPTION 'Produtos inflamáveis exigem aterramento da embalagem durante o envase.';
          END IF;
        ELSIF v_ans NOT IN ('sim', 'nao', 'nao_se_aplica') THEN
          RAISE EXCEPTION 'resposta inválida para aterramento da embalagem';
        END IF;
      END IF;

    ELSIF p_etapa = 'finish_filling' THEN
      IF v_key = 'packaging_sealed' THEN
        IF v_ans NOT IN ('sim', 'nao', 'nao_se_aplica') THEN
          RAISE EXCEPTION 'resposta inválida para lacre';
        END IF;
      ELSIF v_key = 'packaging_labeled' THEN
        IF v_ans <> 'sim' THEN
          RAISE EXCEPTION 'Todas as embalagens devem ser identificadas antes da finalização.';
        END IF;
      ELSIF v_key = 'packaging_externally_clean' THEN
        IF v_ans <> 'sim' THEN
          RAISE EXCEPTION 'As embalagens devem ser limpas antes da finalização do envase.';
        END IF;
      END IF;
    END IF;

    INSERT INTO production_checklists (
      production_id,
      op_number,
      product,
      recipe_id,
      recipe_revision,
      etapa,
      question_key,
      question_label,
      answer,
      observacao,
      usuario_id,
      usuario_nome,
      answered_at
    ) VALUES (
      v_prod.id,
      v_prod.op_number,
      v_prod.product,
      v_prod.recipe_id,
      v_prod.recipe_revision,
      p_etapa,
      v_key,
      v_label,
      v_ans,
      v_obs,
      v_user_id,
      v_user_nome,
      now()
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  -- Perguntas obrigatórias presentes
  IF p_etapa = 'start_production' THEN
    v_required := ARRAY['equipment_grounding', 'scale_ok', 'mixer_empty', 'joints_hoses', 'ppe_used'];
    IF v_necessita_n2 THEN
      v_required := array_append(v_required, 'n2_inertization');
    END IF;
  ELSIF p_etapa = 'pause_production' THEN
    v_required := ARRAY['valves_double_block'];
  ELSIF p_etapa = 'start_filling' THEN
    v_required := ARRAY['packaging_clean', 'packaging_damage', 'packaging_grounding'];
  ELSIF p_etapa = 'finish_filling' THEN
    v_required := ARRAY['packaging_sealed', 'packaging_labeled', 'packaging_externally_clean'];
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_required) req
    WHERE NOT (req = ANY (v_keys))
  ) THEN
    RAISE EXCEPTION 'checklist incompleto para a etapa %', p_etapa;
  END IF;

  -- Perguntas extras não permitidas (ex.: n2 quando não inflamável)
  IF p_etapa = 'start_production' AND NOT v_necessita_n2 AND 'n2_inertization' = ANY (v_keys) THEN
    RAISE EXCEPTION 'pergunta de inertização N2 não se aplica a esta receita';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'etapa', p_etapa,
    'production_id', p_production_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION submit_operational_checklist(text, text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION submit_operational_checklist(text, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Trigger: impedir ações sem checklist
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION require_operational_checklist_on_production()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Início da produção
  IF OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status = 'Aguardando Início'
     AND NEW.status = 'Em Produção'
  THEN
    IF NOT has_operational_checklist(NEW.id, 'start_production', now() - interval '15 minutes') THEN
      RAISE EXCEPTION 'Checklist operacional obrigatório antes de iniciar a produção (start_production).';
    END IF;
  END IF;

  -- Pausa (Salvar Progresso)
  IF OLD.pause_start_time IS NULL AND NEW.pause_start_time IS NOT NULL THEN
    IF NOT has_operational_checklist(NEW.id, 'pause_production', now() - interval '15 minutes') THEN
      RAISE EXCEPTION 'Checklist operacional obrigatório antes de pausar a produção (pause_production).';
    END IF;
  END IF;

  -- Finalizar envase
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'Finalizado' THEN
    IF NOT has_operational_checklist(NEW.id, 'start_filling', NULL) THEN
      RAISE EXCEPTION 'Checklist operacional obrigatório antes do envase (start_filling).';
    END IF;
    IF NOT has_operational_checklist(NEW.id, 'finish_filling', now() - interval '15 minutes') THEN
      RAISE EXCEPTION 'Checklist operacional obrigatório antes de finalizar o envase (finish_filling).';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_operational_checklist ON productions;
CREATE TRIGGER trg_require_operational_checklist
  BEFORE UPDATE ON productions
  FOR EACH ROW
  EXECUTE FUNCTION require_operational_checklist_on_production();
