-- ============================================================================
-- ChemCtrl v2 — Bloco 07: RLS e Policies (Fase A — compatibilidade)
-- ============================================================================

-- Grupo A: domínio — USING (true) (mesmo padrão atual; hardening = Fase B)
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'modulos','perfis','perfil_permissoes','perfil_auditoria','perfil_modulos',
    'clientes','operadores','etiqueta_configs',
    'produtos','isotanques','descontaminacoes','elementos_filtrantes',
    'entradas','estoque','transbordos','vasilhames','filtracoes',
    'material_reservas','transbordo_validacoes',
    'saidas','saida_leituras','agendamentos_carregamento','validacao_leituras',
    'receitas','pedidos','producoes','estoque_mp','movimentos_mp','tanques_ind',
    'transferencias_ind','vasilhames_producao','composicao_vasilhame_producao',
    'checklist_producao','cq_resultados','cq_especificacoes','ensaios',
    'inventarios_mp','equipamentos_lab','programacao_demanda','validacoes_mp'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS anon_all_%1$s ON %1$s', t);
    EXECUTE format(
      'CREATE POLICY anon_all_%1$s ON %1$s
         FOR ALL TO anon, authenticated
         USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- Grupo B: sensíveis
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_usuarios ON usuarios;
CREATE POLICY allow_all_usuarios ON usuarios
  FOR ALL USING (true) WITH CHECK (true);
-- Nota: senhas em texto são limpas pelo trigger; senha_hash permanece.
-- Fase B deve restringir SELECT de senha_hash.

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS no_direct_access_sessions ON sessions;
CREATE POLICY no_direct_access_sessions ON sessions
  FOR ALL USING (false) WITH CHECK (false);

ALTER TABLE permissoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permissoes_select_session ON permissoes;
-- get_current_session definida no bloco de RPCs; policy criada após RPCs se necessário.
-- Temporário: SELECT aberto para catálogo (códigos não são secretos); escrita bloqueada.
CREATE POLICY permissoes_select_all ON permissoes
  FOR SELECT USING (true);
DROP POLICY IF EXISTS permissoes_no_insert ON permissoes;
CREATE POLICY permissoes_no_insert ON permissoes FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS permissoes_no_update ON permissoes;
CREATE POLICY permissoes_no_update ON permissoes FOR UPDATE USING (false);
DROP POLICY IF EXISTS permissoes_no_delete ON permissoes;
CREATE POLICY permissoes_no_delete ON permissoes FOR DELETE USING (false);

ALTER TABLE usuario_permissoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usuario_permissoes_no_direct_access ON usuario_permissoes;
CREATE POLICY usuario_permissoes_no_direct_access ON usuario_permissoes
  FOR ALL USING (false) WITH CHECK (false);

ALTER TABLE rate_limit_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS no_direct_access_rate_limit_attempts ON rate_limit_attempts;
CREATE POLICY no_direct_access_rate_limit_attempts ON rate_limit_attempts
  FOR ALL USING (false) WITH CHECK (false);

ALTER TABLE rate_limit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS no_direct_access_rate_limit_logs ON rate_limit_logs;
CREATE POLICY no_direct_access_rate_limit_logs ON rate_limit_logs
  FOR ALL USING (false) WITH CHECK (false);
