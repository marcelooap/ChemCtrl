-- =============================================================================
-- Migration: usuario_permissoes — permissões individuais por usuário
-- =============================================================================
-- Fonte de autorização passa a ser usuário → permissoes (não mais só o perfil).
-- Tabelas de perfil (perfis, perfil_permissoes, perfil_modulos) são preservadas.
-- Login/sessão continuam via x-session-id (não usa auth.uid()).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catálogo de permissões
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissoes (
  id text PRIMARY KEY,
  modulo text NOT NULL,
  tela text,
  acao text NOT NULL,
  codigo text NOT NULL UNIQUE,
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  created_date timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_permissoes_modulo ON permissoes (modulo);
CREATE INDEX IF NOT EXISTS idx_permissoes_ativo ON permissoes (ativo);

-- -----------------------------------------------------------------------------
-- 2. Relacionamento usuário × permissão
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuario_permissoes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  usuario_id text NOT NULL REFERENCES ind_lista_usuarios(id) ON DELETE CASCADE,
  permissao_id text NOT NULL REFERENCES permissoes(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (usuario_id, permissao_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_permissoes_usuario ON usuario_permissoes (usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuario_permissoes_permissao ON usuario_permissoes (permissao_id);

ALTER TABLE permissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_permissoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS permissoes_select_session ON permissoes;
CREATE POLICY permissoes_select_session ON permissoes
  FOR SELECT USING (get_current_session() IS NOT NULL);

DROP POLICY IF EXISTS permissoes_no_insert ON permissoes;
CREATE POLICY permissoes_no_insert ON permissoes FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS permissoes_no_update ON permissoes;
CREATE POLICY permissoes_no_update ON permissoes FOR UPDATE USING (false);
DROP POLICY IF EXISTS permissoes_no_delete ON permissoes;
CREATE POLICY permissoes_no_delete ON permissoes FOR DELETE USING (false);

DROP POLICY IF EXISTS usuario_permissoes_no_direct_access ON usuario_permissoes;
CREATE POLICY usuario_permissoes_no_direct_access ON usuario_permissoes
  FOR ALL USING (false) WITH CHECK (false);

-- -----------------------------------------------------------------------------
-- 3. Seed do catálogo (id = codigo; ON CONFLICT ignora reexecução)
-- -----------------------------------------------------------------------------
INSERT INTO permissoes (id, modulo, tela, acao, codigo, descricao) VALUES
  -- Acesso a módulos
  ('module.painel', 'painel', NULL, 'access', 'module.painel', 'Acesso ao módulo Painel'),
  ('module.industrializacao', 'industrializacao', NULL, 'access', 'module.industrializacao', 'Acesso ao módulo Industrialização'),
  ('module.transbordo', 'transbordo', NULL, 'access', 'module.transbordo', 'Acesso ao módulo Transbordo'),

  -- Painel
  ('painel_home.view', 'painel', 'home', 'view', 'painel_home.view', 'Visualizar Home do Painel'),
  ('painel_dashboard.view', 'painel', 'dashboard', 'view', 'painel_dashboard.view', 'Visualizar Dashboard do Painel'),
  ('painel_comercial_reserva.view', 'painel', 'comercial_reserva', 'view', 'painel_comercial_reserva.view', 'Visualizar Reservar Material'),
  ('painel_comercial_reserva.create', 'painel', 'comercial_reserva', 'create', 'painel_comercial_reserva.create', 'Criar reserva de material'),
  ('painel_comercial_reserva.edit', 'painel', 'comercial_reserva', 'edit', 'painel_comercial_reserva.edit', 'Editar reserva de material'),
  ('painel_comercial_saida.view', 'painel', 'comercial_saida', 'view', 'painel_comercial_saida.view', 'Visualizar Solicitações de Saída'),
  ('painel_comercial_saida.create', 'painel', 'comercial_saida', 'create', 'painel_comercial_saida.create', 'Criar solicitação de saída'),
  ('painel_comercial_saida.edit', 'painel', 'comercial_saida', 'edit', 'painel_comercial_saida.edit', 'Editar solicitação de saída'),
  ('painel_comercial_saida.delete', 'painel', 'comercial_saida', 'delete', 'painel_comercial_saida.delete', 'Excluir solicitação de saída'),
  ('painel_comercial_carga.view', 'painel', 'comercial_carga', 'view', 'painel_comercial_carga.view', 'Visualizar Composição de Carga'),
  ('painel_comercial_carga.create', 'painel', 'comercial_carga', 'create', 'painel_comercial_carga.create', 'Criar composição de carga'),
  ('painel_comercial_carga.edit', 'painel', 'comercial_carga', 'edit', 'painel_comercial_carga.edit', 'Editar composição de carga'),
  ('painel_comercial_carga.delete', 'painel', 'comercial_carga', 'delete', 'painel_comercial_carga.delete', 'Excluir composição de carga'),
  ('painel_comercial_agendamentos.view', 'painel', 'comercial_agendamentos', 'view', 'painel_comercial_agendamentos.view', 'Visualizar Agendamentos'),
  ('painel_comercial_agendamentos.create', 'painel', 'comercial_agendamentos', 'create', 'painel_comercial_agendamentos.create', 'Criar agendamento de carregamento'),
  ('painel_comercial_agendamentos.edit', 'painel', 'comercial_agendamentos', 'edit', 'painel_comercial_agendamentos.edit', 'Editar agendamento de carregamento'),
  ('painel_comercial_agendamentos.delete', 'painel', 'comercial_agendamentos', 'delete', 'painel_comercial_agendamentos.delete', 'Cancelar agendamento de carregamento'),
  ('painel_logistica.view', 'painel', 'logistica', 'view', 'painel_logistica.view', 'Visualizar Logística'),
  ('painel_logistica_agendamentos.view', 'painel', 'logistica_agendamentos', 'view', 'painel_logistica_agendamentos.view', 'Visualizar Agendamentos de Logística'),
  ('painel_logistica_carregamentos.view', 'painel', 'logistica_carregamentos', 'view', 'painel_logistica_carregamentos.view', 'Visualizar Carregamentos de Logística'),

  -- Industrialização (keys existentes)
  ('home.view', 'industrializacao', 'home', 'view', 'home.view', 'Visualizar Home'),
  ('dashboard.view', 'industrializacao', 'dashboard', 'view', 'dashboard.view', 'Visualizar Dashboard'),
  ('recipes.view', 'industrializacao', 'recipes', 'view', 'recipes.view', 'Visualizar Receitas'),
  ('recipes.create', 'industrializacao', 'recipes', 'create', 'recipes.create', 'Criar Receita'),
  ('recipes.edit', 'industrializacao', 'recipes', 'edit', 'recipes.edit', 'Editar Receita'),
  ('recipes.delete', 'industrializacao', 'recipes', 'delete', 'recipes.delete', 'Excluir Receita'),
  ('recipes.approve', 'industrializacao', 'recipes', 'approve', 'recipes.approve', 'Aprovar Receita'),
  ('recipes.manage_fds', 'industrializacao', 'recipes', 'manage_fds', 'recipes.manage_fds', 'Gerenciar FDS'),
  ('recipes.remove_fds', 'industrializacao', 'recipes', 'remove_fds', 'recipes.remove_fds', 'Remover FDS'),
  ('orders.view', 'industrializacao', 'orders', 'view', 'orders.view', 'Visualizar Pedidos'),
  ('orders.create', 'industrializacao', 'orders', 'create', 'orders.create', 'Criar Pedido'),
  ('orders.edit', 'industrializacao', 'orders', 'edit', 'orders.edit', 'Editar Pedido'),
  ('orders.delete', 'industrializacao', 'orders', 'delete', 'orders.delete', 'Excluir Pedido'),
  ('raw_material_stock.view', 'industrializacao', 'raw_material_stock', 'view', 'raw_material_stock.view', 'Visualizar Estoque de MP'),
  ('raw_material_stock.create', 'industrializacao', 'raw_material_stock', 'create', 'raw_material_stock.create', 'Criar Estoque de MP'),
  ('raw_material_stock.edit', 'industrializacao', 'raw_material_stock', 'edit', 'raw_material_stock.edit', 'Editar Estoque de MP'),
  ('raw_material_stock.delete', 'industrializacao', 'raw_material_stock', 'delete', 'raw_material_stock.delete', 'Excluir Estoque de MP'),
  ('inventory.view', 'industrializacao', 'inventory', 'view', 'inventory.view', 'Visualizar Inventário'),
  ('inventory.create', 'industrializacao', 'inventory', 'create', 'inventory.create', 'Criar Inventário'),
  ('inventory.edit', 'industrializacao', 'inventory', 'edit', 'inventory.edit', 'Editar Inventário'),
  ('inventory.delete', 'industrializacao', 'inventory', 'delete', 'inventory.delete', 'Excluir Inventário'),
  ('containers.view', 'industrializacao', 'containers', 'view', 'containers.view', 'Visualizar Vasilhames'),
  ('containers.create', 'industrializacao', 'containers', 'create', 'containers.create', 'Criar Vasilhame'),
  ('containers.edit', 'industrializacao', 'containers', 'edit', 'containers.edit', 'Editar Vasilhame'),
  ('containers.delete', 'industrializacao', 'containers', 'delete', 'containers.delete', 'Excluir Vasilhame'),
  ('saida.view', 'industrializacao', 'saida', 'view', 'saida.view', 'Visualizar Saída'),
  ('saida.create', 'industrializacao', 'saida', 'create', 'saida.create', 'Criar Saída'),
  ('saida.edit', 'industrializacao', 'saida', 'edit', 'saida.edit', 'Editar Saída'),
  ('saida.delete', 'industrializacao', 'saida', 'delete', 'saida.delete', 'Excluir Saída'),
  ('tankage.view', 'industrializacao', 'tankage', 'view', 'tankage.view', 'Visualizar Tankagem'),
  ('tankage.create', 'industrializacao', 'tankage', 'create', 'tankage.create', 'Criar Tanque'),
  ('tankage.edit', 'industrializacao', 'tankage', 'edit', 'tankage.edit', 'Editar Tanque'),
  ('tankage.delete', 'industrializacao', 'tankage', 'delete', 'tankage.delete', 'Excluir Tanque'),
  ('transfer.view', 'industrializacao', 'transfer', 'view', 'transfer.view', 'Visualizar Transbordo (industrialização)'),
  ('transfer.create', 'industrializacao', 'transfer', 'create', 'transfer.create', 'Criar Transbordo'),
  ('transfer.edit', 'industrializacao', 'transfer', 'edit', 'transfer.edit', 'Editar Transbordo'),
  ('transfer.delete', 'industrializacao', 'transfer', 'delete', 'transfer.delete', 'Excluir Transbordo'),
  ('new_production.view', 'industrializacao', 'new_production', 'view', 'new_production.view', 'Visualizar Nova Produção'),
  ('new_production.create', 'industrializacao', 'new_production', 'create', 'new_production.create', 'Criar OP'),
  ('productions.view', 'industrializacao', 'productions', 'view', 'productions.view', 'Visualizar Produções'),
  ('productions.create_op', 'industrializacao', 'productions', 'create_op', 'productions.create_op', 'Criar OP'),
  ('productions.edit_op', 'industrializacao', 'productions', 'edit_op', 'productions.edit_op', 'Editar OP'),
  ('productions.complement', 'industrializacao', 'productions', 'complement', 'productions.complement', 'Complementar lote'),
  ('productions.cancel', 'industrializacao', 'productions', 'cancel', 'productions.cancel', 'Cancelar OP'),
  ('productions.finish', 'industrializacao', 'productions', 'finish', 'productions.finish', 'Finalizar OP'),
  ('productions.print_label', 'industrializacao', 'productions', 'print_label', 'productions.print_label', 'Imprimir etiqueta'),
  ('productions.export', 'industrializacao', 'productions', 'export', 'productions.export', 'Exportar produções'),
  ('production_orders.view', 'industrializacao', 'production_orders', 'view', 'production_orders.view', 'Visualizar Ordens'),
  ('production_orders.create', 'industrializacao', 'production_orders', 'create', 'production_orders.create', 'Criar Ordem'),
  ('production_orders.edit', 'industrializacao', 'production_orders', 'edit', 'production_orders.edit', 'Editar Ordem'),
  ('production_orders.delete', 'industrializacao', 'production_orders', 'delete', 'production_orders.delete', 'Excluir Ordem'),
  ('quality_tests.view', 'industrializacao', 'quality_tests', 'view', 'quality_tests.view', 'Visualizar Ensaios'),
  ('quality_tests.register_test', 'industrializacao', 'quality_tests', 'register_test', 'quality_tests.register_test', 'Registrar ensaio'),
  ('quality_tests.edit', 'industrializacao', 'quality_tests', 'edit', 'quality_tests.edit', 'Editar ensaio'),
  ('quality_tests.delete', 'industrializacao', 'quality_tests', 'delete', 'quality_tests.delete', 'Excluir ensaio'),
  ('quality_analyses.view', 'industrializacao', 'quality_analyses', 'view', 'quality_analyses.view', 'Visualizar Lista de Ensaios'),
  ('quality_analyses.create', 'industrializacao', 'quality_analyses', 'create', 'quality_analyses.create', 'Criar análise'),
  ('quality_analyses.edit', 'industrializacao', 'quality_analyses', 'edit', 'quality_analyses.edit', 'Editar análise'),
  ('quality_analyses.delete', 'industrializacao', 'quality_analyses', 'delete', 'quality_analyses.delete', 'Excluir análise'),
  ('quality_pending.view', 'industrializacao', 'quality_pending', 'view', 'quality_pending.view', 'Visualizar Produções CQ'),
  ('quality_pending.release_production', 'industrializacao', 'quality_pending', 'release_production', 'quality_pending.release_production', 'Liberar produção'),
  ('quality_pending.edit', 'industrializacao', 'quality_pending', 'edit', 'quality_pending.edit', 'Editar CQ'),
  ('quality_coa.view', 'industrializacao', 'quality_coa', 'view', 'quality_coa.view', 'Visualizar COA'),
  ('quality_coa.issue_coa', 'industrializacao', 'quality_coa', 'issue_coa', 'quality_coa.issue_coa', 'Emitir COA'),
  ('quality_coa.export', 'industrializacao', 'quality_coa', 'export', 'quality_coa.export', 'Exportar COA'),
  ('lab_equipment.view', 'industrializacao', 'lab_equipment', 'view', 'lab_equipment.view', 'Visualizar Equipamentos de Lab'),
  ('lab_equipment.create', 'industrializacao', 'lab_equipment', 'create', 'lab_equipment.create', 'Criar equipamento'),
  ('lab_equipment.edit', 'industrializacao', 'lab_equipment', 'edit', 'lab_equipment.edit', 'Editar equipamento'),
  ('lab_equipment.delete', 'industrializacao', 'lab_equipment', 'delete', 'lab_equipment.delete', 'Excluir equipamento'),
  ('client_portal.view', 'industrializacao', 'client_portal', 'view', 'client_portal.view', 'Visualizar Tela Clientes'),
  ('client_stock.view', 'industrializacao', 'client_stock', 'view', 'client_stock.view', 'Visualizar Estoque Cliente'),
  ('users.view', 'painel', 'users', 'view', 'users.view', 'Visualizar Usuários'),
  ('users.create', 'painel', 'users', 'create', 'users.create', 'Criar Usuário'),
  ('users.edit', 'painel', 'users', 'edit', 'users.edit', 'Editar Usuário'),
  ('users.delete', 'painel', 'users', 'delete', 'users.delete', 'Excluir Usuário'),
  ('profiles.view', 'painel', 'profiles', 'view', 'profiles.view', 'Visualizar Permissões'),
  ('profiles.create', 'painel', 'profiles', 'create', 'profiles.create', 'Criar perfil (legado)'),
  ('profiles.edit', 'painel', 'profiles', 'edit', 'profiles.edit', 'Editar permissões de usuário'),
  ('profiles.delete', 'painel', 'profiles', 'delete', 'profiles.delete', 'Excluir perfil (legado)'),

  -- Transbordo
  ('tb_home.view', 'transbordo', 'home', 'view', 'tb_home.view', 'Visualizar Home do Transbordo'),
  ('tb_dashboard.view', 'transbordo', 'dashboard', 'view', 'tb_dashboard.view', 'Visualizar Dashboard do Transbordo'),
  ('tb_cadastro.view', 'transbordo', 'cadastro', 'view', 'tb_cadastro.view', 'Visualizar Cadastro'),
  ('tb_cadastro.create', 'transbordo', 'cadastro', 'create', 'tb_cadastro.create', 'Criar cadastro'),
  ('tb_cadastro.edit', 'transbordo', 'cadastro', 'edit', 'tb_cadastro.edit', 'Editar cadastro'),
  ('tb_cadastro.delete', 'transbordo', 'cadastro', 'delete', 'tb_cadastro.delete', 'Excluir cadastro'),
  ('tb_entrada.view', 'transbordo', 'entrada', 'view', 'tb_entrada.view', 'Visualizar Entrada'),
  ('tb_entrada.create', 'transbordo', 'entrada', 'create', 'tb_entrada.create', 'Criar entrada'),
  ('tb_entrada.edit', 'transbordo', 'entrada', 'edit', 'tb_entrada.edit', 'Editar entrada'),
  ('tb_entrada.delete', 'transbordo', 'entrada', 'delete', 'tb_entrada.delete', 'Excluir entrada'),
  ('tb_saida.view', 'transbordo', 'saida', 'view', 'tb_saida.view', 'Visualizar Saída'),
  ('tb_saida.create', 'transbordo', 'saida', 'create', 'tb_saida.create', 'Criar saída'),
  ('tb_saida.edit', 'transbordo', 'saida', 'edit', 'tb_saida.edit', 'Editar saída'),
  ('tb_saida.delete', 'transbordo', 'saida', 'delete', 'tb_saida.delete', 'Excluir saída'),
  ('tb_transbordo.view', 'transbordo', 'transbordo', 'view', 'tb_transbordo.view', 'Visualizar Transbordo'),
  ('tb_transbordo.create', 'transbordo', 'transbordo', 'create', 'tb_transbordo.create', 'Criar transbordo'),
  ('tb_transbordo.edit', 'transbordo', 'transbordo', 'edit', 'tb_transbordo.edit', 'Editar transbordo'),
  ('tb_transbordo.delete', 'transbordo', 'transbordo', 'delete', 'tb_transbordo.delete', 'Excluir transbordo'),
  ('tb_vasilhames.view', 'transbordo', 'vasilhames', 'view', 'tb_vasilhames.view', 'Visualizar Vasilhames (Transbordo)'),
  ('tb_vasilhames.create', 'transbordo', 'vasilhames', 'create', 'tb_vasilhames.create', 'Criar vasilhame'),
  ('tb_vasilhames.edit', 'transbordo', 'vasilhames', 'edit', 'tb_vasilhames.edit', 'Editar vasilhame'),
  ('tb_vasilhames.delete', 'transbordo', 'vasilhames', 'delete', 'tb_vasilhames.delete', 'Excluir vasilhame'),
  ('tb_filtracao.view', 'transbordo', 'filtracao', 'view', 'tb_filtracao.view', 'Visualizar Filtração'),
  ('tb_filtracao.create', 'transbordo', 'filtracao', 'create', 'tb_filtracao.create', 'Criar filtração'),
  ('tb_filtracao.edit', 'transbordo', 'filtracao', 'edit', 'tb_filtracao.edit', 'Editar filtração'),
  ('tb_filtracao.delete', 'transbordo', 'filtracao', 'delete', 'tb_filtracao.delete', 'Excluir filtração'),
  ('tb_estoque.view', 'transbordo', 'estoque', 'view', 'tb_estoque.view', 'Visualizar Estoque (Transbordo)'),
  ('tb_estoque.create', 'transbordo', 'estoque', 'create', 'tb_estoque.create', 'Criar estoque'),
  ('tb_estoque.edit', 'transbordo', 'estoque', 'edit', 'tb_estoque.edit', 'Editar estoque'),
  ('tb_estoque.delete', 'transbordo', 'estoque', 'delete', 'tb_estoque.delete', 'Excluir estoque'),
  ('tb_estoque_envio.view', 'transbordo', 'estoque_envio', 'view', 'tb_estoque_envio.view', 'Visualizar Estoque Envio'),
  ('tb_estoque_envio.export', 'transbordo', 'estoque_envio', 'export', 'tb_estoque_envio.export', 'Exportar Estoque Envio'),
  ('tb_tankagem.view', 'transbordo', 'tankagem', 'view', 'tb_tankagem.view', 'Visualizar Tankagem (Transbordo)')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. Resolução de permissões do usuário (com fallback por perfil)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _resolve_user_authz(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_rows boolean := false;
  v_permissions jsonb := '[]'::jsonb;
  v_modules text[] := ARRAY[]::text[];
  v_perfil_id text;
  v_tipo text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM usuario_permissoes up WHERE up.usuario_id = p_user_id
  ) INTO v_has_rows;

  IF v_has_rows THEN
    SELECT COALESCE(jsonb_agg(p.codigo ORDER BY p.codigo), '[]'::jsonb)
    INTO v_permissions
    FROM usuario_permissoes up
    JOIN permissoes p ON p.id = up.permissao_id
    WHERE up.usuario_id = p_user_id
      AND COALESCE(p.ativo, true);

    SELECT COALESCE(array_agg(m ORDER BY m), ARRAY[]::text[])
    INTO v_modules
    FROM (
      SELECT DISTINCT
        CASE
          WHEN p.codigo = 'module.industrializacao' THEN 'industrializacao'
          WHEN p.codigo = 'module.transbordo' THEN 'transbordo'
          ELSE NULL
        END AS m
      FROM usuario_permissoes up
      JOIN permissoes p ON p.id = up.permissao_id
      WHERE up.usuario_id = p_user_id
        AND p.codigo IN ('module.industrializacao', 'module.transbordo')
    ) x
    WHERE m IS NOT NULL;

    RETURN jsonb_build_object(
      'permissions', COALESCE(v_permissions, '[]'::jsonb),
      'modules', to_jsonb(COALESCE(v_modules, ARRAY[]::text[]))
    );
  END IF;

  SELECT u.perfil_id, COALESCE(u.tipo, 'interno')
  INTO v_perfil_id, v_tipo
  FROM ind_lista_usuarios u
  WHERE u.id = p_user_id
  LIMIT 1;

  IF v_tipo = 'externo' THEN
    RETURN jsonb_build_object(
      'permissions', '["client_portal.view"]'::jsonb,
      'modules', '[]'::jsonb
    );
  END IF;

  IF v_perfil_id IS NOT NULL THEN
    v_permissions := get_profile_permission_keys(v_perfil_id);
    v_modules := get_profile_module_keys(v_perfil_id);
  END IF;

  RETURN jsonb_build_object(
    'permissions', COALESCE(v_permissions, '[]'::jsonb),
    'modules', to_jsonb(COALESCE(v_modules, ARRAY[]::text[]))
  );
END;
$$;

CREATE OR REPLACE FUNCTION _sync_user_sessions_permissions(p_user_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authz jsonb;
BEGIN
  v_authz := _resolve_user_authz(p_user_id);
  BEGIN
    UPDATE sessions
    SET permissions = COALESCE(v_authz->'permissions', '[]'::jsonb),
        last_activity = now()
    WHERE user_id = p_user_id
      AND expires_at > now();
  EXCEPTION WHEN undefined_column THEN
    NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION _grant_codes_to_user(p_user_id text, p_codes text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
BEGIN
  FOREACH k IN ARRAY COALESCE(p_codes, ARRAY[]::text[]) LOOP
    INSERT INTO usuario_permissoes (usuario_id, permissao_id)
    SELECT p_user_id, p.id
    FROM permissoes p
    WHERE p.codigo = k
    ON CONFLICT (usuario_id, permissao_id) DO NOTHING;
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. RPCs de leitura / gravação
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authz jsonb;
BEGIN
  IF NOT (
    has_permission('profiles.view')
    OR has_permission('profiles.edit')
    OR has_permission('users.view')
    OR (get_current_session() ->> 'nivel_acesso') = 'Administrador'
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ind_lista_usuarios WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário não encontrado', 'permissions', '[]'::jsonb);
  END IF;

  v_authz := _resolve_user_authz(p_user_id);
  RETURN jsonb_build_object(
    'success', true,
    'permissions', COALESCE(v_authz->'permissions', '[]'::jsonb),
    'modules', COALESCE(v_authz->'modules', '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_permissions(text) TO anon;

CREATE OR REPLACE FUNCTION replace_user_permissions(p_user_id text, p_codes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_codes text[];
  v_authz jsonb;
BEGIN
  PERFORM _rbac_require_profiles_edit();

  SELECT * INTO v_user FROM ind_lista_usuarios WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário não encontrado');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT value), ARRAY[]::text[])
  INTO v_codes
  FROM jsonb_array_elements_text(COALESCE(p_codes, '[]'::jsonb)) AS value
  WHERE EXISTS (SELECT 1 FROM permissoes p WHERE p.codigo = value AND COALESCE(p.ativo, true));

  IF COALESCE(v_user.tipo, 'interno') = 'externo' THEN
    v_codes := ARRAY['client_portal.view'];
  ELSE
    IF NOT ('module.painel' = ANY (COALESCE(v_codes, ARRAY[]::text[]))) THEN
      v_codes := COALESCE(v_codes, ARRAY[]::text[]) || ARRAY['module.painel'];
    END IF;
    IF NOT ('painel_home.view' = ANY (COALESCE(v_codes, ARRAY[]::text[]))) THEN
      v_codes := v_codes || ARRAY['painel_home.view'];
    END IF;
  END IF;

  DELETE FROM usuario_permissoes WHERE usuario_id = p_user_id;
  PERFORM _grant_codes_to_user(p_user_id, v_codes);

  PERFORM _rbac_audit(COALESCE(v_user.perfil_id, p_user_id), 'replace_user_permissions', jsonb_build_object(
    'usuario_id', p_user_id,
    'usuario', v_user.usuario,
    'permissions', to_jsonb(COALESCE(v_codes, ARRAY[]::text[]))
  ));

  PERFORM _sync_user_sessions_permissions(p_user_id);
  v_authz := _resolve_user_authz(p_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'permissions', COALESCE(v_authz->'permissions', '[]'::jsonb),
    'modules', COALESCE(v_authz->'modules', '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION replace_user_permissions(text, jsonb) TO anon;

CREATE OR REPLACE FUNCTION grant_default_user_permissions(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
BEGIN
  PERFORM _rbac_require_profiles_edit();

  SELECT * INTO v_user FROM ind_lista_usuarios WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário não encontrado');
  END IF;

  IF EXISTS (SELECT 1 FROM usuario_permissoes WHERE usuario_id = p_user_id) THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  IF COALESCE(v_user.tipo, 'interno') = 'externo' THEN
    PERFORM _grant_codes_to_user(p_user_id, ARRAY['client_portal.view']);
  ELSE
    PERFORM _grant_codes_to_user(p_user_id, ARRAY['module.painel', 'painel_home.view']);
  END IF;

  PERFORM _sync_user_sessions_permissions(p_user_id);
  RETURN jsonb_build_object('success', true, 'skipped', false);
END;
$$;

GRANT EXECUTE ON FUNCTION grant_default_user_permissions(text) TO anon;

-- Trigger: usuário novo nasce só com o mínimo
CREATE OR REPLACE FUNCTION _trg_grant_default_user_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM usuario_permissoes WHERE usuario_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.tipo, 'interno') = 'externo' THEN
    PERFORM _grant_codes_to_user(NEW.id, ARRAY['client_portal.view']);
  ELSE
    PERFORM _grant_codes_to_user(NEW.id, ARRAY['module.painel', 'painel_home.view']);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_default_user_permissions ON ind_lista_usuarios;
CREATE TRIGGER trg_grant_default_user_permissions
AFTER INSERT ON ind_lista_usuarios
FOR EACH ROW
EXECUTE PROCEDURE _trg_grant_default_user_permissions();

-- -----------------------------------------------------------------------------
-- 6. login_user / validate_session — leem usuario_permissoes
-- -----------------------------------------------------------------------------
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
  v_modules text[] := ARRAY[]::text[];
  v_authz jsonb;
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
    SELECT to_jsonb(p) INTO v_perfil
    FROM perfis p
    WHERE p.id = v_perfil_id
    LIMIT 1;
  END IF;

  v_authz := _resolve_user_authz(v_row->>'id');
  v_permissions := COALESCE(v_authz->'permissions', '[]'::jsonb);
  SELECT COALESCE(array_agg(value), ARRAY[]::text[])
  INTO v_modules
  FROM jsonb_array_elements_text(COALESCE(v_authz->'modules', '[]'::jsonb)) AS value;

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
      'permissions', COALESCE(v_permissions, '[]'::jsonb),
      'modules', to_jsonb(COALESCE(v_modules, ARRAY[]::text[]))
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION login_user(text, text) TO anon;

CREATE OR REPLACE FUNCTION validate_session(p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session jsonb;
  v_perfil jsonb;
  v_permissions jsonb := '[]'::jsonb;
  v_modules text[] := ARRAY[]::text[];
  v_authz jsonb;
  v_perfil_id text;
  v_user_id text;
BEGIN
  SELECT to_jsonb(s) INTO v_session
  FROM sessions s
  WHERE s.session_id = p_session_id
    AND s.expires_at > now()
  LIMIT 1;

  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  v_user_id := NULLIF(v_session->>'user_id', '');
  v_perfil_id := NULLIF(v_session->>'perfil_id', '');

  IF v_user_id IS NOT NULL THEN
    v_authz := _resolve_user_authz(v_user_id);
    v_permissions := COALESCE(v_authz->'permissions', '[]'::jsonb);
    SELECT COALESCE(array_agg(value), ARRAY[]::text[])
    INTO v_modules
    FROM jsonb_array_elements_text(COALESCE(v_authz->'modules', '[]'::jsonb)) AS value;

    BEGIN
      UPDATE sessions
      SET permissions = COALESCE(v_permissions, '[]'::jsonb),
          last_activity = now()
      WHERE session_id = p_session_id;
    EXCEPTION WHEN undefined_column THEN
      NULL;
    END;
  ELSE
    v_permissions := COALESCE(v_session->'permissions', '[]'::jsonb);
  END IF;

  IF v_perfil_id IS NOT NULL THEN
    SELECT to_jsonb(p) INTO v_perfil
    FROM perfis p
    WHERE p.id = v_perfil_id
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session->>'session_id',
    'user_id', v_session->>'user_id',
    'nome_completo', v_session->>'nome_completo',
    'usuario', v_session->>'usuario',
    'nivel_acesso', v_session->>'nivel_acesso',
    'tipo', v_session->>'tipo',
    'cliente', v_session->>'cliente',
    'cargo', v_session->>'cargo',
    'perfil_id', v_perfil_id,
    'permissions', COALESCE(v_permissions, '[]'::jsonb),
    'modules', to_jsonb(COALESCE(v_modules, ARRAY[]::text[])),
    'perfil', CASE
      WHEN v_perfil IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_perfil->>'id',
        'nome', v_perfil->>'nome',
        'slug', v_perfil->>'slug',
        'default_route', v_perfil->>'default_route'
      )
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_session(text) TO anon;

-- -----------------------------------------------------------------------------
-- 7. Backfill idempotente — preserva o acesso efetivo atual
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_codes text[];
  v_is_admin boolean;
  v_nivel text;
  v_from_perfil text[];
  v_from_modules text[];
  k text;
  v_operacional text[] := ARRAY[
    'production_orders.view', 'production_orders.create', 'production_orders.edit',
    'inventory.view', 'inventory.create', 'inventory.edit',
    'containers.view',
    'saida.view',
    'raw_material_stock.view',
    'home.view'
  ];
  v_visualizacao text[] := ARRAY[
    'orders.view',
    'containers.view',
    'saida.view',
    'tankage.view',
    'client_stock.view',
    'quality_coa.view',
    'home.view'
  ];
BEGIN
  FOR r IN SELECT id, tipo, perfil_id, nivel_acesso FROM ind_lista_usuarios LOOP
    IF EXISTS (SELECT 1 FROM usuario_permissoes WHERE usuario_id = r.id) THEN
      CONTINUE;
    END IF;

    IF COALESCE(r.tipo, 'interno') = 'externo' THEN
      PERFORM _grant_codes_to_user(r.id, ARRAY['client_portal.view']);
      CONTINUE;
    END IF;

    v_is_admin := EXISTS (
      SELECT 1 FROM perfis pf
      WHERE pf.id = r.perfil_id
        AND (pf.slug = 'administrador' OR pf.id = 'perfil_administrador' OR lower(trim(pf.nome)) = 'administrador')
    ) OR lower(trim(coalesce(r.nivel_acesso, ''))) = 'administrador';

    IF v_is_admin THEN
      SELECT COALESCE(array_agg(codigo), ARRAY[]::text[]) INTO v_codes FROM permissoes WHERE COALESCE(ativo, true);
      PERFORM _grant_codes_to_user(r.id, v_codes);
      CONTINUE;
    END IF;

    SELECT COALESCE(array_agg(pp.permission_key), ARRAY[]::text[])
    INTO v_from_perfil
    FROM perfil_permissoes pp
    WHERE pp.perfil_id = r.perfil_id;

    IF v_from_perfil IS NULL OR coalesce(array_length(v_from_perfil, 1), 0) = 0 THEN
      v_nivel := lower(trim(coalesce(r.nivel_acesso, '')));
      v_nivel := translate(v_nivel, 'áàãâéêíóôõúç', 'aaaaeeiooouc');
      IF v_nivel IN ('supervisor') THEN
        SELECT COALESCE(array_agg(codigo), ARRAY[]::text[])
        INTO v_from_perfil
        FROM permissoes
        WHERE modulo = 'industrializacao'
          AND codigo NOT LIKE 'users.%'
          AND codigo NOT LIKE 'profiles.%'
          AND codigo NOT LIKE 'module.%';
      ELSIF v_nivel IN ('operacional', 'operador') THEN
        v_from_perfil := v_operacional;
      ELSIF v_nivel LIKE 'visualiza%' THEN
        v_from_perfil := v_visualizacao;
      ELSE
        v_from_perfil := ARRAY['home.view'];
      END IF;
    END IF;

    SELECT COALESCE(array_agg('module.' || pm.modulo), ARRAY[]::text[])
    INTO v_from_modules
    FROM perfil_modulos pm
    WHERE pm.perfil_id = r.perfil_id;

    v_codes := COALESCE(v_from_perfil, ARRAY[]::text[])
      || COALESCE(v_from_modules, ARRAY[]::text[])
      || ARRAY['module.painel', 'painel_home.view'];

    IF NOT ('module.industrializacao' = ANY (v_codes))
       AND NOT ('module.transbordo' = ANY (v_codes)) THEN
      v_codes := v_codes || ARRAY['module.industrializacao'];
    END IF;

    IF 'module.transbordo' = ANY (v_codes) THEN
      v_codes := v_codes || ARRAY(
        SELECT codigo FROM permissoes
        WHERE modulo = 'transbordo' AND codigo NOT LIKE 'module.%'
      );
    END IF;

    PERFORM _grant_codes_to_user(r.id, v_codes);
  END LOOP;
END $$;

-- Reidrata sessões ativas com o snapshot novo
DO $$
DECLARE
  s record;
BEGIN
  FOR s IN SELECT DISTINCT user_id FROM sessions WHERE expires_at > now() LOOP
    PERFORM _sync_user_sessions_permissions(s.user_id);
  END LOOP;
END $$;

SELECT pg_notify('pgrst', 'reload schema');
