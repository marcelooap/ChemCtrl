-- Permissões da tela Faturamento (Painel)
-- Idempotente: pode rodar em bases que já aplicaram migration_user_permissions.sql
-- Causa do bug: replace_user_permissions filtra códigos inexistentes em `permissoes`,
-- então marcar Faturamento e salvar descartava silenciosamente a permissão.

INSERT INTO permissoes (id, modulo, tela, acao, codigo, descricao) VALUES
  ('painel_faturamento.view', 'painel', 'faturamento', 'view', 'painel_faturamento.view', 'Visualizar Faturamento do Painel'),
  ('painel_faturamento.edit', 'painel', 'faturamento', 'edit', 'painel_faturamento.edit', 'Editar tarifas de Faturamento')
ON CONFLICT (id) DO NOTHING;

INSERT INTO perfil_permissoes (perfil_id, permission_key)
SELECT p.id, x.permission_key
FROM perfis p
CROSS JOIN (VALUES
  ('painel_faturamento.view'),
  ('painel_faturamento.edit')
) AS x(permission_key)
WHERE p.slug = 'administrador'
   OR p.id = 'perfil_administrador'
   OR lower(trim(p.nome)) = 'administrador'
ON CONFLICT DO NOTHING;

SELECT _grant_codes_to_user(u.id, ARRAY[
  'painel_faturamento.view',
  'painel_faturamento.edit'
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
