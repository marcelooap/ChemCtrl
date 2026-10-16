# Migration 047 — Receitas com uma linha por MP

## Status

SQL pronto em [`047_receitas_linhas_mp.sql`](./047_receitas_linhas_mp.sql).

**Não executar no Supabase sem autorização explícita.**

Não reaplica a 046.

## Diagnóstico pré-migration (congelado)

Ver `scripts/diag-receitas-linhas-mp-report.json`:

| Métrica | Valor |
|---------|------:|
| Revisões (`receitas`) | 26 |
| Shape `raw_materials` | 26× `json_string` |
| MPs válidas (codigo+nome) | 91 |
| Linhas esperadas após 047 | 91 |
| Produções com `recipe_id` órfão | 0 |

## Como aplicar (após autorização)

```bash
# Opção A — SQL Editor do Supabase: cole o conteúdo de 047_receitas_linhas_mp.sql

# Opção B — com DATABASE_URL no .env
node scripts/apply-receitas-linhas-mp.mjs
node scripts/verify-receitas-linhas-mp.mjs
```

## Validação pós-apply

```sql
SELECT COUNT(*) FROM receitas;                         -- ~91
SELECT COUNT(DISTINCT (receita_id, revision_number)) FROM receitas;  -- 26
SELECT status, COUNT(*) FROM _chemctrl_047_receitas_report GROUP BY 1;
SELECT COUNT(*) FROM ind_lista_producoes p
LEFT JOIN receitas r ON r.id = p.recipe_id
WHERE p.recipe_id IS NOT NULL AND r.id IS NULL;        -- 0
```

## Rollback

Restaurar a partir de `_chemctrl_047_receitas_backup` (ver comentário no final do SQL).
