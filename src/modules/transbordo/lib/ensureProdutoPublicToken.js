import { generatePublicToken } from '@industrializacao/lib/publicToken';
import { entities } from '@transbordo/services/entities';

export const CONSULTA_PRODUTO_PATH = '/consulta-produto';

function normKey(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Garante que o produto tenha public_token para o QR da etiqueta convencional.
 * Gera e persiste sob demanda para cadastros anteriores à migration.
 */
export async function ensureProdutoPublicToken(produto) {
  if (!produto?.id) return null;
  if (produto.public_token) return produto.public_token;

  const token = generatePublicToken();
  await entities.produtos.update(produto.id, { public_token: token });
  return token;
}

/**
 * Localiza o produto cadastrado (id → código+nome) e devolve o token público.
 */
export async function resolveProdutoPublicToken({ produtoId, codigo, nome } = {}) {
  let produto = null;

  if (produtoId) {
    produto = await entities.produtos.get(produtoId).catch(() => null);
  }

  if (!produto && codigo) {
    const matches = await entities.produtos.filter({ codigo }).catch(() => []);
    const nomeNorm = normKey(nome);
    produto = nomeNorm
      ? (matches || []).find((p) => normKey(p.produto) === nomeNorm) || matches?.[0]
      : matches?.[0];
  }

  return ensureProdutoPublicToken(produto);
}
