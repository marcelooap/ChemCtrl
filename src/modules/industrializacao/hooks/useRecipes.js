/**
 * Lista receitas já agrupadas (1 objeto virtual por revisão, com raw_materials[]).
 * Compatível com modelo legado (1 row) e pós-047 (N rows por MP).
 */
import { useMemo } from 'react';
import { base44 } from '@industrializacao/api/base44Client';
import { useRealtimeEntity } from '@industrializacao/hooks/useRealtimeEntity';
import { groupRecipeRows } from '@industrializacao/lib/recipeComposition';

export async function listRecipesGrouped(sort = '-created_date', limit = 2000) {
  const rows = await base44.entities.Recipe.list(sort, limit);
  return groupRecipeRows(rows || []);
}

export function useRecipes(sort = '-created_date', limit = 2000) {
  const { data: rows, loading, reload, error } = useRealtimeEntity(
    'Recipe',
    () => base44.entities.Recipe.list(sort, limit),
    [sort, limit],
    (row) => row
  );

  const recipes = useMemo(() => groupRecipeRows(rows || []), [rows]);

  return { data: recipes, loading, reload, error, rows };
}
