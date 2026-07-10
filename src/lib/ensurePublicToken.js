import { base44 } from '@/api/base44Client';
import { generatePublicToken } from '@/lib/publicToken';

/**
 * Ensures a production has a public_token for QR traceability labels.
 * Generates and persists one on demand for legacy productions.
 */
export async function ensureProductionPublicToken(production) {
  if (!production) return null;
  if (production.public_token) return production.public_token;

  const token = generatePublicToken();
  await base44.entities.Production.update(production.id, { public_token: token });
  return token;
}
