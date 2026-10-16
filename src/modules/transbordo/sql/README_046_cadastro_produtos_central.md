# Migration 046 — Cadastro central de produtos

## Aplicar

1. Abra o **SQL Editor** do projeto Supabase (`cpzibnwytukcgxeamfhp`) **ou** defina `DATABASE_URL` / `CHEMFLOW_DATABASE_URL` no `.env`.
2. Execute o arquivo completo:

```bash
# Opção A — script (requer URL Postgres)
node scripts/apply-cadastro-produtos-central.mjs

# Opção B — cole o conteúdo de 046_cadastro_produtos_central.sql no SQL Editor
```

3. Verifique:

```bash
node scripts/verify-cadastro-produtos-central.mjs
```

## O que a migration faz

- Renomeia `ind_lista_receitas` → `receitas`
- Renomeia `t_produtos` → `cadastro_produtos`
- Adiciona coluna `origem` (`INDUSTRIALIZACAO` | `ARMAZENAGEM` | `AMBOS`)
- Cria RPCs `cadastro_produtos_registrar_uso` e `cadastro_produtos_promover_ids`
- Reescreve funções SQL que citavam os nomes antigos
- Backfill idempotente a partir das receitas (codigo+nome)

## Auditoria pré-migration (16/10/2026)

| Métrica | Valor |
|--------|------:|
| Produtos em `t_produtos` | 179 |
| Receitas | 26 |
| Duplicatas exatas codigo+nome | 0 |
| Mesmo codigo, nomes diferentes (legítimo) | 4 |
| Itens de receita com codigo+nome | 87 |
| PA sem codigo (não inserido) | 1 (CORRTREAT 18497) |
| Matches inequívocos → `AMBOS` | 2 |
| A inserir como `INDUSTRIALIZACAO` | ~85 (inclui codigo igual/nome diferente) |

Relatório detalhado: `scripts/audit-cadastro-produtos-central-report.json`

### Não mesclados (codigo igual, nome diferente)

O backfill **insere** o item da receita como produto novo (identidade = codigo+nome). O registro do Transbordo com o mesmo codigo e outro nome permanece intacto (não vira `AMBOS`).

| Codigo | Nome na receita | Nome no Transbordo |
|--------|-----------------|--------------------|
| 1024001 | SISBRAX TZ 70 | CARTASCAVE TZ |
| 1003687 | ETANOL | ALCOOL ANIDRO |
| 5032101 | PROSOLV EB 8379 | EB 8370 |

### PA sem codigo (não entra no cadastro)

- CORRTREAT 18497 (receita id `9b8b2938-9fb7-4aa0-824f-1bd50d371b6e`) — receita permanece válida.

### Matches inequívocos → AMBOS

- 404935 / INIPOL AD 8000
- 404937 / BACTIRAM 3000
