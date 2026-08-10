-- ============================================================================
-- ChemCtrl — Rename tabelas ChemBlend → prefixo ind_ (industrialização)
-- ============================================================================
-- Execute no: Supabase Dashboard → SQL Editor (projeto ChemBlend)
--
-- Pré-requisito: schema atual com nomes antigos (usuarios, productions, …).
-- Idempotente: só renomeia se o nome antigo existir e o novo ainda não.
--
-- Após aplicar: deploy imediato do frontend com entityTableMap atualizado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper: rename seguro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _chemctrl_rename_table(p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = p_old
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = p_new
  ) THEN
    EXECUTE format('ALTER TABLE public.%I RENAME TO %I', p_old, p_new);
  END IF;
END;
$$;

SELECT _chemctrl_rename_table('usuarios', 'ind_lista_usuarios');
SELECT _chemctrl_rename_table('productions', 'ind_lista_producoes');
SELECT _chemctrl_rename_table('orders', 'ind_lista_pedidos');
SELECT _chemctrl_rename_table('recipes', 'ind_lista_receitas');
SELECT _chemctrl_rename_table('raw_material_stocks', 'ind_estoque_mp');
SELECT _chemctrl_rename_table('stock_movements', 'ind_retornos_perdas');
SELECT _chemctrl_rename_table('tanks', 'ind_cadastro_tanka');
SELECT _chemctrl_rename_table('transfers', 'ind_transbordo_ind');
SELECT _chemctrl_rename_table('containers', 'ind_lista_vasilhames');
SELECT _chemctrl_rename_table('container_origins', 'ind_composicao_vasilhame');
SELECT _chemctrl_rename_table('inventories', 'ind_lista_inventario');
SELECT _chemctrl_rename_table('production_checklists', 'ind_checklist_op');
SELECT _chemctrl_rename_table('quality_tests', 'ind_cq_esp_tec');
SELECT _chemctrl_rename_table('quality_analyses', 'ind_lista_ensaios');
SELECT _chemctrl_rename_table('quality_results', 'ind_cq_resultados');
SELECT _chemctrl_rename_table('lab_equipments', 'ind_lista_equipamentoslab');

DROP FUNCTION IF EXISTS _chemctrl_rename_table(text, text);

-- ---------------------------------------------------------------------------
-- 2. Realtime — REPLICA IDENTITY FULL + publication
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'ind_lista_usuarios',
    'ind_lista_producoes',
    'ind_lista_pedidos',
    'ind_lista_receitas',
    'ind_estoque_mp',
    'ind_retornos_perdas',
    'ind_cadastro_tanka',
    'ind_transbordo_ind',
    'ind_lista_vasilhames',
    'ind_composicao_vasilhame',
    'ind_lista_inventario',
    'ind_checklist_op',
    'ind_cq_esp_tec',
    'ind_lista_ensaios',
    'ind_cq_resultados',
    'ind_lista_equipamentoslab'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
      BEGIN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN undefined_object THEN NULL;
      END;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. RPCs / triggers — corpos com nomes novos
-- ---------------------------------------------------------------------------

-- 3a. Auth: login_user (rate limit + RBAC + preferred_language)
CREATE OR REPLACE FUNCTION login_user(p_username text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row jsonb;
  v_session_id text;
  v_permissions jsonb := '[]'::jsonb;
  v_perfil jsonb;
  v_perfil_id text;
  v_senha_hash text;
  v_status text;
  v_admin_id text;
BEGIN
  PERFORM check_login_rate_limit(p_username);

  SELECT to_jsonb(u) INTO v_row
  FROM ind_lista_usuarios u
  WHERE u.usuario = p_username
  LIMIT 1;

  IF v_row IS NULL THEN
    PERFORM register_failed_login_attempt(p_username);
    RETURN jsonb_build_object('success', false, 'error', 'Usuário ou senha inválidos.');
  END IF;

  v_status := COALESCE(v_row->>'status', 'Ativo');
  IF v_status = 'Inativo' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário inativo. Contate o administrador do sistema.');
  END IF;

  v_senha_hash := v_row->>'senha_hash';
  IF v_senha_hash IS NULL OR v_senha_hash = '' OR v_senha_hash != extensions.crypt(p_password, v_senha_hash) THEN
    PERFORM register_failed_login_attempt(p_username);
    RETURN jsonb_build_object('success', false, 'error', 'Usuário ou senha inválidos.');
  END IF;

  v_perfil_id := NULLIF(v_row->>'perfil_id', '');

  IF v_perfil_id IS NULL THEN
    SELECT id INTO v_admin_id
    FROM perfis
    WHERE slug = 'administrador' OR nome = 'Administrador' OR id = 'perfil_administrador'
    LIMIT 1;

    IF v_admin_id IS NOT NULL THEN
      UPDATE ind_lista_usuarios SET perfil_id = v_admin_id WHERE id = v_row->>'id';
      v_perfil_id := v_admin_id;
    END IF;
  END IF;

  IF v_perfil_id IS NOT NULL THEN
    v_permissions := get_profile_permission_keys(v_perfil_id);
    SELECT to_jsonb(p) INTO v_perfil
    FROM perfis p
    WHERE p.id = v_perfil_id
    LIMIT 1;
  END IF;

  v_session_id := gen_random_uuid()::text;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'permissions'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'perfil_id'
  ) THEN
    INSERT INTO sessions (
      session_id, user_id, nome_completo, usuario, nivel_acesso, tipo, cliente, cargo,
      expires_at, perfil_id, permissions
    )
    VALUES (
      v_session_id,
      v_row->>'id',
      v_row->>'nome_completo',
      v_row->>'usuario',
      v_row->>'nivel_acesso',
      COALESCE(v_row->>'tipo', 'interno'),
      v_row->>'cliente',
      v_row->>'cargo',
      now() + interval '24 hours',
      v_perfil_id,
      COALESCE(v_permissions, '[]'::jsonb)
    );
    BEGIN
      UPDATE sessions SET last_activity = now() WHERE session_id = v_session_id;
    EXCEPTION WHEN undefined_column THEN
      NULL;
    END;
  ELSE
    INSERT INTO sessions (
      session_id, user_id, nome_completo, usuario, nivel_acesso, tipo, cliente, cargo, expires_at
    )
    VALUES (
      v_session_id,
      v_row->>'id',
      v_row->>'nome_completo',
      v_row->>'usuario',
      v_row->>'nivel_acesso',
      COALESCE(v_row->>'tipo', 'interno'),
      v_row->>'cliente',
      v_row->>'cargo',
      now() + interval '24 hours'
    );
  END IF;

  PERFORM reset_login_attempts(p_username);

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'user', jsonb_build_object(
      'id', v_row->>'id',
      'nome_completo', v_row->>'nome_completo',
      'usuario', v_row->>'usuario',
      'nivel_acesso', v_row->>'nivel_acesso',
      'status', v_status,
      'tipo', COALESCE(v_row->>'tipo', 'interno'),
      'cliente', v_row->>'cliente',
      'cargo', v_row->>'cargo',
      'preferred_language', COALESCE(NULLIF(v_row->>'preferred_language', ''), 'pt-BR'),
      'perfil_id', v_perfil_id,
      'perfil', CASE
        WHEN v_perfil IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', v_perfil->>'id',
          'nome', v_perfil->>'nome',
          'slug', v_perfil->>'slug',
          'default_route', v_perfil->>'default_route'
        )
      END,
      'permissions', COALESCE(v_permissions, '[]'::jsonb)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION login_user(text, text) TO anon;

-- 3b. update_user_language
CREATE OR REPLACE FUNCTION update_user_language(p_session_id text, p_language text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id text;
BEGIN
  IF p_language NOT IN ('pt-BR', 'en', 'es', 'fr') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid language.');
  END IF;

  SELECT user_id INTO v_user_id
  FROM sessions
  WHERE session_id = p_session_id
    AND expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session expired.');
  END IF;

  UPDATE ind_lista_usuarios
  SET preferred_language = p_language,
      updated_date = now()
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true, 'preferred_language', p_language);
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_language(text, text) TO anon;

-- 3c. manage_usuarios trigger (reattach on new table name)
CREATE OR REPLACE FUNCTION manage_usuarios()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.senha IS NOT NULL AND btrim(NEW.senha) <> '') THEN
    NEW.senha_hash := extensions.crypt(NEW.senha, extensions.gen_salt('bf', 10));
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.senha_hash := COALESCE(NEW.senha_hash, OLD.senha_hash);
    IF NEW.senha IS NULL OR btrim(NEW.senha) = '' THEN
      NEW.senha := OLD.senha;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS manage_usuarios_trigger ON ind_lista_usuarios;
CREATE TRIGGER manage_usuarios_trigger
  BEFORE INSERT OR UPDATE ON ind_lista_usuarios
  FOR EACH ROW EXECUTE FUNCTION manage_usuarios();

-- 3d. RBAC helpers that count users
CREATE OR REPLACE FUNCTION _rbac_active_admin_user_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM ind_lista_usuarios u
  JOIN perfis p ON p.id = u.perfil_id
  WHERE u.status = 'Ativo'
    AND (p.slug = 'administrador' OR p.id = 'perfil_administrador');
$$;

CREATE OR REPLACE FUNCTION list_profiles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    has_permission('profiles.view')
    OR has_permission('users.view')
    OR (get_current_session() ->> 'nivel_acesso') = 'Administrador'
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.nome)
    FROM (
      SELECT
        p.id,
        p.nome,
        p.slug,
        p.descricao,
        p.status,
        p.is_system,
        p.default_route,
        p.created_date,
        p.updated_date,
        (SELECT COUNT(*) FROM ind_lista_usuarios u WHERE u.perfil_id = p.id) AS users_count,
        (SELECT COUNT(*) FROM perfil_permissoes pp WHERE pp.perfil_id = p.id) AS permissions_count
      FROM perfis p
    ) r
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION delete_profile(p_perfil_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil record;
  v_users integer;
BEGIN
  PERFORM _rbac_require_profiles_edit();
  SELECT * INTO v_perfil FROM perfis WHERE id = p_perfil_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfil não encontrado');
  END IF;
  IF v_perfil.is_system OR v_perfil.slug = 'administrador' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfis de sistema não podem ser excluídos');
  END IF;

  SELECT COUNT(*) INTO v_users FROM ind_lista_usuarios WHERE perfil_id = p_perfil_id;
  IF v_users > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Existem usuários vinculados a este perfil');
  END IF;

  PERFORM _rbac_audit(p_perfil_id, 'delete', jsonb_build_object('nome', v_perfil.nome));
  DELETE FROM perfis WHERE id = p_perfil_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- 3e. Sync pedido cliente → OPs
CREATE OR REPLACE FUNCTION sync_order_client_order_to_productions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.client_order IS DISTINCT FROM OLD.client_order THEN
    UPDATE ind_lista_producoes
    SET
      client_order = NEW.client_order,
      updated_date = now()
    WHERE order_id = NEW.id
      AND client_order IS DISTINCT FROM NEW.client_order;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_client_order ON ind_lista_pedidos;
CREATE TRIGGER trg_sync_order_client_order
  AFTER UPDATE OF client_order ON ind_lista_pedidos
  FOR EACH ROW
  EXECUTE FUNCTION sync_order_client_order_to_productions();

-- 3f. FDS / público
CREATE OR REPLACE FUNCTION resolve_recipe_fds_for_production(p_production_id text)
RETURNS TABLE(fds_url text, fds_filename text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH prod AS (
    SELECT id, recipe_id, product
    FROM ind_lista_producoes
    WHERE id = p_production_id
  ),
  by_recipe_id AS (
    SELECT r.fds_url, r.fds_filename
    FROM prod p
    JOIN ind_lista_receitas r ON r.id = p.recipe_id
    WHERE r.fds_url IS NOT NULL AND r.fds_url <> ''
    LIMIT 1
  ),
  by_product_name AS (
    SELECT r.fds_url, r.fds_filename
    FROM prod p
    JOIN ind_lista_receitas r ON r.product_name = p.product
    WHERE r.fds_url IS NOT NULL AND r.fds_url <> ''
    ORDER BY r.fds_uploaded_at DESC NULLS LAST, r.updated_date DESC NULLS LAST
    LIMIT 1
  )
  SELECT * FROM by_recipe_id
  UNION ALL
  SELECT * FROM by_product_name
  WHERE NOT EXISTS (SELECT 1 FROM by_recipe_id)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_public_lot_info(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (SELECT enforce_public_rate_limit('get_public_lot_info'))
  SELECT jsonb_build_object(
    'product', p.product,
    'client', p.client,
    'lot', p.lot,
    'mfg_date', p.end_time,
    'expiry_date', CASE
      WHEN p.end_time IS NOT NULL AND r.validity_days IS NOT NULL
      THEN (p.end_time::date + (r.validity_days || ' day')::interval)::text
      ELSE NULL
    END,
    'status', p.status,
    'op_number', p.op_number,
    'has_coa', EXISTS(
      SELECT 1 FROM ind_cq_resultados qr
      WHERE qr.production_id = p.id
        AND qr.results IS NOT NULL
        AND qr.results::text NOT IN ('[]', 'null', '')
    ),
    'has_sds', EXISTS(
      SELECT 1 FROM resolve_recipe_fds_for_production(p.id)
    )
  )
  FROM guard, ind_lista_producoes p
  LEFT JOIN ind_lista_receitas r ON r.id = p.recipe_id
  WHERE p.public_token = p_token
    AND p.status != 'Cancelado';
$$;

CREATE OR REPLACE FUNCTION get_public_coa_data(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (SELECT enforce_public_rate_limit('get_public_coa_data'))
  SELECT jsonb_build_object(
    'result', jsonb_build_object(
      'product', qr.product,
      'lot', qr.lot,
      'client', qr.client,
      'op_number', qr.op_number,
      'observations', qr.observations,
      'results', qr.results,
      'sample_photo_url', null::text
    ),
    'production', jsonb_build_object(
      'end_time', p.end_time,
      'mass', p.mass,
      'client_order', p.client_order
    ),
    'containers', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'container_number', c.container_number,
        'barril_number', c.barril_number,
        'volume', c.volume
      ))
      FROM ind_lista_vasilhames c WHERE c.op_number = p.op_number),
      '[]'::jsonb
    ),
    'recipe', jsonb_build_object(
      'validity_days', r.validity_days
    )
  )
  FROM guard, ind_lista_producoes p
  JOIN ind_cq_resultados qr ON qr.production_id = p.id
  LEFT JOIN ind_lista_receitas r ON r.id = p.recipe_id
  WHERE p.public_token = p_token
    AND p.status != 'Cancelado'
  ORDER BY qr.updated_date DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_public_sds_path(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (SELECT enforce_public_rate_limit('get_public_sds_path'))
  SELECT CASE
    WHEN f.fds_url IS NOT NULL AND f.fds_url <> '' THEN
      jsonb_build_object(
        'has_sds', true,
        'fds_url', f.fds_url,
        'fds_filename', COALESCE(f.fds_filename, 'sds.pdf')
      )
    ELSE
      jsonb_build_object('has_sds', false)
  END
  FROM guard, ind_lista_producoes p
  LEFT JOIN LATERAL resolve_recipe_fds_for_production(p.id) f ON true
  WHERE p.public_token = p_token
    AND p.status != 'Cancelado'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_public_lot_info(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_coa_data(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_sds_path(text) TO anon, authenticated, service_role;

-- 3g. Estoque MP público
CREATE OR REPLACE FUNCTION get_public_raw_material_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  stock_row ind_estoque_mp%ROWTYPE;
  productions_json jsonb := '[]'::jsonb;
  movements_json jsonb := '[]'::jsonb;
BEGIN
  PERFORM enforce_public_rate_limit('get_public_raw_material_info');

  BEGIN
    PERFORM set_config('row_security', 'off', true);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  SELECT * INTO stock_row
  FROM ind_estoque_mp s
  WHERE s.public_token = p_token;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
    INTO productions_json
    FROM (
      SELECT
        p.op_number,
        p.product,
        p.date,
        safe_jsonb_numeric(elem->>'qty_fiscal') AS qty_fiscal,
        safe_jsonb_numeric(elem->>'qty_operational') AS qty_operational
      FROM ind_lista_producoes p
      CROSS JOIN LATERAL jsonb_array_elements(normalize_jsonb_array(p.raw_materials_used)) AS elem
      WHERE COALESCE(p.status, '') <> 'Cancelado'
        AND elem->>'stock_id' = stock_row.id
      ORDER BY p.date DESC NULLS LAST
    ) q;
  EXCEPTION WHEN OTHERS THEN
    productions_json := '[]'::jsonb;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
    INTO movements_json
    FROM (
      SELECT
        m.movement_date,
        m.destination,
        m.quantity,
        m.unit,
        m.balance_before,
        m.balance_after
      FROM ind_retornos_perdas m
      WHERE m.stock_id = stock_row.id
         OR (
           m.entry_id IS NOT NULL
           AND stock_row.entry_id IS NOT NULL
           AND m.entry_id = stock_row.entry_id
         )
      ORDER BY m.movement_date DESC NULLS LAST
    ) q;
  EXCEPTION WHEN OTHERS THEN
    movements_json := '[]'::jsonb;
  END;

  result := jsonb_build_object(
    'type', 'raw_material',
    'entry_id', stock_row.entry_id,
    'entry_date', stock_row.entry_date,
    'mp_code', stock_row.mp_code,
    'mp_name', stock_row.mp_name,
    'client', stock_row.client,
    'lot', stock_row.lot,
    'supplier', stock_row.supplier,
    'manufacture_date', stock_row.manufacture_date,
    'expiry_date', stock_row.expiry_date,
    'unit', stock_row.unit,
    'initial_stock', stock_row.initial_stock,
    'current_stock', stock_row.current_stock,
    'unit_price', stock_row.unit_price,
    'packaging_type', stock_row.packaging_type,
    'packaging_capacity', stock_row.packaging_capacity,
    'packaging_quantity', stock_row.packaging_quantity,
    'observations', stock_row.observations,
    'productions', COALESCE(productions_json, '[]'::jsonb),
    'movements', COALESCE(movements_json, '[]'::jsonb)
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_raw_material_info(text) TO anon, authenticated;

-- 3h. Checklist operacional
CREATE OR REPLACE FUNCTION can_register_operational_checklist()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    can_write()
    OR has_any_permission(ARRAY[
      'production_orders.edit',
      'production_orders.create',
      'productions.edit_op',
      'productions.create_op',
      'productions.finish',
      'productions.complement'
    ])
    OR (
      (get_current_session() ->> 'tipo') = 'interno'
      AND lower(
        translate(
          coalesce(get_current_session() ->> 'nivel_acesso', ''),
          'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
          'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'
        )
      ) IN ('administrador', 'supervisor', 'operacional', 'operador')
    ),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION can_register_operational_checklist() TO anon;
GRANT EXECUTE ON FUNCTION can_register_operational_checklist() TO authenticated;

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
    FROM ind_checklist_op pc
    WHERE pc.production_id = p_production_id
      AND pc.etapa = p_etapa
      AND (p_since IS NULL OR pc.answered_at >= p_since)
  );
$$;

GRANT EXECUTE ON FUNCTION has_operational_checklist(text, text, timestamptz) TO anon;
GRANT EXECUTE ON FUNCTION has_operational_checklist(text, text, timestamptz) TO authenticated;

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

  v_session := get_current_session();
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'sessão inválida';
  END IF;

  IF NOT can_register_operational_checklist() THEN
    RAISE EXCEPTION 'sem permissão para registrar checklist operacional';
  END IF;

  v_user_id := v_session ->> 'user_id';
  v_user_nome := COALESCE(
    NULLIF(v_session ->> 'nome_completo', ''),
    NULLIF(v_session ->> 'usuario', ''),
    'desconhecido'
  );

  SELECT * INTO v_prod FROM ind_lista_producoes WHERE id = p_production_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'produção não encontrada';
  END IF;

  IF v_prod.recipe_id IS NOT NULL AND btrim(v_prod.recipe_id) <> '' THEN
    SELECT COALESCE(r.necessita_n2, false)
      INTO v_necessita_n2
    FROM ind_lista_receitas r
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

    INSERT INTO ind_checklist_op (
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

GRANT EXECUTE ON FUNCTION submit_operational_checklist(text, text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION submit_operational_checklist(text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION require_operational_checklist_on_production()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status = 'Aguardando Início'
     AND NEW.status = 'Em Produção'
  THEN
    IF NOT has_operational_checklist(NEW.id, 'start_production', now() - interval '15 minutes') THEN
      RAISE EXCEPTION 'Checklist operacional obrigatório antes de iniciar a produção (start_production).';
    END IF;
  END IF;

  IF OLD.pause_start_time IS NULL AND NEW.pause_start_time IS NOT NULL THEN
    IF NOT has_operational_checklist(NEW.id, 'pause_production', now() - interval '15 minutes') THEN
      RAISE EXCEPTION 'Checklist operacional obrigatório antes de pausar a produção (pause_production).';
    END IF;
  END IF;

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

DROP TRIGGER IF EXISTS trg_require_operational_checklist ON ind_lista_producoes;
CREATE TRIGGER trg_require_operational_checklist
  BEFORE UPDATE ON ind_lista_producoes
  FOR EACH ROW
  EXECUTE FUNCTION require_operational_checklist_on_production();

-- 3i. Grants de coluna em usuários (após rename)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ind_lista_usuarios'
  ) THEN
    EXECUTE 'GRANT SELECT (id, created_date, updated_date, created_by_id, nome_completo, usuario, senha, nivel_acesso, status, cargo, tipo, cliente, criado_por, preferred_language, perfil_id) ON ind_lista_usuarios TO anon';
    EXECUTE 'GRANT INSERT (id, created_date, updated_date, created_by_id, nome_completo, usuario, senha, nivel_acesso, status, cargo, tipo, cliente, criado_por, preferred_language, perfil_id) ON ind_lista_usuarios TO anon';
    EXECUTE 'GRANT UPDATE (nome_completo, usuario, senha, nivel_acesso, status, cargo, tipo, cliente, criado_por, preferred_language, perfil_id) ON ind_lista_usuarios TO anon';
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT pg_notify('pgrst', 'reload schema');

-- Verificação opcional:
-- SELECT tablename FROM pg_tables
-- WHERE schemaname = 'public' AND tablename LIKE 'ind_%'
-- ORDER BY tablename;
