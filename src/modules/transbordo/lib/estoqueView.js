import {
  applyDeclaredVolumeDecimals,
} from "@transbordo/lib/declaredVolume";
import {
  computeEstoqueSaldo,
  computeEstoqueQuantidadesPorLocal,
  createEstoqueSaldoContext,
  getEstoqueQuantidade,
  getEstoqueUnidade,
  hydrateEstoqueFiscal,
} from "@transbordo/lib/estoqueSaldo";
import { isEstoqueEmbalagemUnitaria } from "@transbordo/lib/transbordoEmbalado";
import {
  entradaByIdMap,
  isMateriaPrimaIndustrializacao,
} from "@transbordo/lib/materiaPrimaIndustrializacao";

const ESTOQUE_BUILD_CHUNK = 40;

/** Cede o frame para não congelar a UI em lotes grandes. */
function yieldToPaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Monta as linhas de estoque do Transbordo a partir do workspace:
 * reaplica casas decimais declaradas, remove embalagens unitárias /
 * MP da Industrialização e calcula saldo + breakdown por local.
 *
 * @param {object} workspace
 * @param {Array} [entradas]
 * @param {{ isCurrent?: () => boolean, ajustes?: Array }} [options]
 * @returns {Promise<{ estoque: Array, transbordos: Array, saidas: Array, vasilhames: Array, volumes: object } | null>}
 */
export async function buildEstoqueView(
  workspace,
  entradas = [],
  { isCurrent, ajustes = [] } = {}
) {
  const volumes = applyDeclaredVolumeDecimals({
    estoque: workspace.estoque,
    entradas,
    transbordos: workspace.transbordos,
    vasilhames: workspace.vasilhames,
  });
  const saidas = workspace.saidas || [];
  const entradasPorId = entradaByIdMap(entradas);
  const saldoCtx = createEstoqueSaldoContext(
    volumes.transbordos,
    saidas,
    volumes.vasilhames,
    ajustes
  );

  // Saldo = quantidade − saídas de vasilhame (pátio/fiscal) − saídas embalado
  // Bombonas/tambores/IBC de OP ficam só em Vasilhames.
  // Matéria-prima da Industrialização fica só no módulo Industrialização.
  const baseRows = volumes.estoque
    .filter((e) => !isEstoqueEmbalagemUnitaria(e))
    .filter(
      (e) =>
        !isMateriaPrimaIndustrializacao(
          e,
          entradasPorId.get(String(e?.entrada_id))
        )
    );

  const estoque = [];
  for (let i = 0; i < baseRows.length; i += 1) {
    if (i > 0 && i % ESTOQUE_BUILD_CHUNK === 0) {
      await yieldToPaint();
      if (typeof isCurrent === "function" && !isCurrent()) {
        return null;
      }
    }
    const e = baseRows[i];
    const hydrated = hydrateEstoqueFiscal(e);
    const quantidade = getEstoqueQuantidade(hydrated);
    const unidade_medida = getEstoqueUnidade(hydrated);
    const itemOp = { ...hydrated, quantidade, unidade_medida };
    const saldo_final = computeEstoqueSaldo(
      itemOp,
      volumes.transbordos,
      saidas,
      volumes.vasilhames,
      saldoCtx
    );
    const locaisSaldo = computeEstoqueQuantidadesPorLocal(itemOp, {
      transbordos: volumes.transbordos,
      vasilhames: volumes.vasilhames,
      saidas,
      saldo: saldo_final,
      saldoCtx,
    });
    estoque.push({
      ...itemOp,
      saldo_inicial: quantidade,
      saldo_final,
      saldo_atual: saldo_final,
      expedido: Math.max(0, quantidade - saldo_final),
      locaisSaldo,
    });
  }

  return {
    estoque,
    transbordos: volumes.transbordos,
    saidas,
    vasilhames: volumes.vasilhames,
    volumes,
  };
}
