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
const normalizeMatchKey = (name) => normalizedProductName(name).toLowerCase();

/** Todas as revisões de um produto, ordenadas da mais antiga para a mais recente. */
export const getRevisionsForProduct = (recipes, productName) => {
  const name = normalizedProductName(productName);
  if (!name) return [];
  return (recipes || [])
    .filter((r) => normalizedProductName(r.product_name) === name)
    .sort((a, b) => getRevisionNumber(a) - getRevisionNumber(b));
};

const pickValidityDays = (recipe) => {
  if (recipe == null || recipe.validity_days == null || recipe.validity_days === '') return null;
  const n = Number(recipe.validity_days);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Resolve a receita de um vasilhame/produção.
 * Usado em tanques manuais (sem OP) e no PDF "Enviar Dados".
 * Match de produto/cliente é case-insensitive; prioriza receita com código preenchido.
 */
export const resolveRecipeForContainer = (recipes, container, production = null) => {
  if (production?.recipe_id != null && production.recipe_id !== '') {
    const recipeId = String(production.recipe_id);
    const byId = (recipes || []).find((r) => String(r.id) === recipeId);
    if (byId) return byId;
  }

  const productName = container?.product || production?.product;
  if (!productName) return null;

  const productKey = normalizeMatchKey(productName);
  const clientKey = normalizeMatchKey(container?.client || production?.client);
  const revisions = (recipes || [])
    .filter((r) => normalizeMatchKey(r.product_name) === productKey)
    .sort((a, b) => getRevisionNumber(a) - getRevisionNumber(b));
  if (!revisions.length) return null;

  const byClient = clientKey
    ? revisions.filter((r) => normalizeMatchKey(r.client) === clientKey)
    : [];
  const pool = byClient.length ? byClient : revisions;

  const withCode = [...pool].reverse().find((r) => String(r.code || '').trim());
  return withCode || pool[pool.length - 1];
};

/**
 * Dias de validade do produto para etiqueta/COA/PDF.
 * Usa a receita da OP quando tiver validity_days; senão varre revisões do produto
 * (mesma lógica de cliente da resolução principal) para não imprimir Fab = Val.
 */
export const resolveValidityDays = (recipes, container, production = null) => {
  const primary = resolveRecipeForContainer(recipes, container, production);
  const fromPrimary = pickValidityDays(primary);
  if (fromPrimary != null) return fromPrimary;

  const productName = container?.product || production?.product || primary?.product_name;
  const productKey = normalizeMatchKey(productName);
  if (!productKey) return null;

  const clientKey = normalizeMatchKey(container?.client || production?.client || primary?.client);
  const revisions = (recipes || [])
    .filter((r) => normalizeMatchKey(r.product_name) === productKey)
    .sort((a, b) => getRevisionNumber(b) - getRevisionNumber(a));

  const byClient = clientKey
    ? revisions.filter((r) => normalizeMatchKey(r.client) === clientKey)
    : [];
  const pools = [byClient, revisions];

  for (const pool of pools) {
    for (const recipe of pool) {
      const days = pickValidityDays(recipe);
      if (days != null) return days;
    }
  }

  return null;
};

/** Código do produto cadastrado na receita (string vazia se não houver). */
export const resolveProductCode = (recipes, container, production = null, recipe = null) => {
  const resolved = recipe?.code != null && String(recipe.code).trim()
    ? recipe
    : resolveRecipeForContainer(recipes, container, production);
  return String(resolved?.code || '').trim();
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
