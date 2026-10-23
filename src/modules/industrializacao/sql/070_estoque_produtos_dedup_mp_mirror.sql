-- =============================================================================
-- 070_estoque_produtos_dedup_mp_mirror.sql
-- Uma linha por item. Remove o espelho criado pelo fluxo de Entradas quando
-- já existe a linha operacional de matéria-prima (mesmo legacy_entrada_id + lote).
-- Não mexe em entradas de armazenagem com vários tanques/embalagens do mesmo lote.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE ep_mp_mirrors ON COMMIT DROP AS
SELECT
  keep.id AS keep_id,
  ghost.id AS ghost_id,
  ghost.legacy_estoque_id AS ghost_estoque_id,
  ghost.vasilhame_id AS ghost_vasilhame_id
FROM estoque_produtos keep
JOIN estoque_produtos ghost
  ON ghost.legacy_entrada_id = keep.legacy_entrada_id
 AND keep.id <> ghost.id
 AND keep.legacy_mp_id_text IS NOT NULL
 AND ghost.legacy_mp_id_text IS NULL
 AND keep.origem = 'MATERIA_PRIMA'
 AND ghost.origem = 'MATERIA_PRIMA'
 AND lower(btrim(coalesce(keep.lote, ''))) = lower(btrim(coalesce(ghost.lote, '')))
 AND lower(btrim(coalesce(keep.produto_codigo, ''))) = lower(btrim(coalesce(ghost.produto_codigo, '')))
 AND lower(btrim(coalesce(keep.produto_nome, ''))) = lower(btrim(coalesce(ghost.produto_nome, '')))
WHERE coalesce(ghost.grupo_entrada, '') NOT LIKE 'TB%';

UPDATE estoque_produtos ghost
SET legacy_estoque_id = NULL,
    updated_at = now()
FROM ep_mp_mirrors m
WHERE ghost.id = m.ghost_id
  AND m.ghost_estoque_id IS NOT NULL;

UPDATE estoque_produtos keep
SET
  legacy_estoque_id = COALESCE(keep.legacy_estoque_id, m.ghost_estoque_id),
  vasilhame_id = COALESCE(keep.vasilhame_id, m.ghost_vasilhame_id),
  updated_at = now()
FROM ep_mp_mirrors m
WHERE keep.id = m.keep_id;

DELETE FROM estoque_produtos ghost
USING ep_mp_mirrors m
WHERE ghost.id = m.ghost_id;

COMMIT;
