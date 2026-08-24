# Checklist de Validação — Novo Banco ChemCtrl v2

## Pré-execução

- [ ] Inventário live executado no banco atual (`../audit/00_inventario_somente_leitura.sql`)
- [ ] Auditoria de órfãos executada (`../audit/00_auditoria_orfaos.sql`)
- [ ] Novo projeto Supabase criado (vazio)
- [ ] Banco atual intacto (nenhum DROP/ALTER)

## Após executar 01 → 10

### Estrutura

- [ ] Extensão `pgcrypto` disponível
- [ ] Função `fn_set_updated_at` existe
- [ ] Sequences: `estoque_codigo_seq`, `transbordo_validacoes_numero_seq`, `validacoes_mp_numero_seq`
- [ ] Tabela `modulos` com 3 linhas (painel, transbordo, industrializacao)
- [ ] Tabela `usuarios` com PK uuid
- [ ] Tabela `perfis` com IDs semânticos (`perfil_administrador`, …)
- [ ] Tabela `clientes` (sem prefixo `t_`)
- [ ] Tabela `produtos` (sem prefixo `t_`)
- [ ] Tabela `saidas` com CHECK `modulo_origem` incluindo `chemflow`
- [ ] Tabela `producoes` com FKs `recipe_id` → `receitas`, `order_id` → `pedidos`
- [ ] Tabela `cq_resultados.production_id` → `producoes` **ON DELETE RESTRICT**
- [ ] Tabela `checklist_producao.production_id` → `producoes` **ON DELETE RESTRICT**
- [ ] Tabela `movimentos_mp.stock_id` → `estoque_mp` **ON DELETE RESTRICT**
- [ ] Tabela `composicao_vasilhame_producao.container_id` → `vasilhames_producao` **ON DELETE CASCADE**
- [ ] `t_composicao_cargas` **NÃO** existe
- [ ] Timestamps `created_at` / `updated_at` (não `created_date`)

### Contagem de tabelas esperada

```sql
SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public';
-- Esperado ≈ 46 (10 auth + 1 modulos + 3 shared + 12 TB + 3 cross + 17 IND)
```

### Índices críticos

- [ ] `uq_etiqueta_configs_ctx_tipo_cliente`
- [ ] `uq_agendamentos_saida_ativa` (parcial WHERE status = 'agendado')
- [ ] `uq_receitas_product_revision`
- [ ] `uq_ensaios_analysis_name`
- [ ] `uq_estoque_codigo_estoque`
- [ ] `idx_producoes_recipe_id`, `idx_producoes_order_id`
- [ ] `idx_cq_resultados_production_id`
- [ ] `idx_movimentos_mp_stock_id`

### RLS

- [ ] `sessions` / `usuario_permissoes` / `rate_limit_*` com policy bloqueante
- [ ] `permissoes` SELECT liberado, escrita bloqueada
- [ ] Tabelas de domínio com `anon_all_*` USING true (Fase A)

### RPCs

- [ ] `SELECT login_user('x','y');` retorna JSON (erro de credencial, não erro de função)
- [ ] `validate_session`, `destroy_session`, `update_user_language` existem
- [ ] `list_profiles`, `get_user_permissions`, `replace_user_permissions` existem
- [ ] `get_public_produto_info`, `get_public_lot_info`, `submit_operational_checklist` existem

### Realtime

```sql
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY 1;
```

- [ ] Contém as 20 tabelas listadas em `08_realtime.sql`
- [ ] Não contém tabelas sem consumidor (ex.: `descontaminacoes`)

### Smoke tests

- [ ] INSERT em `clientes` com uuid OK
- [ ] INSERT em `receitas` + `producoes` com `recipe_id` FK OK
- [ ] DELETE de `producoes` com `cq_resultados` vinculado **FALHA** (RESTRICT)
- [ ] UPDATE em qualquer tabela atualiza `updated_at` via trigger
- [ ] INSERT em `estoque` atribui `codigo_estoque` automaticamente
- [ ] Seed: `SELECT COUNT(*) FROM permissoes;` > 50
- [ ] Seed: `SELECT COUNT(*) FROM operadores;` >= 6

## Após migração de dados (etapa futura)

- [ ] Contagens ANTES × DEPOIS idênticas por tabela
- [ ] Zero órfãos nas FKs novas
- [ ] Login real com usuário migrado
- [ ] Fluxos Painel / Transbordo / Industrialização / cross-module

## Ponto de virada

- [ ] Só alterar `VITE_*_SUPABASE_URL` / anon key após todos os itens acima OK
