import { generatePublicToken } from '@industrializacao/lib/publicToken';
import { entities } from '@transbordo/services/entities';

export const CONSULTA_ENTRADA_PATH = '/consulta-entrada';

function isMissingTokenColumn(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('public_token') &&
    (msg.includes('column') || msg.includes('schema cache') || msg.includes('could not find') || msg.includes('pgrst204'))
  );
}

/**
 * Garante o token do QR da etiqueta de entrada.
 * Relê o registro antes de gerar, para não invalidar uma etiqueta já impressa.
 */
export async function ensureEntradaPublicToken(entrada) {
  if (!entrada?.id) return null;
  if (entrada.public_token) return entrada.public_token;

  const current = await entities.entradas.get(entrada.id).catch(() => null);
  if (current?.public_token) return current.public_token;

  const token = generatePublicToken();
  try {
    const saved = await entities.entradas.update(entrada.id, { public_token: token });
    return saved?.public_token || token;
  } catch (err) {
    if (isMissingTokenColumn(err)) {
      const friendly = new Error(
        'Não foi possível gerar o QR code. Execute a atualização do banco (token público da entrada) e tente novamente.'
      );
      friendly.cause = err;
      throw friendly;
    }
    throw err;
  }
}
