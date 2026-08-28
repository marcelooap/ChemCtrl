# Migrações de Concorrência / Estabilidade — ChemCtrl

Ordem de aplicação no **SQL Editor do Supabase** (não pular etapas):

## Onda 1 (bloqueante)

1. `src/modules/industrializacao/sql/migration_concurrency_wave1_unique_indexes.sql`
2. `src/modules/industrializacao/sql/migration_concurrency_wave1_sequences.sql`
3. `src/modules/industrializacao/sql/migration_concurrency_wave1_stock_rpc.sql`
4. `src/modules/industrializacao/sql/migration_concurrency_wave1_persist_transbordo.sql`
5. `src/modules/industrializacao/sql/migration_concurrency_wave1_rbac_authz.sql`

## Onda 2

6. `migration_concurrency_wave2_indexes.sql`
7. `migration_concurrency_wave2_optimistic_lock.sql`
8. `migration_concurrency_wave2_jwt_scaffold.sql`

## Onda 4

9. `migration_concurrency_wave4_dashboard_kpis.sql`

## Não executar

- `migration_realtime_replica_identity.sql` — **obsoleto** (tabelas legadas). Use `database/new-schema/08_realtime.sql`.

## Após aplicar

```bash
# Load test (ver scripts/LOAD_TEST_README.md)
k6 run -e SUPABASE_ANON_KEY=... -e SESSION_ID=... scripts/load-test-chemctrl.mjs
```

Deploy do frontend após as migrations da Onda 1.
