-- ============================================================================
-- Migration: Controle de Revisões de Receitas
-- Adiciona numeração de revisão (revision_number) à tabela recipes,
-- preservando todo o histórico existente como Revisão 01 (ou sequência
-- ordinal, quando já existirem múltiplas linhas para o mesmo produto).
-- Execute no: Supabase Dashboard → SQL Editor
--
-- Modelo: cada revisão de uma receita é uma LINHA própria em `recipes`
-- (não uma tabela filha). productions.recipe_id já aponta para o id exato
-- da linha usada, então nenhuma revisão anterior é perdida ou substituída.
-- ============================================================================

-- 1. Nova coluna de numeração (nullable por enquanto, para permitir o backfill)
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS revision_number integer;

-- 2. Backfill: numera as revisões existentes por produto, na ordem de criação.
--    Produtos com uma única receita cadastrada viram Revisão 01 automaticamente.
--    Produtos que já tinham múltiplas linhas (mesmo product_name) passam a ter
--    esse histórico reconhecido como Revisão 01, 02, 03... em vez de registros
--    soltos e ambíguos.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY product_name ORDER BY created_date ASC, id ASC
  ) AS rn
  FROM recipes
)
UPDATE recipes r
SET revision_number = ranked.rn
FROM ranked
WHERE r.id = ranked.id
  AND r.revision_number IS NULL;

-- 3. Trava a coluna: sempre obrigatória, default 1 para novas receitas simples.
ALTER TABLE recipes ALTER COLUMN revision_number SET DEFAULT 1;
ALTER TABLE recipes ALTER COLUMN revision_number SET NOT NULL;

-- 4. Normaliza o rótulo textual de revisão para o padrão "Revisão NN",
--    mantendo consistência com o número real armazenado (evita numeração
--    manual divergente do histórico).
UPDATE recipes
SET revision = 'Revisão ' || lpad(revision_number::text, 2, '0')
WHERE revision IS NULL OR revision !~ '^Revisão \d{2}$';

-- 5. Garante data de revisão preenchida (usa a data de criação do registro
--    quando ausente, preservando o histórico real de cada revisão).
UPDATE recipes
SET revision_date = created_date::date
WHERE revision_date IS NULL;

-- 6. Índice para consultas de "última revisão do produto" (usado pela UI ao
--    abrir Editar/Visualizar/Nova Produção sempre na revisão mais recente).
CREATE INDEX IF NOT EXISTS idx_recipes_product_revision
  ON recipes (product_name, revision_number DESC);

-- 7. Integridade: nunca duas revisões com o mesmo número para o mesmo produto.
DO $$ BEGIN
  ALTER TABLE recipes
    ADD CONSTRAINT recipes_product_revision_unique UNIQUE (product_name, revision_number);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN recipes.revision_number IS
  'Número sequencial da revisão da receita (1 = Revisão 01). Nunca editável manualmente pelo usuário; incrementado automaticamente ao criar uma nova revisão.';
