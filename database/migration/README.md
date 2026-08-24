# Migração de Dados — ChemCtrl v2

Copia dados do Supabase **atual** (origem) para o projeto **novo** (schema v2).
O banco de origem **não é alterado**.

## Pré-requisitos

1. DDL `database/new-schema/01` … `10` já executado no projeto novo.
2. Service role keys dos dois projetos.
3. Node.js com dependências do repo (`npm install` — usa `@supabase/supabase-js`).

## Configuração

```bash
cp database/migration/.env.migration.example database/migration/.env.migration
# Edite .env.migration com MIG_SOURCE_* e MIG_TARGET_*
```

## Ordem de execução

```bash
node database/migration/00_preflight.mjs
node database/migration/01_platform.mjs
node database/migration/02_shared.mjs
node database/migration/03_transbordo_masters.mjs
node database/migration/04_transbordo_ops.mjs
node database/migration/05_cross_module.mjs
node database/migration/06_usuarios.mjs
node database/migration/07_ind_base.mjs
node database/migration/08_ind_producoes.mjs
node database/migration/09_ind_secondary.mjs
node database/migration/10_ind_final.mjs
node database/migration/11_usuario_perms.mjs
node database/migration/12_validate.mjs
```

Depois, no SQL Editor do **target**:

```text
database/migration/13_reset_sequences.sql
```

## O que cada fase faz

| Script | Ação |
|--------|------|
| `00` | Conexões + counts origem → `id_maps/preflight_counts.json` |
| `01` | `perfis`, `perfil_permissoes` |
| `02` | `t_clientes`→`clientes`, operadores, etiquetas |
| `03`–`04` | Domínio Transbordo (UUIDs preservados) |
| `05` | Saídas, leituras, validações TB, agendamentos |
| `06` | Usuários com remap text→uuid + `senha_hash` |
| `07`–`10` | Industrialização com mapas em `id_maps/*.json` |
| `11` | `usuario_permissoes` + remap de `usuario_id` em leituras |
| `12` | ANTES×DEPOIS + auditoria de órfãos |
| `13` | Reset de sequences (SQL manual) |

## Tabelas não migradas

`sessions`, `rate_limit_attempts`, `rate_limit_logs`, `perfil_auditoria`, `perfil_modulos` (seeds).

## Idempotência

- Upserts com `ON CONFLICT DO NOTHING` (ou update em `perfis`).
- Mapas `id_maps/*.json` são reutilizados em reexecuções (mesmos UUIDs novos).

## Rollback

Não troque as variáveis `VITE_*_SUPABASE_*` até a validação passar.
Enquanto o app apontar para o projeto antigo, a produção permanece intacta.

## Nomes de origem (IND)

Alinhados ao `entityTableMap`:

| Origem | Destino |
|--------|---------|
| `ind_cq_esp_tec` | `cq_especificacoes` |
| `ind_lista_equipamentoslab` | `equipamentos_lab` |
| `ind_cadastro_tanka` | `tanques_ind` |
| `ind_lista_inventario` | `inventarios_mp` |
| `ind_transbordo_ind` | `transferencias_ind` |
| `ind_retornos_perdas` | `movimentos_mp` |
| `ind_validacoes` | `validacoes_mp` |
