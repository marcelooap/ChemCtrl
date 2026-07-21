import { base44 } from '@/api/base44Client';

/**
 * Carrega a receita vinculada à OP (para regras de checklist / banner).
 * @param {{ recipe_id?: string }|null|undefined} production
 * @returns {Promise<object|null>}
 */
export async function loadRecipeForProduction(production) {
  if (!production?.recipe_id) return null;
  try {
    return await base44.entities.Recipe.get(production.recipe_id);
  } catch {
    return null;
  }
}
