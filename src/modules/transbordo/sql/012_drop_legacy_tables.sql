-- Transbordo — Limpeza das tabelas LEGADAS (sem prefixo t_)
-- ============================================================================
-- ⚠️  ATENÇÃO — OPERAÇÃO IRREVERSÍVEL
--
-- Execute este script SOMENTE depois de:
--   1. Rodar 011_t_tables_schema.sql com sucesso
--   2. Validar o módulo Transbordo (/chemflow) com as tabelas t_*
--      (Cadastro vazio, CRUD de produto/isotanque/vasilhame funcionando)
--
-- Este script remove as tabelas antigas do ChemFlow e TODOS os dados nelas.
-- Não há migração de dados — o módulo começa do zero nas tabelas t_*.
--
-- Ordem: dependentes primeiro (FKs), depois as bases.

-- Filtração depende de vasilhames, transbordos e elementos_filtrantes
drop table if exists filtracoes cascade;

drop table if exists elementos_filtrantes cascade;

drop table if exists saidas cascade;

-- Vasilhames depende de transbordos / produtos / clientes
drop table if exists vasilhames cascade;

drop table if exists transbordos cascade;

-- Estoque depende de entradas
drop table if exists estoque cascade;

drop table if exists entradas cascade;

drop table if exists descontaminacoes cascade;

drop table if exists isotanques cascade;

drop table if exists produtos cascade;

drop table if exists clientes cascade;

-- Função órfã do schema legado (não mais referenciada após os drops acima)
drop function if exists chemflow_set_updated_at() cascade;
