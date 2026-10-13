import { base44 } from "@industrializacao/api/base44Client";

/**
 * Carrega o que o diálogo de etiqueta da Industrialização precisa para
 * imprimir um container vinculado a uma linha de saída (`ind_vasilhame`):
 * o container e as produções/receitas usadas para peso, fabricação e validade.
 * Mesmos dados da tela de Vasilhames da Industrialização.
 *
 * @param {string} containerId
 * @returns {Promise<{ container: object, productions: object[], recipes: object[] }>}
 */
export async function loadIndContainerLabelContext(containerId) {
  if (!containerId) {
    throw new Error("Esta linha da saída não está vinculada a um vasilhame.");
  }

  const [container, productions, recipes] = await Promise.all([
    base44.entities.Container.get(containerId),
    base44.entities.Production.list("-created_date", 500).catch(() => []),
    base44.entities.Recipe.list("-updated_date", 500).catch(() => []),
  ]);

  if (!container) {
    throw new Error("Vasilhame da Industrialização não encontrado.");
  }

  return { container, productions: productions || [], recipes: recipes || [] };
}
