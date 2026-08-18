-- Subitens de Operacional no Painel: Ordem de Transbordo e Estoque
-- Idempotente.

INSERT INTO permissoes (id, modulo, tela, acao, codigo, descricao) VALUES
  ('painel_operacional_ordem_transbordo.view', 'painel', 'operacional_ordem_transbordo', 'view', 'painel_operacional_ordem_transbordo.view', 'Visualizar Ordem de Transbordo'),
  ('painel_operacional_ordem_transbordo.create', 'painel', 'operacional_ordem_transbordo', 'create', 'painel_operacional_ordem_transbordo.create', 'Criar Ordem de Transbordo'),
  ('painel_operacional_ordem_transbordo.edit', 'painel', 'operacional_ordem_transbordo', 'edit', 'painel_operacional_ordem_transbordo.edit', 'Editar Ordem de Transbordo'),
  ('painel_operacional_ordem_transbordo.delete', 'painel', 'operacional_ordem_transbordo', 'delete', 'painel_operacional_ordem_transbordo.delete', 'Excluir Ordem de Transbordo'),
  ('painel_operacional_estoque.view', 'painel', 'operacional_estoque', 'view', 'painel_operacional_estoque.view', 'Visualizar Estoque Operacional')
ON CONFLICT (id) DO NOTHING;

INSERT INTO perfil_permissoes (perfil_id, permission_key)
SELECT p.id, x.permission_key
FROM perfis p
CROSS JOIN (VALUES
  ('painel_operacional_ordem_transbordo.view'),
  ('painel_operacional_ordem_transbordo.create'),
  ('painel_operacional_ordem_transbordo.edit'),
  ('painel_operacional_ordem_transbordo.delete'),
  ('painel_operacional_estoque.view')
) AS x(permission_key)
WHERE p.slug = 'administrador'
   OR p.id = 'perfil_administrador'
   OR lower(trim(p.nome)) = 'administrador'
ON CONFLICT DO NOTHING;

SELECT _grant_codes_to_user(u.id, ARRAY[
  'painel_operacional_ordem_transbordo.view',
  'painel_operacional_ordem_transbordo.create',
  'painel_operacional_ordem_transbordo.edit',
  'painel_operacional_ordem_transbordo.delete',
  'painel_operacional_estoque.view'
])
FROM ind_lista_usuarios u
WHERE EXISTS (
  SELECT 1 FROM perfis pf
  WHERE pf.id = u.perfil_id
    AND (pf.slug = 'administrador' OR pf.id = 'perfil_administrador' OR lower(trim(pf.nome)) = 'administrador')
)
OR lower(trim(coalesce(u.nivel_acesso, ''))) = 'administrador';

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
