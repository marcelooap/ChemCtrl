-- =============================================================================
-- 067_t_estoque_ajustes_manuais.sql
-- Ledger + RPC atômica de ajuste manual de saldo (Estoque / Armazenagem).
-- Exclusivo para perfil Administrador. Não cria OP/entrada/saída/produção.
-- Idempotente. Aplicar no SQL Editor do Supabase.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tabela de movimentações de ajuste manual
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS t_estoque_ajustes_manuais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estoque_id uuid NOT NULL,
  estoque_produtos_id bigint REFERENCES estoque_produtos(id) ON DELETE SET NULL,
  tipo_local text NOT NULL CHECK (tipo_local IN ('embalado', 'tanque', 'tanka')),
  tipo_ajuste text NOT NULL CHECK (tipo_ajuste IN ('aumentar', 'diminuir')),
  quantidade numeric NOT NULL CHECK (quantidade > 0),
  quantidade_signed numeric NOT NULL,
  volume_l numeric,
  saldo_anterior numeric NOT NULL,
  saldo_posterior numeric NOT NULL,
  saldo_estoque_anterior numeric,
  saldo_estoque_posterior numeric,
  unidade_medida text,
  vasilhame_id uuid REFERENCES t_vasilhames(id) ON DELETE SET NULL,
  tanka_id uuid,
  tanka_codigo text,
  vasilhame_placa text,
  produto_codigo text,
  produto_nome text,
  cliente_nome text,
  lote text,
  justificativa text NOT NULL CHECK (length(btrim(justificativa)) > 0),
  usuario_id text,
  usuario_nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_t_estoque_ajustes_estoque_id
  ON t_estoque_ajustes_manuais (estoque_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_t_estoque_ajustes_vasilhame_id
  ON t_estoque_ajustes_manuais (vasilhame_id, created_at DESC)
  WHERE vasilhame_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_t_estoque_ajustes_tanka
  ON t_estoque_ajustes_manuais (tanka_id, tanka_codigo, created_at DESC)
  WHERE tipo_local = 'tanka';

ALTER TABLE t_estoque_ajustes_manuais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chemflow_anon_all_t_estoque_ajustes_manuais
  ON t_estoque_ajustes_manuais;
CREATE POLICY chemflow_anon_all_t_estoque_ajustes_manuais
  ON t_estoque_ajustes_manuais
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2. Gate admin-only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _require_admin_ajuste_saldo()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session jsonb;
  v_nivel text;
  v_perfil_slug text;
  v_perfil_id text;
BEGIN
  v_session := get_current_session();
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '42501';
  END IF;

  v_nivel := lower(trim(coalesce(v_session ->> 'nivel_acesso', '')));
  v_perfil_slug := lower(trim(coalesce(
    v_session #>> '{perfil,slug}',
    v_session ->> 'perfil_slug',
    ''
  )));
  v_perfil_id := trim(coalesce(
    v_session #>> '{perfil,id}',
    v_session ->> 'perfil_id',
    ''
  ));

  IF v_nivel = 'administrador'
     OR v_perfil_slug = 'administrador'
     OR v_perfil_id = 'perfil_administrador' THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Sem permissão para ajuste manual de saldo (Administrador apenas)'
    USING ERRCODE = '42501';
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. RPC atômica
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION t_ajustar_saldo_estoque(
  p_estoque_id text,
  p_tipo_local text,
  p_tipo_ajuste text,
  p_quantidade numeric,
  p_justificativa text,
  p_vasilhame_id uuid DEFAULT NULL,
  p_tanka_id uuid DEFAULT NULL,
  p_tanka_codigo text DEFAULT NULL,
  p_volume_l numeric DEFAULT NULL,
  p_saldo_local_atual numeric DEFAULT NULL
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
  v_ep estoque_produtos%ROWTYPE;
  v_vas t_vasilhames%ROWTYPE;
  v_tipo_local text;
  v_tipo_ajuste text;
  v_qtd numeric;
  v_signed numeric;
  v_delta_l numeric;
  v_saldo_local_ant numeric;
  v_saldo_local_pos numeric;
  v_saldo_est_ant numeric;
  v_saldo_est_pos numeric;
  v_dens numeric;
  v_peso numeric;
  v_volume_novo numeric;
  v_ajuste_id uuid;
  v_comp jsonb;
BEGIN
  PERFORM _require_admin_ajuste_saldo();

  v_session := get_current_session();
  v_user_id := coalesce(
    v_session ->> 'id',
    v_session ->> 'user_id',
    v_session ->> 'usuario_id',
    ''
  );
  v_user_nome := coalesce(
    nullif(trim(v_session ->> 'nome_completo'), ''),
    nullif(trim(v_session ->> 'nome'), ''),
    nullif(trim(v_session ->> 'name'), ''),
    nullif(trim(v_session ->> 'email'), ''),
    'Administrador'
  );

  v_tipo_local := lower(trim(coalesce(p_tipo_local, '')));
  v_tipo_ajuste := lower(trim(coalesce(p_tipo_ajuste, '')));

  IF v_tipo_local NOT IN ('embalado', 'tanque', 'tanka') THEN
    RAISE EXCEPTION 'Tipo de estoque inválido' USING ERRCODE = '22023';
  END IF;
  IF v_tipo_ajuste NOT IN ('aumentar', 'diminuir') THEN
    RAISE EXCEPTION 'Tipo de ajuste inválido' USING ERRCODE = '22023';
  END IF;

  v_qtd := round(coalesce(p_quantidade, 0)::numeric, 3);
  IF v_qtd IS NULL OR v_qtd <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero' USING ERRCODE = '22023';
  END IF;

  IF p_justificativa IS NULL OR length(btrim(p_justificativa)) = 0 THEN
    RAISE EXCEPTION 'Justificativa obrigatória' USING ERRCODE = '22023';
  END IF;

  IF p_estoque_id IS NULL OR btrim(p_estoque_id) = '' THEN
    RAISE EXCEPTION 'estoque_id obrigatório' USING ERRCODE = '22023';
  END IF;

  -- Serializa ajustes no mesmo item
  PERFORM pg_advisory_xact_lock(67067, hashtext(btrim(p_estoque_id)));

  SELECT *
    INTO v_ep
  FROM estoque_produtos
  WHERE origem = 'ARMAZENAGEM'
    AND legacy_estoque_id::text = btrim(p_estoque_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de estoque não encontrado: %', p_estoque_id
      USING ERRCODE = 'P0002';
  END IF;

  v_signed := CASE WHEN v_tipo_ajuste = 'aumentar' THEN v_qtd ELSE -v_qtd END;
  v_saldo_est_ant := round(coalesce(v_ep.saldo_final, 0)::numeric, 3);
  v_saldo_est_pos := round((v_saldo_est_ant + v_signed)::numeric, 3);

  IF v_saldo_est_pos < 0 THEN
    RAISE EXCEPTION 'Ajuste geraria saldo negativo (disponível %, solicitado %)',
      v_saldo_est_ant, v_qtd
      USING ERRCODE = 'P0001';
  END IF;

  -- Densidade (texto → numeric)
  BEGIN
    v_dens := NULLIF(regexp_replace(replace(coalesce(v_ep.densidade, ''), ',', '.'), '[^0-9.\-]', '', 'g'), '')::numeric;
  EXCEPTION WHEN OTHERS THEN
    v_dens := 0;
  END;
  v_dens := coalesce(v_dens, 0);

  IF v_tipo_local IN ('tanque', 'tanka') THEN
    IF p_vasilhame_id IS NULL THEN
      RAISE EXCEPTION 'Selecione o tanque/tanka para o ajuste' USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO v_vas
    FROM t_vasilhames
    WHERE id = p_vasilhame_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Vasilhame/tanka não encontrado' USING ERRCODE = 'P0002';
    END IF;

    IF coalesce(v_vas.status, 'No Pátio') <> 'No Pátio'
       OR v_vas.data_saida IS NOT NULL THEN
      RAISE EXCEPTION 'Só é permitido ajustar itens No Pátio' USING ERRCODE = 'P0001';
    END IF;

    IF v_tipo_local = 'tanka' AND coalesce(v_vas.tipo, '') <> 'Tankagem' THEN
      RAISE EXCEPTION 'O item selecionado não é uma Tanka' USING ERRCODE = '22023';
    END IF;

    IF v_tipo_local = 'tanque' AND coalesce(v_vas.tipo, '') = 'Tankagem' THEN
      RAISE EXCEPTION 'Use o tipo Tanka para este contentor' USING ERRCODE = '22023';
    END IF;

    v_delta_l := round(coalesce(nullif(p_volume_l, 0), CASE
      WHEN lower(trim(coalesce(v_ep.unidade_medida, ''))) IN ('l', 'lt', 'litro', 'litros')
        THEN v_qtd
      WHEN v_dens > 0 THEN v_qtd / v_dens
      ELSE v_qtd
    END)::numeric, 3);

    IF v_delta_l <= 0 THEN
      RAISE EXCEPTION 'Volume equivalente inválido para o ajuste' USING ERRCODE = '22023';
    END IF;

    -- Saldo local exibido/registrado na UOM do estoque
    v_saldo_local_ant := round(coalesce(p_saldo_local_atual, 0)::numeric, 3);
    IF v_tipo_ajuste = 'diminuir' AND v_qtd > v_saldo_local_ant + 0.001 THEN
      RAISE EXCEPTION 'Redução superior ao saldo disponível (disponível %)',
        v_saldo_local_ant
        USING ERRCODE = 'P0001';
    END IF;

    -- Trava física no volume do tanque (litros)
    IF v_tipo_ajuste = 'diminuir'
       AND v_delta_l > round(coalesce(v_vas.volume, 0)::numeric, 3) + 0.001 THEN
      RAISE EXCEPTION 'Redução superior ao volume físico do tanque/tanka (disponível % L)',
        round(coalesce(v_vas.volume, 0)::numeric, 3)
        USING ERRCODE = 'P0001';
    END IF;

    v_saldo_local_pos := round(
      (CASE WHEN v_tipo_ajuste = 'aumentar'
        THEN v_saldo_local_ant + v_qtd
        ELSE v_saldo_local_ant - v_qtd
      END)::numeric,
      3
    );

    IF v_saldo_local_pos < 0 THEN
      RAISE EXCEPTION 'Ajuste geraria saldo negativo no tanque/tanka'
        USING ERRCODE = 'P0001';
    END IF;

    v_volume_novo := round(
      (CASE WHEN v_tipo_ajuste = 'aumentar'
        THEN coalesce(v_vas.volume, 0) + v_delta_l
        ELSE coalesce(v_vas.volume, 0) - v_delta_l
      END)::numeric,
      3
    );
    IF v_volume_novo < 0 THEN
      RAISE EXCEPTION 'Ajuste geraria volume negativo no tanque/tanka'
        USING ERRCODE = 'P0001';
    END IF;

    v_peso := CASE
      WHEN v_dens > 0 THEN round((v_volume_novo * v_dens)::numeric, 3)
      ELSE round(coalesce(v_vas.peso_liquido, 0)::numeric, 3)
    END;

    v_comp := coalesce(v_vas.composicao, '[]'::jsonb);
    IF jsonb_typeof(v_comp) <> 'array' THEN
      v_comp := '[]'::jsonb;
    END IF;

    -- Aumento: fatia de composição para o saldo consolidado enxergar o delta.
    IF v_tipo_ajuste = 'aumentar' THEN
      v_comp := v_comp || jsonb_build_array(
        jsonb_build_object(
          'lote', coalesce(v_ep.lote, v_vas.lote, ''),
          'quantidade_l', v_delta_l,
          'quantidade_kg', CASE WHEN v_dens > 0 THEN round((v_delta_l * v_dens)::numeric, 3) ELSE 0 END,
          'transbordo_codigo', 'AJUSTE-MANUAL',
          'ajuste_manual', true,
          'estoque_id', btrim(p_estoque_id),
          'entrada_id', btrim(p_estoque_id),
          'data', to_char(timezone('America/Sao_Paulo', now()), 'YYYY-MM-DD'),
          'usuario_nome', v_user_nome,
          'justificativa', left(btrim(p_justificativa), 240)
        )
      );
    END IF;

    UPDATE t_vasilhames
    SET
      volume = v_volume_novo,
      peso_liquido = v_peso,
      peso_bruto = round((coalesce(tara, 0) + v_peso)::numeric, 3),
      composicao = v_comp,
      updated_at = now()
    WHERE id = v_vas.id;

  ELSE
    -- Embalado: usa o saldo local informado (pátio) + trava no consolidado
    v_delta_l := NULL;
    v_saldo_local_ant := round(coalesce(p_saldo_local_atual, v_ep.saldo_final, 0)::numeric, 3);

    IF v_tipo_ajuste = 'diminuir' AND v_qtd > v_saldo_local_ant + 0.001 THEN
      RAISE EXCEPTION 'Redução superior ao saldo embalado disponível (disponível %)',
        v_saldo_local_ant
        USING ERRCODE = 'P0001';
    END IF;

    v_saldo_local_pos := round(
      (CASE WHEN v_tipo_ajuste = 'aumentar'
        THEN v_saldo_local_ant + v_qtd
        ELSE v_saldo_local_ant - v_qtd
      END)::numeric,
      3
    );
  END IF;

  -- Embalado: NÃO altera saldo_inicial (quantidade recebida da entrada).
  -- O ledger alimenta o cálculo de saldo no cliente; saldo_final é cache.
  -- Tanque/Tanka: altera saldo_inicial para manter reconciliação com o volume físico.
  IF v_tipo_local = 'embalado' THEN
    UPDATE estoque_produtos
    SET
      saldo_final = v_saldo_est_pos,
      updated_at = now()
    WHERE id = v_ep.id;
  ELSE
    UPDATE estoque_produtos
    SET
      saldo_inicial = round((coalesce(saldo_inicial, 0) + v_signed)::numeric, 3),
      saldo_final = v_saldo_est_pos,
      updated_at = now()
    WHERE id = v_ep.id;
  END IF;

  INSERT INTO t_estoque_ajustes_manuais (
    estoque_id,
    estoque_produtos_id,
    tipo_local,
    tipo_ajuste,
    quantidade,
    quantidade_signed,
    volume_l,
    saldo_anterior,
    saldo_posterior,
    saldo_estoque_anterior,
    saldo_estoque_posterior,
    unidade_medida,
    vasilhame_id,
    tanka_id,
    tanka_codigo,
    vasilhame_placa,
    produto_codigo,
    produto_nome,
    cliente_nome,
    lote,
    justificativa,
    usuario_id,
    usuario_nome
  ) VALUES (
    btrim(p_estoque_id)::uuid,
    v_ep.id,
    v_tipo_local,
    v_tipo_ajuste,
    v_qtd,
    v_signed,
    CASE WHEN v_tipo_local = 'embalado' THEN NULL
         WHEN v_tipo_ajuste = 'aumentar' THEN v_delta_l
         ELSE -v_delta_l
    END,
    v_saldo_local_ant,
    v_saldo_local_pos,
    v_saldo_est_ant,
    v_saldo_est_pos,
    v_ep.unidade_medida,
    CASE WHEN v_tipo_local = 'embalado' THEN NULL ELSE p_vasilhame_id END,
    CASE WHEN v_tipo_local = 'tanka' THEN p_tanka_id ELSE NULL END,
    CASE WHEN v_tipo_local = 'tanka' THEN coalesce(
      nullif(trim(p_tanka_codigo), ''),
      nullif(trim(v_vas.placa), '')
    ) ELSE NULL END,
    CASE WHEN v_tipo_local = 'embalado' THEN NULL ELSE v_vas.placa END,
    v_ep.produto_codigo,
    v_ep.produto_nome,
    v_ep.cliente_nome,
    v_ep.lote,
    btrim(p_justificativa),
    nullif(v_user_id, ''),
    v_user_nome
  )
  RETURNING id INTO v_ajuste_id;

  RETURN jsonb_build_object(
    'id', v_ajuste_id,
    'estoque_id', btrim(p_estoque_id),
    'tipo_local', v_tipo_local,
    'tipo_ajuste', v_tipo_ajuste,
    'quantidade', v_qtd,
    'quantidade_signed', v_signed,
    'volume_l', v_delta_l,
    'saldo_anterior', v_saldo_local_ant,
    'saldo_posterior', v_saldo_local_pos,
    'saldo_estoque_anterior', v_saldo_est_ant,
    'saldo_estoque_posterior', v_saldo_est_pos,
    'vasilhame_id', p_vasilhame_id,
    'usuario_id', nullif(v_user_id, ''),
    'usuario_nome', v_user_nome
  );
END;
$$;

GRANT EXECUTE ON FUNCTION t_ajustar_saldo_estoque(
  text, text, text, numeric, text, uuid, uuid, text, numeric, numeric
) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION _require_admin_ajuste_saldo() TO anon, authenticated;

COMMIT;
