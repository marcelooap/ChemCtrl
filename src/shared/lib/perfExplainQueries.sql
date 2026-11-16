-- Consultas candidatas a EXPLAIN ANALYZE (auditoria de performance ChemCtrl).
-- Executar no SQL Editor do Supabase / psql. Não altera dados.

-- 1) estoque_produtos (fetchAll / entradas)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM public.estoque_produtos
ORDER BY id
LIMIT 1000;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM public.estoque_produtos
WHERE origem = 'ARMAZENAGEM'
ORDER BY id
LIMIT 1000;

-- 2) t_saidas / t_vasilhames / t_transbordos (listagens operacionais)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM public.t_saidas
ORDER BY created_at DESC
LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM public.t_vasilhames
ORDER BY created_at DESC
LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM public.t_transbordos
ORDER BY created_at DESC
LIMIT 50;

-- 3) agendamentos concluídos (Carregamentos)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM public.t_agendamentos_carregamento
WHERE status = 'concluido'
  AND data >= (CURRENT_DATE - INTERVAL '90 days')
ORDER BY data DESC, hora_carregamento DESC;

-- 4) saidas painel (badges)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, modulo_origem, status, enviado_ao_fiscal, itens, validacao_modulos
FROM public.t_saidas
WHERE modulo_origem = 'painel';

-- 5) data_solicitacao (candidato a índice 064)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, data_solicitacao, cliente_nome, status
FROM public.t_saidas
ORDER BY data_solicitacao DESC NULLS LAST
LIMIT 50;

-- 6) Industrialização
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, op_number, product, client, lot, status, volume, end_time
FROM public.ind_lista_producoes
ORDER BY created_date DESC
LIMIT 500;
