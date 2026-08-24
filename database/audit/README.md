# Inventário Real e Integridade — ChemCtrl

## Status desta etapa

| Item | Status |
|------|--------|
| Scripts SQL somente leitura gerados | **Concluído** |
| Execução live no Supabase atual | **Pendente (manual)** — requer SQL Editor do projeto `cpzibnwytukcgxeamfhp` |
| Inventário a partir dos 98 arquivos SQL do repositório | **Concluído** (baseline) |

> **Regra:** o banco atual **não** foi e **não** deve ser alterado. Sem connection string Postgres no ambiente do agente (apenas anon key REST), as queries `information_schema` / `pg_*` precisam ser executadas no Dashboard Supabase.

## Arquivos

- [`00_inventario_somente_leitura.sql`](00_inventario_somente_leitura.sql) — inventário estrutural completo
- [`00_auditoria_orfaos.sql`](00_auditoria_orfaos.sql) — órfãos das futuras FKs + contagens ANTES

## Inventário baseline (código / migrations)

Confirmado pela leitura de `src/modules/*/sql`:

| Grupo | Qtd | Tabelas |
|-------|-----|---------|
| Platform/Auth | **10** | `ind_lista_usuarios`, `sessions`, `perfis`, `perfil_permissoes`, `perfil_auditoria`, `perfil_modulos`, `permissoes`, `usuario_permissoes`, `rate_limit_attempts`, `rate_limit_logs` |
| Transbordo ativas | **18** | `t_clientes` … `t_validacao_leituras` |
| Transbordo morta | **1** | `t_composicao_cargas` (zero `.from()` no app) |
| Industrialização domínio | **17** | `ind_lista_*` / `ind_*` (exceto usuários) |
| **Total ativo** | **45** | |
| **Total com mortas** | **46** | |

### Estrutura crítica confirmada

- `sessions.session_id text PRIMARY KEY` (não uuid)
- `t_*` PKs: `uuid`
- `ind_*` domínio PKs: `text` (`gen_random_uuid()::text`)
- `t_produtos.cliente_id` → `t_clientes(id) ON DELETE SET NULL` (opcional)
- `perfil_modulos.modulo` CHECK: `industrializacao | transbordo` (sem `painel`)
- `t_validacao_leituras.validacao_id text` (polimórfico, sem FK)

## Procedimento obrigatório antes da carga de dados

1. Rodar `00_inventario_somente_leitura.sql` no banco atual e salvar o resultado.
2. Rodar `00_auditoria_orfaos.sql` e classificar cada query:
   - **0 linhas** → OK
   - **>0 com futura SET NULL** → migrar FK como NULL
   - **>0 com futura RESTRICT/CASCADE** → corrigir dados antes de migrar (nunca descartar silenciosamente)
3. Guardar a tabela de `COUNT(*)` como baseline ANTES × DEPOIS.
4. Só então executar a carga de dados no **novo** projeto Supabase (etapa posterior ao DDL).

## Próximo artefato

DDL completo do novo banco em [`../new-schema/`](../new-schema/).
