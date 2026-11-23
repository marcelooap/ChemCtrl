import { entities } from "@transbordo/services/entities";
import { listAllAjustesManuais } from "@transbordo/lib/estoqueAjusteManual";
import { buildEstoqueView } from "@transbordo/lib/estoqueView";
import { loadTransbordoWorkspaceLists } from "@transbordo/services/transbordoWorkspace";

/**
 * Carrega o estoque operacional do Transbordo (mesmo critério da tela de Estoque)
 * para a conciliação ChemCtrl × Proteus.
 *
 * @returns {Promise<Array>}
 */
export async function fetchTransbordoStocksForConciliacao() {
  const [workspace, entradas, ajustes] = await Promise.all([
    loadTransbordoWorkspaceLists({ force: true }),
    entities.entradas.list().catch((err) => {
      console.warn("[Conciliação] Entradas Transbordo:", err);
      return [];
    }),
    listAllAjustesManuais().catch((err) => {
      console.warn("[Conciliação] Ajustes manuais Transbordo:", err);
      return [];
    }),
  ]);

  const view = await buildEstoqueView(workspace, entradas || [], {
    ajustes: ajustes || [],
  });

  return view?.estoque || [];
}
