# Load tests ChemCtrl — Onda 1

Pré-requisitos:
- k6 instalado (https://k6.io)
- Anon key e, para RPCs autenticadas, um `x-session-id` válido
- Para T7: um `STOCK_ID` de estoque de **teste** com saldo > 0

## Comandos

```bash
# T1 + T2 + T6 + T7 (cenários do script)
k6 run ^
  -e SUPABASE_URL=https://cpzibnwytukcgxeamfhp.supabase.co ^
  -e SUPABASE_ANON_KEY=YOUR_ANON_KEY ^
  -e SESSION_ID=YOUR_SESSION ^
  -e STOCK_ID=YOUR_TEST_STOCK_UUID ^
  scripts/load-test-chemctrl.mjs
```

## Critérios de aprovação

| Teste | Critério |
|-------|----------|
| T1 (5 VUs) | p95 < 500ms, erro < 0,1% |
| T2 (15 VUs) | p95 < 800ms, zero 429, zero 5xx |
| T6 (alloc OP) | `duplicate_op_codes == 0` |
| T7 (mesmo stock) | sem lost update silencioso — segunda baixa falha ou aplica atomicamente |

## Pós-teste manual

1. Abrir Produções em 2 browsers → criar OP ao mesmo tempo → códigos distintos
2. Abrir Estoque MP → 2 movimentações no mesmo registro → saldo coerente
3. Alternar aba 10× com Produções aberta → não deve disparar avalanche de SELECTs (DevTools Network)
