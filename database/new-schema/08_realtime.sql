-- ============================================================================
-- ChemCtrl v2 — Bloco 08: Realtime (somente tabelas com consumidor no código)
-- Em projetos Supabase, a publication `supabase_realtime` já existe.
-- Preferir ADD TABLE idempotente em vez de DROP/CREATE.
-- ============================================================================

ALTER TABLE producoes REPLICA IDENTITY FULL;
ALTER TABLE pedidos REPLICA IDENTITY FULL;
ALTER TABLE vasilhames_producao REPLICA IDENTITY FULL;
ALTER TABLE composicao_vasilhame_producao REPLICA IDENTITY FULL;
ALTER TABLE transferencias_ind REPLICA IDENTITY FULL;
ALTER TABLE estoque_mp REPLICA IDENTITY FULL;
ALTER TABLE movimentos_mp REPLICA IDENTITY FULL;
ALTER TABLE receitas REPLICA IDENTITY FULL;
ALTER TABLE tanques_ind REPLICA IDENTITY FULL;
ALTER TABLE inventarios_mp REPLICA IDENTITY FULL;
ALTER TABLE usuarios REPLICA IDENTITY FULL;
ALTER TABLE cq_especificacoes REPLICA IDENTITY FULL;
ALTER TABLE cq_resultados REPLICA IDENTITY FULL;
ALTER TABLE equipamentos_lab REPLICA IDENTITY FULL;
ALTER TABLE programacao_demanda REPLICA IDENTITY FULL;
ALTER TABLE saidas REPLICA IDENTITY FULL;
ALTER TABLE saida_leituras REPLICA IDENTITY FULL;
ALTER TABLE transbordo_validacoes REPLICA IDENTITY FULL;
ALTER TABLE validacoes_mp REPLICA IDENTITY FULL;
ALTER TABLE validacao_leituras REPLICA IDENTITY FULL;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'producoes','pedidos','vasilhames_producao','composicao_vasilhame_producao',
    'transferencias_ind','estoque_mp','movimentos_mp','receitas','tanques_ind',
    'inventarios_mp','usuarios','cq_especificacoes','cq_resultados',
    'equipamentos_lab','programacao_demanda','saidas','saida_leituras',
    'transbordo_validacoes','validacoes_mp','validacao_leituras'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN undefined_object THEN
        RAISE NOTICE 'Publication supabase_realtime inexistente — criar manualmente no Dashboard';
    END;
  END LOOP;
END $$;
