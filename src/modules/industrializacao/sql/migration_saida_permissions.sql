-- Permissões da tela Saída (Industrialização)
-- Idempotente: pode rodar em bases que já aplicaram migration_user_permissions.sql

INSERT INTO permissoes (id, modulo, tela, acao, codigo, descricao) VALUES
  ('saida.view', 'industrializacao', 'saida', 'view', 'saida.view', 'Visualizar Saída'),
  ('saida.create', 'industrializacao', 'saida', 'create', 'saida.create', 'Criar Saída'),
  ('saida.edit', 'industrializacao', 'saida', 'edit', 'saida.edit', 'Editar Saída'),
  ('saida.delete', 'industrializacao', 'saida', 'delete', 'saida.delete', 'Excluir Saída')
ON CONFLICT (id) DO NOTHING;

-- Concede ao perfil Administrador (se existir)
INSERT INTO perfil_permissoes (perfil_id, permission_key)
SELECT p.id, x.permission_key
FROM perfis p
CROSS JOIN (VALUES
  ('saida.view'),
  ('saida.create'),
  ('saida.edit'),
  ('saida.delete')
) AS x(permission_key)
WHERE p.slug = 'administrador'
   OR p.id = 'perfil_administrador'
   OR lower(trim(p.nome)) = 'administrador'
ON CONFLICT DO NOTHING;

-- Concede a administradores já provisionados
SELECT _grant_codes_to_user(u.id, ARRAY[
  'saida.view',
  'saida.create',
  'saida.edit',
  'saida.delete'
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
