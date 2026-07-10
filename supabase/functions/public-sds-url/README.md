# Supabase Edge Functions

## public-sds-url

Gera URL assinada para download/visualização da SDS na página pública do QR Code.

### Deploy

```bash
supabase functions deploy public-sds-url
```

Variáveis de ambiente (automáticas no Supabase):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Uso

```http
POST /functions/v1/public-sds-url
Content-Type: application/json

{ "token": "<public_token>" }
```

Resposta (200):
```json
{
  "has_sds": true,
  "signed_url": "https://...",
  "fds_filename": "FDS_Grax_LB_Rev03.pdf"
}
```

Resposta (404): `{ "has_sds": false }`

### Pré-requisitos

Execute no SQL Editor do Supabase (nesta ordem):

1. `src/sql/migration_recipe_fds.sql` — colunas FDS, bucket e RPCs base
2. `src/sql/migration_public_sds_legacy.sql` — fallback FDS para produções legadas (estoque antigo)
3. `src/sql/migration_public_sds_anon_sign.sql` — permite fallback de assinatura sem edge function
4. `src/sql/migration_public_traceability.sql` — `public_token` e backfill (se ainda não executada)

Depois do SQL, faça o deploy da edge function:

```bash
supabase login
supabase link --project-ref cpzibnwytukcgxeamfhp
supabase functions deploy public-sds-url
```
