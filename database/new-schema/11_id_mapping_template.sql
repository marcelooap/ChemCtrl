-- ============================================================================
-- ChemCtrl v2 — Template de mapeamento de IDs (migração de DADOS — etapa posterior)
-- NÃO executar no banco atual. Usar após DDL no NOVO projeto, com FDW/dblink
-- ou export/import controlado.
-- ============================================================================
-- Princípio: Nunca gerar UUIDs independentes para PK e FK sem mapa.

/*
Exemplo de fluxo (pseudocódigo operacional):

-- No banco NOVO, após criar tabelas:

CREATE TABLE IF NOT EXISTS _mig_map_receitas (
  old_id text PRIMARY KEY,
  new_id uuid NOT NULL UNIQUE
);

INSERT INTO _mig_map_receitas (old_id, new_id)
SELECT id, gen_random_uuid() FROM dblink(... 'SELECT id FROM ind_lista_receitas') ...;

INSERT INTO receitas (id, created_at, updated_at, ...)
SELECT m.new_id, r.created_date, r.updated_date, ...
FROM source.ind_lista_receitas r
JOIN _mig_map_receitas m ON m.old_id = r.id;

-- FKs dependentes usam o mesmo mapa:
INSERT INTO producoes (id, recipe_id, ...)
SELECT mp.new_id, mr.new_id, ...
FROM source.ind_lista_producoes p
JOIN _mig_map_producoes mp ON mp.old_id = p.id
LEFT JOIN _mig_map_receitas mr ON mr.old_id = p.recipe_id;

Tabelas que exigem mapa (PK text → uuid):
  usuarios, receitas, pedidos, producoes, estoque_mp, movimentos_mp,
  tanques_ind, transferencias_ind, vasilhames_producao, composicao_vasilhame_producao,
  checklist_producao, cq_resultados, cq_especificacoes, ensaios, inventarios_mp,
  equipamentos_lab, programacao_demanda, validacoes_mp

Tabelas que NÃO precisam de remap de PK (já uuid):
  clientes, produtos, isotanques, entradas, estoque, transbordos, vasilhames,
  saidas, etc. (todas t_*)
*/
