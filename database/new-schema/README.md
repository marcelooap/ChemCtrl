# ChemCtrl v2 — Novo Schema Supabase

SQL completo para criação do **novo** banco (projeto Supabase vazio).

> **NÃO execute estes scripts no banco de produção atual.**

## Ordem de execução

No SQL Editor do **novo** projeto, execute nesta ordem:

| # | Arquivo | Conteúdo |
|---|---------|----------|
| 1 | [`01_extensions_helpers.sql`](01_extensions_helpers.sql) | Extensions, `fn_set_updated_at`, sequences |
| 2 | [`02_platform_auth.sql`](02_platform_auth.sql) | `modulos`, `usuarios`, `sessions`, `perfis`, RBAC, rate limit |
| 3 | [`03_shared_masters.sql`](03_shared_masters.sql) | `clientes`, `operadores`, `etiqueta_configs` |
| 4 | [`04_transbordo.sql`](04_transbordo.sql) | Domínio Transbordo (ex-`t_*`) |
| 5 | [`05_cross_module.sql`](05_cross_module.sql) | `saidas`, leituras, agendamentos |
| 6 | [`06_industrializacao.sql`](06_industrializacao.sql) | Domínio Industrialização + FKs novas |
| 7 | [`07_rls_policies.sql`](07_rls_policies.sql) | RLS Fase A |
| 8 | [`08_realtime.sql`](08_realtime.sql) | Publication Realtime (só tabelas usadas) |
| 9 | [`09_rpcs_core.sql`](09_rpcs_core.sql) | Auth, rate limit, públicos, checklist |
| 10 | [`09b_rbac_rpcs.sql`](09b_rbac_rpcs.sql) | RPCs de perfis/permissões |
| 11 | [`10_seeds.sql`](10_seeds.sql) | Módulos, perfis, permissões, operadores |
| — | [`11_id_mapping_template.sql`](11_id_mapping_template.sql) | Template de migração de dados (posterior) |

## Decisões estruturais (Fase A)

- Prefixos `t_` / `ind_` removidos; nomes limpos em português (domínio) ou mantidos em inglês onde o app já usa (`product`, `recipe_id`, …).
- PKs de domínio Industrialização: **uuid**.
- `perfis.id` permanece **text** semântico (`perfil_administrador`) — o frontend compara esses IDs.
- `sessions.session_id` permanece **text**.
- Snapshots históricos (`cliente_nome`, `produto_nome`, …) preservados.
- `saidas.modulo_origem` ainda aceita `'chemflow'` (compatibilidade).
- Tabela `modulos` criada; `perfil_modulos.modulo` é FK → `modulos.codigo`.
- `t_composicao_cargas` **não** incluída (zero uso no código).
- FKs novas com ON DELETE: ver plano (RESTRICT em CQ/checklist/movimentos).

## Pós-execução

1. Rodar checklist [`CHECKLIST_VALIDACAO.md`](CHECKLIST_VALIDACAO.md).
2. Rodar inventário/órfãos no banco **atual** (`../audit/`) antes de migrar dados.
3. Migrar dados usando mapas de ID (`11_id_mapping_template.sql`).
4. Só então apontar o app para o novo projeto (env vars).
5. Hardening RLS = **Fase B** (separada).

## Rollback

Enquanto o app apontar para o banco antigo, rollback = não trocar env. O novo banco pode ser destruído e recriado sem impacto na produção.
