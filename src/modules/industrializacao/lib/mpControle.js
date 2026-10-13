import { getLatestRecipes } from '@industrializacao/lib/recipeRevisions';

/**
 * Controle de matéria prima por órgão regulamentador (Federal / Exército).
 * A informação é mantida em cada item de `recipes.raw_materials`
 * (`controlado` + `orgao_regulamentador`).
 */

const normalizeKey = (value) => String(value || '').trim().toLowerCase();

/** `raw_materials` pode vir como array ou como JSON serializado. */
export function parseRecipeRawMaterials(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Itens de MP (de todas as receitas informadas) que correspondem à MP buscada. */
function collectMatchingMps(recipes, matchesMp) {
  return recipes.flatMap((recipe) =>
    parseRecipeRawMaterials(recipe.raw_materials).filter(matchesMp),
  );
}

function toControle(mps) {
  const controlled = mps.find((mp) => mp?.controlado && mp?.orgao_regulamentador);
  return controlled
    ? { controlado: true, orgao_regulamentador: controlled.orgao_regulamentador }
    : null;
}

/**
 * Resolve se uma MP é controlada a partir das receitas (apenas a revisão
 * mais recente de cada produto). Receitas do mesmo cliente têm prioridade;
 * as demais só são consultadas quando o cliente não usa a MP em nenhuma receita.
 *
 * @returns {{ controlado: true, orgao_regulamentador: string } | null}
 */
export function resolveMpControle(recipes, { mpCode, mpName, client } = {}) {
  const code = normalizeKey(mpCode);
  const name = normalizeKey(mpName);
  if (!code && !name) return null;

  const matchesMp = (item) => {
    const itemCode = normalizeKey(item?.mp_code);
    if (code && itemCode) return itemCode === code;
    return Boolean(name) && normalizeKey(item?.mp_name) === name;
  };

  const latest = getLatestRecipes(recipes);
  const clientKey = normalizeKey(client);
  const sameClient = clientKey ? latest.filter((r) => normalizeKey(r.client) === clientKey) : [];

  const clientMps = collectMatchingMps(sameClient, matchesMp);
  if (clientMps.length > 0) return toControle(clientMps);

  return toControle(collectMatchingMps(latest, matchesMp));
}
