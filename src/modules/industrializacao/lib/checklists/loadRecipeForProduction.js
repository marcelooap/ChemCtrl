import { base44 } from '@industrializacao/api/base44Client';
import {
  findRevisionByAnchorId,
  groupRecipeRows,
  parseRawMaterialsField,
} from '@industrializacao/lib/recipeComposition';

/**
 * Carrega a receita vinculada à OP (para regras de checklist / banner).
 * Pós-047: resolve a linha âncora e agrupa todas as MPs da revisão.
 * @param {{ recipe_id?: string }|null|undefined} production
 * @returns {Promise<object|null>}
 */
export async function loadRecipeForProduction(production) {
  if (!production?.recipe_id) return null;
  try {
    const row = await base44.entities.Recipe.get(production.recipe_id);
    if (!row) return null;

    if (row.receita_id) {
      const lines = await base44.entities.Recipe.filter({
        receita_id: row.receita_id,
        revision_number: row.revision_number ?? 1,
      });
      const grouped = groupRecipeRows(lines?.length ? lines : [row]);
      return (
        findRevisionByAnchorId(grouped, production.recipe_id) ||
        grouped[0] ||
        null
      );
    }

    return {
      ...row,
      receita_id: row.receita_id || row.id,
      raw_materials: parseRawMaterialsField(row.raw_materials),
    };
  } catch {
    return null;
  }
}
