-- Programação de demanda da Industrialização (planejamento mensal)
-- Não cria Ordem de Produção. Idempotente — pode rodar de novo.

CREATE TABLE IF NOT EXISTS ind_programacao_demanda (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date TIMESTAMPTZ DEFAULT now(),
  updated_date TIMESTAMPTZ DEFAULT now(),
  created_by TEXT,
  scheduled_date DATE NOT NULL,
  product TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  volume NUMERIC NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ind_programacao_demanda_date
  ON ind_programacao_demanda (scheduled_date);

ALTER TABLE ind_programacao_demanda ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "ind_programacao_demanda_all"
    ON ind_programacao_demanda FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS update_updated_date_ind_programacao_demanda ON ind_programacao_demanda;
CREATE TRIGGER update_updated_date_ind_programacao_demanda
  BEFORE UPDATE ON ind_programacao_demanda
  FOR EACH ROW EXECUTE FUNCTION update_updated_date();

ALTER TABLE ind_programacao_demanda REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ind_programacao_demanda;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- Catálogo de códigos (necessário para _grant_codes_to_user)
INSERT INTO permissoes (id, modulo, tela, acao, codigo, descricao) VALUES
  ('programming.view', 'industrializacao', 'programming', 'view', 'programming.view', 'Visualizar Programação'),
  ('programming.create', 'industrializacao', 'programming', 'create', 'programming.create', 'Criar Programação'),
  ('programming.edit', 'industrializacao', 'programming', 'edit', 'programming.edit', 'Editar Programação'),
  ('programming.delete', 'industrializacao', 'programming', 'delete', 'programming.delete', 'Excluir Programação')
ON CONFLICT (id) DO NOTHING;

-- Perfis (id, slug ou nome)
INSERT INTO perfil_permissoes (perfil_id, permission_key)
SELECT p.id, x.permission_key
FROM perfis p
CROSS JOIN (VALUES
  ('programming.view'),
  ('programming.create'),
  ('programming.edit'),
  ('programming.delete')
) AS x(permission_key)
WHERE p.slug IN ('administrador', 'supervisor', 'operacional')
   OR p.id IN ('perfil_administrador', 'perfil_supervisor', 'perfil_operacional')
   OR lower(trim(p.nome)) IN ('administrador', 'supervisor', 'operacional')
ON CONFLICT DO NOTHING;

-- Usuários já provisionados (a sessão lê usuario_permissoes, não só o perfil)
SELECT _grant_codes_to_user(u.id, ARRAY[
  'programming.view',
  'programming.create',
  'programming.edit',
  'programming.delete'
])
FROM ind_lista_usuarios u
WHERE EXISTS (
  SELECT 1 FROM perfis pf
  WHERE pf.id = u.perfil_id
    AND (
      pf.slug IN ('administrador', 'supervisor', 'operacional')
      OR pf.id IN ('perfil_administrador', 'perfil_supervisor', 'perfil_operacional')
      OR lower(trim(pf.nome)) IN ('administrador', 'supervisor', 'operacional')
    )
)
OR lower(trim(coalesce(u.nivel_acesso, ''))) IN ('administrador', 'supervisor', 'operacional', 'operador');

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

ALTER TABLE ind_programacao_demanda ADD COLUMN IF NOT EXISTS order_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ind_programacao_demanda_order_id
  ON ind_programacao_demanda (order_id);

ALTER TABLE ind_programacao_demanda
  ADD COLUMN IF NOT EXISTS produced BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ind_programacao_demanda
  ADD COLUMN IF NOT EXISTS produced_at TIMESTAMPTZ;

ALTER TABLE ind_programacao_demanda
  ADD COLUMN IF NOT EXISTS produced_by TEXT;

CREATE INDEX IF NOT EXISTS idx_ind_programacao_demanda_produced
  ON ind_programacao_demanda (scheduled_date, produced);

SELECT pg_notify('pgrst', 'reload schema');
