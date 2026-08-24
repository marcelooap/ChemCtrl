-- ============================================================================
-- ChemCtrl — AUDITORIA DE INTEGRIDADE / ÓRFÃOS (SOMENTE LEITURA)
-- ============================================================================
-- Executar no SQL Editor do projeto Supabase ATUAL antes de criar FKs no novo banco.
-- Classificar cada resultado: OK | órfão | inconsistente.
-- NÃO altera dados.
-- ============================================================================

-- 5.1.a — producoes.recipe_id → receitas
SELECT 'producoes.recipe_id' AS check_name, p.id, p.recipe_id AS orphan_fk
FROM ind_lista_producoes p
LEFT JOIN ind_lista_receitas r ON r.id = p.recipe_id
WHERE p.recipe_id IS NOT NULL AND r.id IS NULL;

-- 5.1.b — producoes.order_id → pedidos
SELECT 'producoes.order_id' AS check_name, p.id, p.order_id AS orphan_fk
FROM ind_lista_producoes p
LEFT JOIN ind_lista_pedidos o ON o.id = p.order_id
WHERE p.order_id IS NOT NULL AND o.id IS NULL;

-- 5.1.c — cq_resultados.production_id → producoes (CRÍTICO se > 0)
SELECT 'cq_resultados.production_id' AS check_name, q.id, q.production_id AS orphan_fk
FROM ind_cq_resultados q
LEFT JOIN ind_lista_producoes p ON p.id = q.production_id
WHERE p.id IS NULL;

-- 5.1.d — checklist_op.production_id → producoes (CRÍTICO se > 0)
SELECT 'checklist_op.production_id' AS check_name, c.id, c.production_id AS orphan_fk
FROM ind_checklist_op c
LEFT JOIN ind_lista_producoes p ON p.id = c.production_id
WHERE p.id IS NULL;

-- 5.1.e — vasilhames.production_id → producoes
SELECT 'vasilhames.production_id' AS check_name, v.id, v.production_id AS orphan_fk
FROM ind_lista_vasilhames v
LEFT JOIN ind_lista_producoes p ON p.id = v.production_id
WHERE v.production_id IS NOT NULL AND p.id IS NULL;

-- 5.1.f — composicao.container_id → vasilhames (CRÍTICO se > 0)
SELECT 'composicao.container_id' AS check_name, c.id, c.container_id AS orphan_fk
FROM ind_composicao_vasilhame c
LEFT JOIN ind_lista_vasilhames v ON v.id = c.container_id
WHERE v.id IS NULL;

-- 5.1.g — composicao.production_id → producoes
SELECT 'composicao.production_id' AS check_name, c.id, c.production_id AS orphan_fk
FROM ind_composicao_vasilhame c
LEFT JOIN ind_lista_producoes p ON p.id = c.production_id
WHERE c.production_id IS NOT NULL AND p.id IS NULL;

-- 5.1.h — movimentos.stock_id → estoque_mp
SELECT 'movimentos.stock_id' AS check_name, m.id, m.stock_id AS orphan_fk
FROM ind_retornos_perdas m
LEFT JOIN ind_estoque_mp e ON e.id = m.stock_id
WHERE m.stock_id IS NOT NULL AND e.id IS NULL;

-- 5.1.i — programacao.order_id → pedidos
SELECT 'programacao.order_id' AS check_name, pd.id, pd.order_id AS orphan_fk
FROM ind_programacao_demanda pd
LEFT JOIN ind_lista_pedidos o ON o.id = pd.order_id
WHERE pd.order_id IS NOT NULL AND o.id IS NULL;

-- 5.1.j — checklist.recipe_id → receitas
SELECT 'checklist.recipe_id' AS check_name, c.id, c.recipe_id AS orphan_fk
FROM ind_checklist_op c
LEFT JOIN ind_lista_receitas r ON r.id = c.recipe_id
WHERE c.recipe_id IS NOT NULL AND r.id IS NULL;

-- Extra: usuarios.perfil_id → perfis
SELECT 'usuarios.perfil_id' AS check_name, u.id, u.perfil_id AS orphan_fk
FROM ind_lista_usuarios u
LEFT JOIN perfis p ON p.id = u.perfil_id
WHERE u.perfil_id IS NOT NULL AND p.id IS NULL;

-- Extra: t_estoque.entrada_id → t_entradas
SELECT 'estoque.entrada_id' AS check_name, e.id, e.entrada_id AS orphan_fk
FROM t_estoque e
LEFT JOIN t_entradas en ON en.id = e.entrada_id
WHERE e.entrada_id IS NOT NULL AND en.id IS NULL;

-- Extra: t_produtos.cliente_id → t_clientes
SELECT 'produtos.cliente_id' AS check_name, p.id, p.cliente_id AS orphan_fk
FROM t_produtos p
LEFT JOIN t_clientes c ON c.id = p.cliente_id
WHERE p.cliente_id IS NOT NULL AND c.id IS NULL;

-- Extra: agendamentos.saida_id → saidas
SELECT 'agendamentos.saida_id' AS check_name, a.id, a.saida_id AS orphan_fk
FROM t_agendamentos_carregamento a
LEFT JOIN t_saidas s ON s.id = a.saida_id
WHERE a.saida_id IS NOT NULL AND s.id IS NULL;

-- Extra: uniques que podem falhar na carga
SELECT product_name, revision_number, COUNT(*) AS dupes
FROM ind_lista_receitas
GROUP BY product_name, revision_number
HAVING COUNT(*) > 1;

SELECT analysis_name, COUNT(*) AS dupes
FROM ind_lista_ensaios
GROUP BY analysis_name
HAVING COUNT(*) > 1;

SELECT contexto, tipo, lower(btrim(cliente_nome)) AS cliente_key, COUNT(*) AS dupes
FROM t_etiqueta_configs
GROUP BY contexto, tipo, lower(btrim(cliente_nome))
HAVING COUNT(*) > 1;

-- Resumo de contagens para validação ANTES × DEPOIS
SELECT 'ind_lista_usuarios' AS tabela, COUNT(*)::bigint AS total FROM ind_lista_usuarios
UNION ALL SELECT 't_clientes', COUNT(*) FROM t_clientes
UNION ALL SELECT 't_produtos', COUNT(*) FROM t_produtos
UNION ALL SELECT 't_operadores', COUNT(*) FROM t_operadores
UNION ALL SELECT 't_entradas', COUNT(*) FROM t_entradas
UNION ALL SELECT 't_estoque', COUNT(*) FROM t_estoque
UNION ALL SELECT 't_transbordos', COUNT(*) FROM t_transbordos
UNION ALL SELECT 't_vasilhames', COUNT(*) FROM t_vasilhames
UNION ALL SELECT 't_saidas', COUNT(*) FROM t_saidas
UNION ALL SELECT 't_transbordo_validacoes', COUNT(*) FROM t_transbordo_validacoes
UNION ALL SELECT 'ind_lista_receitas', COUNT(*) FROM ind_lista_receitas
UNION ALL SELECT 'ind_lista_pedidos', COUNT(*) FROM ind_lista_pedidos
UNION ALL SELECT 'ind_lista_producoes', COUNT(*) FROM ind_lista_producoes
UNION ALL SELECT 'ind_estoque_mp', COUNT(*) FROM ind_estoque_mp
UNION ALL SELECT 'ind_lista_vasilhames', COUNT(*) FROM ind_lista_vasilhames
UNION ALL SELECT 'ind_cq_resultados', COUNT(*) FROM ind_cq_resultados
UNION ALL SELECT 'ind_checklist_op', COUNT(*) FROM ind_checklist_op
UNION ALL SELECT 'ind_validacoes', COUNT(*) FROM ind_validacoes
UNION ALL SELECT 'perfis', COUNT(*) FROM perfis
UNION ALL SELECT 'permissoes', COUNT(*) FROM permissoes
ORDER BY 1;
