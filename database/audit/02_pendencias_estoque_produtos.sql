-- Pendências pós-066 — somente leitura (espelha audit REST)
-- Executar no SQL Editor ou: node scripts/audit-estoque-produtos-pg.mjs (com DATABASE_URL)

-- FK órfãos
SELECT 'produto_id' AS fk, count(*) AS orphans
FROM estoque_produtos e
WHERE e.produto_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cadastro_produtos p WHERE p.id = e.produto_id)
UNION ALL
SELECT 'cliente_id', count(*)
FROM estoque_produtos e
WHERE e.cliente_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM t_clientes c WHERE c.id = e.cliente_id)
UNION ALL
SELECT 'vasilhame_id', count(*)
FROM estoque_produtos e
WHERE e.vasilhame_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM t_vasilhames v WHERE v.id = e.vasilhame_id);

-- Divergência initial_stock x quantidade (ARMAZENAGEM)
SELECT id, id_entrada, produto_codigo, initial_stock, quantidade, saldo_atual, created_at, updated_at
FROM estoque_produtos
WHERE origem = 'ARMAZENAGEM'
  AND initial_stock IS DISTINCT FROM quantidade;

-- Densidade não numérica
SELECT id, origem, produto_codigo, densidade
FROM estoque_produtos
WHERE densidade IS NOT NULL AND btrim(densidade::text) <> ''
  AND densidade::text !~ '^-?[0-9]+([.][0-9]+)?$'
ORDER BY id;

-- Legacy entrada: código antigo vs id_entrada unificado
SELECT id, id_entrada, legacy_entrada_codigo,
       legacy_entrada_codigo = id_entrada AS same_as_id_entrada
FROM estoque_produtos
WHERE legacy_entrada_codigo IS NOT NULL AND btrim(legacy_entrada_codigo) <> ''
ORDER BY id
LIMIT 50;

-- Legacy MP entry id (estoque_mp.entry_id histórico)
SELECT id, id_entrada, legacy_mp_entry_id,
       legacy_mp_entry_id = id_entrada AS same_as_id_entrada
FROM estoque_produtos
WHERE legacy_mp_entry_id IS NOT NULL AND btrim(legacy_mp_entry_id) <> ''
ORDER BY id
LIMIT 50;

-- Políticas RLS atuais
SELECT polname, polcmd,
       pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check
FROM pg_policy
WHERE polrelid = 'public.estoque_produtos'::regclass;
