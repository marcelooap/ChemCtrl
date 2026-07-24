/**
 * Controle de Revisões de Receitas.
 *
 * Modelo: cada revisão de uma receita é uma linha própria na tabela `recipes`,
 * identificada por (product_name, revision_number). A revisão mais recente de
 * um produto é sempre a de maior `revision_number`. Nada é sobrescrito — uma
 * nova revisão é sempre um novo registro (ver `Receitas.jsx` → `save()`).
 */

/** Formata o número da revisão no padrão exibido em toda a aplicação. */
export const formatRevisionLabel = (n) => `Revisão ${String(n || 1).padStart(2, '0')}`;

/** Número de revisão de uma receita, com fallback seguro para dados legados. */
export const getRevisionNumber = (recipe) => {
  const n = Number(recipe?.revision_number);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

const normalizedProductName = (name) => (name || '').trim();

/** Todas as revisões de um produto, ordenadas da mais antiga para a mais recente. */
export const getRevisionsForProduct = (recipes, productName) => {
  const name = normalizedProductName(productName);
  if (!name) return [];
  return (recipes || [])
    .filter((r) => normalizedProductName(r.product_name) === name)
    .sort((a, b) => getRevisionNumber(a) - getRevisionNumber(b));
};

/** Revisão ativa (mais recente) de um produto, ou null se o produto não existir. */
export const getLatestRecipeForProduct = (recipes, productName) => {
  const revisions = getRevisionsForProduct(recipes, productName);
  return revisions.length ? revisions[revisions.length - 1] : null;
};

/**
 * Uma linha por produto (sempre a revisão mais recente).
 * Usado em listagens e comboboxes de produto para evitar duplicar o mesmo
 * produto uma vez por revisão.
 */
export const getLatestRecipes = (recipes) => {
  const map = new Map();
  (recipes || []).forEach((r) => {
    const name = normalizedProductName(r.product_name);
    if (!name) return;
    const current = map.get(name);
    if (!current || getRevisionNumber(r) > getRevisionNumber(current)) {
      map.set(name, r);
    }
  });
  return Array.from(map.values());
};

/** Próximo número de revisão a ser usado ao criar uma nova revisão do produto. */
export const nextRevisionNumber = (recipes, productName) => {
  const revisions = getRevisionsForProduct(recipes, productName);
  if (!revisions.length) return 1;
  return Math.max(...revisions.map(getRevisionNumber)) + 1;
};

/**
 * Uma revisão só pode ser excluída se não for a Revisão 01 e se o produto
 * possuir mais de uma revisão cadastrada.
 */
export const canDeleteRevision = (recipe, recipes) => {
  if (!recipe) return false;
  if (getRevisionNumber(recipe) <= 1) return false;
  return getRevisionsForProduct(recipes, recipe.product_name).length > 1;
};
