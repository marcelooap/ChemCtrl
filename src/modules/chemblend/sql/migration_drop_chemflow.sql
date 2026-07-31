-- ============================================================================
-- ChemCtrl — Remoção completa do domínio ChemFlow do banco unificado
-- ============================================================================
-- EXECUTAR NO SQL EDITOR DO PROJETO CHEMBLEND (cpzibnwytukcgxeamfhp)
--
-- Remove apenas objetos exclusivos do ChemFlow (tabelas em português +
-- função utilitária prefixada). Não toca em:
--   - tabelas do ChemBlend (productions, recipes, containers, etc.)
--   - autenticação da plataforma (usuarios, sessions, perfis, ...)
--   - rate limiting, RPCs, storage, extensão pgcrypto
--
-- Pré-requisito: o módulo ChemFlow não deve mais depender deste banco.
-- Ordem: filhos → pais (respeitando FKs). CASCADE remove policies,
-- triggers e indexes associados automaticamente.
-- ============================================================================

-- Dependentes
DROP TABLE IF EXISTS public.filtracoes CASCADE;
DROP TABLE IF EXISTS public.estoque CASCADE;
DROP TABLE IF EXISTS public.vasilhames CASCADE;
DROP TABLE IF EXISTS public.saidas CASCADE;
DROP TABLE IF EXISTS public.entradas CASCADE;
DROP TABLE IF EXISTS public.transbordos CASCADE;
DROP TABLE IF EXISTS public.isotanques CASCADE;
DROP TABLE IF EXISTS public.produtos CASCADE;
DROP TABLE IF EXISTS public.elementos_filtrantes CASCADE;
DROP TABLE IF EXISTS public.descontaminacoes CASCADE;
DROP TABLE IF EXISTS public.clientes CASCADE;

-- Função de trigger do ChemFlow
DROP FUNCTION IF EXISTS public.chemflow_set_updated_at() CASCADE;

-- Verificação opcional (deve retornar 0 linhas):
-- SELECT tablename
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'clientes', 'produtos', 'isotanques', 'descontaminacoes',
--     'entradas', 'estoque', 'transbordos', 'vasilhames', 'saidas',
--     'elementos_filtrantes', 'filtracoes'
--   );
