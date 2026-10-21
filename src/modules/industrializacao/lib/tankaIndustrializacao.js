/**
 * Quais tankas aparecem na Tankagem da Industrialização.
 *
 * Entra a tanka cujo produto (cadastro ou em uso) é do catálogo
 * INDUSTRIALIZACAO/AMBOS do mesmo cliente. Se o vínculo aponta para a
 * ficha de armazenagem, mas existe receita com o mesmo nome, a tanka
 * continua (ex.: SISBRAX ACE 75). Tanka sem produto entra quando o
 * cliente tem produtos desse módulo (ex.: Clariant e Arkema).
 */
import { normProdutoKey } from '@transbordo/lib/cadastroProdutosCentral';

const IND_ORIGENS = new Set(['INDUSTRIALIZACAO', 'AMBOS']);

function isIndProduct(produto) {
  const origem = String(produto?.origem ?? '').trim().toUpperCase();
  if (!origem) return true;
  return IND_ORIGENS.has(origem);
}

function productNames(tank) {
  return [
    tank?.produto_nome,
    tank?.product,
    tank?.latest_product,
    ...(Array.isArray(tank?.computed_products) ? tank.computed_products : []),
  ]
    .map((name) => normProdutoKey(name))
    .filter(Boolean);
}

/**
 * @param {object} tank
 * @param {object[]} produtos Catálogo já filtrado do módulo, ou lista com `origem`.
 * @param {object[]} [recipes]
 */
export function tankaUsadaNaIndustrializacao(tank, produtos = [], recipes = []) {
  const ind = (produtos || []).filter(isIndProduct);
  const ids = new Set();
  const keys = new Set();
  const clients = new Set();

  for (const produto of ind) {
    const id = String(produto?.id || '').trim();
    if (id) ids.add(id);
    const client = normProdutoKey(produto?.cliente_nome || produto?.client || '');
    const name = normProdutoKey(produto?.produto || produto?.nome || '');
    if (client) clients.add(client);
    if (client && name) keys.add(`${client}|${name}`);
  }

  const recipeKeys = new Set();
  for (const recipe of recipes || []) {
    const client = normProdutoKey(recipe?.client || '');
    const name = normProdutoKey(recipe?.product_name || '');
    if (!name) continue;
    recipeKeys.add(`${client}|${name}`);
    recipeKeys.add(`|${name}`);
  }

  const produtoId = String(tank?.produto_id || '').trim();
  if (produtoId && ids.has(produtoId)) return true;

  const client = normProdutoKey(tank?.client || tank?.cliente_nome || '');
  const names = productNames(tank);
  const linkedToInd = !produtoId || ids.has(produtoId);

  for (const name of names) {
    if (!keys.has(`${client}|${name}`)) continue;
    if (linkedToInd) return true;
    if (recipeKeys.has(`${client}|${name}`) || recipeKeys.has(`|${name}`)) {
      return true;
    }
  }

  return names.length === 0 && Boolean(client) && clients.has(client);
}
