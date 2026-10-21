-- =============================================================================
-- PROPOSTA — NÃO EXECUTAR SEM APROVAÇÃO EXPLÍCITA
-- 067_estoque_produtos_rls_proposal.sql
--
-- Situação atual (060): policy estoque_produtos_all USING (true) WITH CHECK (true)
-- para anon + authenticated → qualquer cliente com anon key lê/grava sem x-session-id.
--
-- ChemCtrl usa sessão customizada (header x-session-id + tabela sessions) conforme
-- migration_security_audit.sql (is_internal_user, can_write, etc.).
--
-- Risco ao endurecer: estoqueProdutos.js e entidades Transbordo usam chemflowSupabase
-- sem injetar x-session-id hoje — exige alinhar cliente HTTP antes de trocar políticas.
--
-- Proposta alvo (após cliente enviar x-session-id em todas as rotas Transbordo/ChemFlow):
-- =============================================================================
/*
DROP POLICY IF EXISTS estoque_produtos_all ON estoque_produtos;

CREATE POLICY estoque_produtos_select ON estoque_produtos
  FOR SELECT TO anon, authenticated
  USING (is_internal_user() OR can_write());

CREATE POLICY estoque_produtos_insert ON estoque_produtos
  FOR INSERT TO anon, authenticated
  WITH CHECK (can_write());

CREATE POLICY estoque_produtos_update ON estoque_produtos
  FOR UPDATE TO anon, authenticated
  USING (can_write()) WITH CHECK (can_write());

CREATE POLICY estoque_produtos_delete ON estoque_produtos
  FOR DELETE TO anon, authenticated
  USING (can_write());

-- RPCs públicas (QR) permanecem SECURITY DEFINER: get_public_entrada_info,
-- get_public_raw_material_info — não dependem desta policy.

-- Realtime: revisar publication supabase_realtime após políticas.
SELECT pg_notify('pgrst', 'reload schema');
*/

-- Testes recomendados antes do GO-LIVE RLS:
-- 1) Login interno → listar/criar entrada e estoque MP
-- 2) Requisição sem x-session-id → SELECT retorna 0 linhas (não 401)
-- 3) Token público QR → RPC continua funcionando
-- 4) Painel/Transbordo/Industrialização smoke manual
