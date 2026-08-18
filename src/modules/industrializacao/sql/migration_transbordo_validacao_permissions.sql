-- Transbordo → Validação: permissões da nova tela de conferência/aprovação
-- ============================================================
-- Executar após aplicar 028_t_transbordo_validacoes.sql no ChemFlow.
-- Idempotente.

INSERT INTO permissoes (id, modulo, tela, acao, codigo, descricao) VALUES
  ('tb_validacao.view', 'transbordo', 'validacao', 'view', 'tb_validacao.view', 'Visualizar Validação (Transbordo)'),
  ('tb_validacao.edit', 'transbordo', 'validacao', 'edit', 'tb_validacao.edit', 'Editar Validação (Transbordo)'),
  ('tb_validacao.delete', 'transbordo', 'validacao', 'delete', 'tb_validacao.delete', 'Excluir Validação (Transbordo)'),
  ('tb_validacao.validate', 'transbordo', 'validacao', 'validate', 'tb_validacao.validate', 'Validar operação (efetivar movimentações)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO perfil_permissoes (perfil_id, permission_key)
SELECT p.id, x.permission_key
FROM perfis p
CROSS JOIN (VALUES
  ('tb_validacao.view'),
  ('tb_validacao.edit'),
  ('tb_validacao.delete'),
  ('tb_validacao.validate')
) AS x(permission_key)
WHERE p.slug = 'administrador'
   OR p.id = 'perfil_administrador'
   OR lower(trim(p.nome)) = 'administrador'
ON CONFLICT DO NOTHING;

SELECT _grant_codes_to_user(u.id, ARRAY[
  'tb_validacao.view',
  'tb_validacao.edit',
  'tb_validacao.delete',
  'tb_validacao.validate'
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
