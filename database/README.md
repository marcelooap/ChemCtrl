# ChemCtrl — Database Artifacts

## Conteúdo

| Pasta | Objetivo |
|-------|----------|
| [`audit/`](audit/) | Scripts **somente leitura** para inventário e órfãos no banco **atual** |
| [`new-schema/`](new-schema/) | DDL + RPCs + seeds do **novo** banco Supabase (vazio) |
| [`migration/`](migration/) | Scripts Node de **migração de dados** origem → destino (service role) |

## Regras

1. **Nunca** alterar o banco de produção atual com scripts de `new-schema/`.
2. Rodar `audit/` no projeto atual antes de migrar dados.
3. Criar estrutura no projeto novo com `new-schema/` na ordem do README.
4. Migrar dados com `migration/` (ver [`migration/README.md`](migration/README.md)). Template conceitual: `new-schema/11_id_mapping_template.sql`.
5. Hardening de RLS = Fase B (fora deste pacote DDL).

## Mapa rápido antigo → novo

Ver plano técnico e `new-schema/README.md`. Exemplos:

- `ind_lista_usuarios` → `usuarios`
- `t_clientes` → `clientes`
- `t_saidas` → `saidas`
- `ind_lista_producoes` → `producoes`
- `ind_estoque_mp` → `estoque_mp`
- `t_composicao_cargas` → **omitida**
