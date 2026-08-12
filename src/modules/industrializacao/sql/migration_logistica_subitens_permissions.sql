-- Subitens de Logística no Painel: Agendamentos e Carregamentos
-- Idempotente. Replica o acesso de quem já tinha painel_logistica.view.

INSERT INTO permissoes (id, modulo, tela, acao, codigo, descricao) VALUES
  ('painel_logistica_agendamentos.view', 'painel', 'logistica_agendamentos', 'view', 'painel_logistica_agendamentos.view', 'Visualizar Agendamentos de Logística'),
  ('painel_logistica_carregamentos.view', 'painel', 'logistica_carregamentos', 'view', 'painel_logistica_carregamentos.view', 'Visualizar Carregamentos de Logística')
ON CONFLICT (id) DO NOTHING;

INSERT INTO perfil_permissoes (perfil_id, permission_key)
SELECT p.id, x.permission_key
FROM perfis p
CROSS JOIN (VALUES
  ('painel_logistica_agendamentos.view'),
  ('painel_logistica_carregamentos.view')
) AS x(permission_key)
WHERE p.slug = 'administrador'
   OR p.id = 'perfil_administrador'
   OR lower(trim(p.nome)) = 'administrador'
ON CONFLICT DO NOTHING;

-- Quem já via Logística passa a ver os dois subitens
SELECT _grant_codes_to_user(u.usuario_id, ARRAY[
  'painel_logistica_agendamentos.view',
  'painel_logistica_carregamentos.view'
])
FROM (
  SELECT DISTINCT usuario_id
  FROM usuario_permissoes
  WHERE permissao_id IN ('painel_logistica.view')
) u;

SELECT _grant_codes_to_user(u.id, ARRAY[
  'painel_logistica_agendamentos.view',
  'painel_logistica_carregamentos.view'
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
