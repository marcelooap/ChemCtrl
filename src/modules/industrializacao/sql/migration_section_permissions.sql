-- =============================================================================
-- Seções da sidebar (Nível 1) + permissões de Configuração do Painel
-- =============================================================================
-- Idempotente. Aplicar NO SUPABASE ANTES do deploy do frontend que exige
-- section.* em canAccessRoute.
--
-- Concede:
--   1. Chaves section.* para quem já tem view de página filha
--   2. Configuração (seção + páginas) a TODOS os usuários internos
--      (preserva o acesso livre anterior; admin pode revogar depois)
-- =============================================================================

-- 1) Catálogo: seções + páginas de Configuração
INSERT INTO permissoes (id, modulo, tela, acao, codigo, descricao) VALUES
  -- Seções Painel
  ('section.painel.comercial', 'painel', 'comercial', 'access', 'section.painel.comercial', 'Acesso à seção Comercial do Painel'),
  ('section.painel.logistica', 'painel', 'logistica', 'access', 'section.painel.logistica', 'Acesso à seção Logística do Painel'),
  ('section.painel.operacional', 'painel', 'operacional', 'access', 'section.painel.operacional', 'Acesso à seção Operacional do Painel'),
  ('section.painel.users_permissions', 'painel', 'users_permissions', 'access', 'section.painel.users_permissions', 'Acesso à seção Usuários e Permissões'),
  ('section.painel.configuracao', 'painel', 'configuracao', 'access', 'section.painel.configuracao', 'Acesso à seção Configuração do Painel'),
  -- Seção Industrialização
  ('section.industrializacao.quality', 'industrializacao', 'quality', 'access', 'section.industrializacao.quality', 'Acesso à seção Controle de Qualidade'),
  -- Páginas de Configuração (antes liberadas por bypass)
  ('painel_config_operadores.view', 'painel', 'config_operadores', 'view', 'painel_config_operadores.view', 'Visualizar Operadores'),
  ('painel_config_operadores.create', 'painel', 'config_operadores', 'create', 'painel_config_operadores.create', 'Criar Operadores'),
  ('painel_config_operadores.edit', 'painel', 'config_operadores', 'edit', 'painel_config_operadores.edit', 'Editar Operadores'),
  ('painel_config_etiquetas.view', 'painel', 'config_etiquetas', 'view', 'painel_config_etiquetas.view', 'Visualizar Etiquetas'),
  ('painel_config_etiquetas.edit', 'painel', 'config_etiquetas', 'edit', 'painel_config_etiquetas.edit', 'Editar Etiquetas'),
  ('painel_config_checklist_expedicao.view', 'painel', 'config_checklist_expedicao', 'view', 'painel_config_checklist_expedicao.view', 'Visualizar Checklist de Expedição'),
  ('painel_config_checklist_expedicao.edit', 'painel', 'config_checklist_expedicao', 'edit', 'painel_config_checklist_expedicao.edit', 'Editar Checklist de Expedição')
ON CONFLICT (id) DO NOTHING;

-- 2) Perfil administrador recebe todas as chaves novas
INSERT INTO perfil_permissoes (perfil_id, permission_key)
SELECT p.id, x.permission_key
FROM perfis p
CROSS JOIN (VALUES
  ('section.painel.comercial'),
  ('section.painel.logistica'),
  ('section.painel.operacional'),
  ('section.painel.users_permissions'),
  ('section.painel.configuracao'),
  ('section.industrializacao.quality'),
  ('painel_config_operadores.view'),
  ('painel_config_operadores.create'),
  ('painel_config_operadores.edit'),
  ('painel_config_etiquetas.view'),
  ('painel_config_etiquetas.edit'),
  ('painel_config_checklist_expedicao.view'),
  ('painel_config_checklist_expedicao.edit')
) AS x(permission_key)
WHERE p.slug = 'administrador'
   OR p.id = 'perfil_administrador'
   OR lower(trim(p.nome)) = 'administrador'
ON CONFLICT DO NOTHING;

-- 3) Admins: grant direto
SELECT _grant_codes_to_user(u.id, ARRAY[
  'section.painel.comercial',
  'section.painel.logistica',
  'section.painel.operacional',
  'section.painel.users_permissions',
  'section.painel.configuracao',
  'section.industrializacao.quality',
  'painel_config_operadores.view',
  'painel_config_operadores.create',
  'painel_config_operadores.edit',
  'painel_config_etiquetas.view',
  'painel_config_etiquetas.edit',
  'painel_config_checklist_expedicao.view',
  'painel_config_checklist_expedicao.edit'
])
FROM ind_lista_usuarios u
WHERE COALESCE(u.tipo, 'interno') <> 'externo'
  AND (
    EXISTS (
      SELECT 1 FROM perfis pf
      WHERE pf.id = u.perfil_id
        AND (pf.slug = 'administrador' OR pf.id = 'perfil_administrador' OR lower(trim(pf.nome)) = 'administrador')
    )
    OR lower(trim(coalesce(u.nivel_acesso, ''))) = 'administrador'
  );

-- 4) Backfill de seções: quem já tem view de página filha ganha a seção
-- Comercial
SELECT _grant_codes_to_user(up.usuario_id::text, ARRAY['section.painel.comercial'])
FROM (
  SELECT DISTINCT usuario_id
  FROM usuario_permissoes
  WHERE permissao_id IN (
    'painel_comercial_reserva.view',
    'painel_comercial_saida.view',
    'painel_comercial_agendamentos.view'
  )
) up;

-- Logística
SELECT _grant_codes_to_user(up.usuario_id::text, ARRAY['section.painel.logistica'])
FROM (
  SELECT DISTINCT usuario_id
  FROM usuario_permissoes
  WHERE permissao_id IN (
    'painel_logistica.view',
    'painel_logistica_agendamentos.view',
    'painel_logistica_carregamentos.view',
    'painel_logistica_recebimento.view'
  )
) up;

-- Operacional
SELECT _grant_codes_to_user(up.usuario_id::text, ARRAY['section.painel.operacional'])
FROM (
  SELECT DISTINCT usuario_id
  FROM usuario_permissoes
  WHERE permissao_id IN (
    'painel_operacional_ordem_transbordo.view',
    'painel_operacional_estoque.view'
  )
) up;

-- Usuários e Permissões
SELECT _grant_codes_to_user(up.usuario_id::text, ARRAY['section.painel.users_permissions'])
FROM (
  SELECT DISTINCT usuario_id
  FROM usuario_permissoes
  WHERE permissao_id IN ('users.view', 'profiles.view')
) up;

-- Controle de Qualidade
SELECT _grant_codes_to_user(up.usuario_id::text, ARRAY['section.industrializacao.quality'])
FROM (
  SELECT DISTINCT usuario_id
  FROM usuario_permissoes
  WHERE permissao_id IN (
    'quality_tests.view',
    'quality_analyses.view',
    'quality_pending.view',
    'quality_coa.view',
    'lab_equipment.view'
  )
) up;

-- 5) Configuração: liberar a TODOS os usuários internos (comportamento anterior)
SELECT _grant_codes_to_user(u.id, ARRAY[
  'section.painel.configuracao',
  'painel_config_operadores.view',
  'painel_config_operadores.create',
  'painel_config_operadores.edit',
  'painel_config_etiquetas.view',
  'painel_config_etiquetas.edit',
  'painel_config_checklist_expedicao.view',
  'painel_config_checklist_expedicao.edit'
])
FROM ind_lista_usuarios u
WHERE COALESCE(u.tipo, 'interno') <> 'externo';

-- 6) Sync de sessões ativas
DO $$
DECLARE
  s record;
BEGIN
  FOR s IN SELECT DISTINCT user_id FROM sessions WHERE expires_at > now() LOOP
    BEGIN
      PERFORM _sync_user_sessions_permissions(s.user_id);
    EXCEPTION WHEN undefined_function THEN
      NULL;
    END;
  END LOOP;
END $$;

SELECT pg_notify('pgrst', 'reload schema');
