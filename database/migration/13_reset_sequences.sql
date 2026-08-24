-- ============================================================================
-- ChemCtrl v2 — Pós-migração: reset de sequences
-- Executar no SQL Editor do projeto NOVO (target), após 00…12.
-- ============================================================================

SELECT setval(
  'transbordo_validacoes_numero_seq',
  COALESCE((SELECT MAX(numero) FROM transbordo_validacoes), 1)
);

SELECT setval(
  'validacoes_mp_numero_seq',
  COALESCE((SELECT MAX(numero) FROM validacoes_mp), 1)
);

SELECT setval(
  'estoque_codigo_seq',
  COALESCE((SELECT MAX(codigo_estoque) FROM estoque), 1)
);
