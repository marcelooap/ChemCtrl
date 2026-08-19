-- Permissões: Painel Logística → Recebimento e Industrialização → Validação
-- Idempotente.

INSERT INTO permissoes (id, modulo, tela, acao, codigo, descricao) VALUES
  ('painel_logistica_recebimento.view', 'painel', 'logistica_recebimento', 'view', 'painel_logistica_recebimento.view', 'Visualizar Recebimento (Logística)'),
  ('painel_logistica_recebimento.create', 'painel', 'logistica_recebimento', 'create', 'painel_logistica_recebimento.create', 'Registrar Recebimento (Logística)'),
  ('painel_logistica_recebimento.edit', 'painel', 'logistica_recebimento', 'edit', 'painel_logistica_recebimento.edit', 'Editar Recebimento (Logística)'),
  ('painel_logistica_recebimento.delete', 'painel', 'logistica_recebimento', 'delete', 'painel_logistica_recebimento.delete', 'Excluir Recebimento (Logística)'),
  ('ind_validacao.view', 'industrializacao', 'validacao', 'view', 'ind_validacao.view', 'Visualizar Validação (Industrialização)'),
  ('ind_validacao.edit', 'industrializacao', 'validacao', 'edit', 'ind_validacao.edit', 'Editar Validação (Industrialização)'),
  ('ind_validacao.delete', 'industrializacao', 'validacao', 'delete', 'ind_validacao.delete', 'Excluir Validação (Industrialização)'),
  ('ind_validacao.validate', 'industrializacao', 'validacao', 'validate', 'ind_validacao.validate', 'Validar recebimento (efetivar no Estoque de MP)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO perfil_permissoes (perfil_id, permission_key)
SELECT p.id, x.permission_key
FROM perfis p
CROSS JOIN (VALUES
  ('painel_logistica_recebimento.view'),
  ('painel_logistica_recebimento.create'),
  ('painel_logistica_recebimento.edit'),
  ('painel_logistica_recebimento.delete'),
  ('ind_validacao.view'),
  ('ind_validacao.edit'),
  ('ind_validacao.delete'),
  ('ind_validacao.validate')
) AS x(permission_key)
WHERE p.slug = 'administrador'
   OR p.id = 'perfil_administrador'
   OR lower(trim(p.nome)) = 'administrador'
ON CONFLICT DO NOTHING;

SELECT _grant_codes_to_user(u.id, ARRAY[
  'painel_logistica_recebimento.view',
  'painel_logistica_recebimento.create',
  'painel_logistica_recebimento.edit',
  'painel_logistica_recebimento.delete',
  'ind_validacao.view',
  'ind_validacao.edit',
  'ind_validacao.delete',
  'ind_validacao.validate'
])
FROM ind_lista_usuarios u
WHERE EXISTS (
  SELECT 1 FROM perfis pf
  WHERE pf.id = u.perfil_id
    AND (pf.slug = 'administrador' OR pf.id = 'perfil_administrador' OR lower(trim(pf.nome)) = 'administrador')
)
OR lower(trim(coalesce(u.nivel_acesso, ''))) = 'administrador';

-- Operadores de logística passam a registrar recebimento
SELECT _grant_codes_to_user(u.usuario_id, ARRAY[
  'painel_logistica_recebimento.view',
  'painel_logistica_recebimento.create'
])
FROM (
  SELECT DISTINCT usuario_id
  FROM usuario_permissoes
  WHERE permissao_id IN (
    'painel_logistica.view',
    'painel_logistica_agendamentos.view',
    'painel_logistica_carregamentos.view'
  )
) u;

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
