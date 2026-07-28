-- ============================================================
-- Hotfix: sessão inválida ao salvar checklist operacional
--
-- Problema:
--   A RPC dependia do header x-session-id. Tentativa com
--   set_config('request.header.x-session-id') falha no Postgres:
--   "invalid configuration parameter name".
--
-- Correção:
--   1) get_current_session() lê header legado E request.headers JSON
--   2) submit_operational_checklist aceita p_session_id e resolve
--      a sessão DIRETO na tabela sessions (sem set_config)
--
-- Execute no: Supabase Dashboard → SQL Editor
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. get_current_session: leitura robusta do header
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_current_session()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id text;
  v_headers jsonb;
BEGIN
  BEGIN
    v_session_id := NULLIF(current_setting('request.header.x-session-id', true), '');
  EXCEPTION WHEN OTHERS THEN
    v_session_id := NULL;
  END;

  IF v_session_id IS NULL THEN
    BEGIN
      v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
      v_session_id := NULLIF(v_headers ->> 'x-session-id', '');
    EXCEPTION WHEN OTHERS THEN
      v_session_id := NULL;
    END;
  END IF;

  IF v_session_id IS NULL OR btrim(v_session_id) = '' THEN
    RETURN NULL;
  END IF;

  RETURN (
    SELECT to_jsonb(s.*)
    FROM sessions s
    WHERE s.session_id = btrim(v_session_id)
      AND s.expires_at > now()
    LIMIT 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_current_session() TO anon;
GRANT EXECUTE ON FUNCTION get_current_session() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. RPC com p_session_id explícito (padrão do restante do ChemCtrl)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS submit_operational_checklist(text, text, jsonb);
DROP FUNCTION IF EXISTS submit_operational_checklist(text, text, jsonb, text);

CREATE OR REPLACE FUNCTION submit_operational_checklist(
  p_production_id text,
  p_etapa text,
  p_answers jsonb,
  p_session_id text DEFAULT NULL
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
  v_sid text;
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

  -- Sessão: prioriza p_session_id (body), depois header via get_current_session()
  -- NÃO usar set_config em request.header.* — Postgres rejeita esse nome de GUC.
  v_sid := NULLIF(btrim(COALESCE(p_session_id, '')), '');
  IF v_sid IS NOT NULL THEN
    SELECT to_jsonb(s.*) INTO v_session
    FROM sessions s
    WHERE s.session_id = v_sid
      AND s.expires_at > now()
    LIMIT 1;
  END IF;

  IF v_session IS NULL THEN
    v_session := get_current_session();
  END IF;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'sessão inválida';
  END IF;

  -- Permissões a partir da sessão já resolvida (não depende de GUC)
  IF NOT (
    lower(
      translate(
        coalesce(v_session ->> 'nivel_acesso', ''),
        'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
        'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'
      )
    ) IN ('administrador', 'supervisor', 'operacional', 'operador')
    OR (
      jsonb_typeof(v_session -> 'permissions') = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(v_session -> 'permissions', '[]'::jsonb)) k
        WHERE k = ANY (ARRAY[
          'production_orders.edit',
          'production_orders.create',
          'productions.edit_op',
          'productions.create_op',
          'productions.finish',
          'productions.complement',
          'inventory.edit'
        ])
      )
    )
    OR (v_session -> 'permissions') ?| ARRAY[
      'production_orders.edit',
      'production_orders.create',
      'productions.edit_op',
      'productions.create_op',
      'productions.finish',
      'productions.complement',
      'inventory.edit'
    ]
  ) THEN
    RAISE EXCEPTION 'sem permissão para registrar checklist operacional';
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

GRANT EXECUTE ON FUNCTION submit_operational_checklist(text, text, jsonb, text) TO anon;
GRANT EXECUTE ON FUNCTION submit_operational_checklist(text, text, jsonb, text) TO authenticated;
