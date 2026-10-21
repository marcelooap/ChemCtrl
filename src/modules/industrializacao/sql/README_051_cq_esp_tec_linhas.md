# Migration 051 — Cadastro CQ com uma linha por análise

## Status

SQL pronto em [`051_cq_esp_tec_linhas.sql`](./051_cq_esp_tec_linhas.sql).

**Não executar no Supabase sem autorização explícita.**

Aplicar o SQL e publicar o app no mesmo ciclo. A tabela `ind_cq_esp_tec` passa a se chamar `cadastro_analises`. O app agrupa as linhas de volta para a tela. Gravações novas usam a função `cadastro_analises_salvar`. Enquanto a função não existir, o Cadastro CQ continua gravando o JSON antigo na tabela que ainda estiver no ar.

## O que muda

Cada análise de um ensaio vira uma linha em `cadastro_analises`. Produto, cliente, revisão, validade e responsável repetem. Todas as análises do mesmo cadastro compartilham:

| Coluna | Papel |
|--------|--------|
| `ensaio_id` | Agrupa as linhas (como `receita_id`) |
| `registro` | Número do ID da tela (1 = EN01) |
| `codigo_en` | Texto gerado, EN01, EN02… (como `codigo_rc`) |
| `linha_ordem` | Ordem da análise dentro do ensaio |

O prefixo é **EN**, que é o ID já mostrado no Cadastro CQ. RC continua sendo o ID das receitas.

## Como aplicar

Cole o conteúdo de `051_cq_esp_tec_linhas.sql` no SQL Editor do Supabase.

## Validação pós-apply

```sql
SELECT COUNT(*) FROM _chemctrl_051_cadastro_analises_backup;   -- ensaios antes
SELECT COUNT(DISTINCT ensaio_id) FROM cadastro_analises;       -- mesmo número
SELECT COUNT(*) FROM cadastro_analises;                        -- uma linha por análise
SELECT to_regclass('public.ind_cq_esp_tec');                   -- deve ser null
SELECT status, COUNT(*) FROM _chemctrl_051_cadastro_analises_report GROUP BY 1;

SELECT codigo_en, product, analysis_name, linha_ordem
FROM cadastro_analises
ORDER BY registro, linha_ordem;
```

Nenhum `ensaio_id` pode ficar sem `codigo_en`, e análises do mesmo `codigo_en` precisam repetir o mesmo produto e a mesma validade.

## Rollback

O passo a passo está comentado no final do SQL. Restaura a partir de `_chemctrl_051_cadastro_analises_backup`.
