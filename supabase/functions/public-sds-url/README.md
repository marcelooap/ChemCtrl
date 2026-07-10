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

Execute a migration `src/sql/migration_recipe_fds.sql` no SQL Editor do Supabase antes de usar.
