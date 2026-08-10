import { base44 } from '@industrializacao/api/base44Client';
import { generatePublicToken } from '@industrializacao/lib/publicToken';

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

/**
 * Ensures a raw material stock item has a public_token for QR labels.
 * Generates and persists one on demand for legacy stock entries.
 */
export async function ensureRawMaterialStockPublicToken(stockItem) {
  if (!stockItem) return null;
  if (stockItem.public_token) return stockItem.public_token;

  const token = generatePublicToken();
  await base44.entities.RawMaterialStock.update(stockItem.id, { public_token: token });
  return token;
}
