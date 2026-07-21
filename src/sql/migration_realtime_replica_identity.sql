-- ============================================================
-- MIGRAÇÃO: Habilitar Supabase Realtime em todas as tabelas
-- ============================================================
-- Execute este script no SQL Editor do Supabase Dashboard
-- para garantir que os eventos UPDATE e DELETE incluam os
-- dados completos do registro (REPLICA IDENTITY FULL).
--
-- Sem isso, o payload de UPDATE/DELETE chega com `new: {}`
-- ou `old: {}` e o sistema precisa fazer refetch completo.
-- Com REPLICA IDENTITY FULL, o estado local é atualizado
-- diretamente sem consulta adicional ao banco.
-- ============================================================

-- 1. Habilitar REPLICA IDENTITY FULL em todas as tabelas
ALTER TABLE public.productions           REPLICA IDENTITY FULL;
ALTER TABLE public.usuarios              REPLICA IDENTITY FULL;
ALTER TABLE public.raw_material_stocks   REPLICA IDENTITY FULL;
ALTER TABLE public.tanks                 REPLICA IDENTITY FULL;
ALTER TABLE public.transfers             REPLICA IDENTITY FULL;
ALTER TABLE public.containers            REPLICA IDENTITY FULL;
ALTER TABLE public.orders                REPLICA IDENTITY FULL;
ALTER TABLE public.recipes               REPLICA IDENTITY FULL;
ALTER TABLE public.quality_results       REPLICA IDENTITY FULL;
ALTER TABLE public.quality_tests         REPLICA IDENTITY FULL;
ALTER TABLE public.inventories           REPLICA IDENTITY FULL;

-- 2. Adicionar todas as tabelas à publication do Supabase Realtime
-- (necessário para que os eventos sejam transmitidos via WebSocket)
ALTER PUBLICATION supabase_realtime ADD TABLE public.productions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.usuarios;
ALTER PUBLICATION supabase_realtime ADD TABLE public.raw_material_stocks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tanks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transfers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.containers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.recipes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.quality_results;
ALTER PUBLICATION supabase_realtime ADD TABLE public.quality_tests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventories;

-- 3. Verificar quais tabelas estão na publication (deve listar todas acima)
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
