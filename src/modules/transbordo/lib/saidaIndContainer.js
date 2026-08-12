import {
  getContainerPackageQty,
  isUnitPackagingType,
  formatAggregatedContainerLabel,
} from "@industrializacao/lib/packagingTypes";
import { TIPO_IND_VASILHAME } from "@transbordo/lib/saidaOrigem";

function parseDensidade(value) {
  return parseFloat(String(value || "0").replace(",", ".")) || 0;
}

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

/**
 * Itens de saída (industrialização / vasilhame) vinculados a um container.
 */
export function collectIndVasilhameItemsForContainer(saidas = [], containerId) {
  if (!containerId) return [];
  const items = [];
  for (const saida of saidas || []) {
    for (const item of saida.itens || []) {
      if (item?.tipo === TIPO_IND_VASILHAME && item.container_id === containerId) {
        items.push({ saida, item });
      }
    }
  }
  return items;
}

/**
 * Monta patch para devolver o container ao pátio com volume/peso/embalagens restaurados.
 * Usa snapshot da saída (volume_disponivel) quando existir — idempotente.
 */
export function buildContainerYardRestorePatch(container, linkedItems = []) {
  if (!container) return null;

  let volTaken = 0;
  let pesoTaken = 0;
  let qtdEmbTaken = 0;
  let volumeDisponivel = null;

  for (const row of linkedItems) {
    const item = row?.item || row;
    if (!item) continue;
    volTaken += Number(item.volume_solicitado) || 0;
    pesoTaken +=
      Number(item.peso_liquido) || Number(item.quantidade_solicitada) || 0;
    qtdEmbTaken += Math.max(0, Math.round(Number(item.quantidade_embalagens) || 0));
    if (
      volumeDisponivel == null &&
      item.volume_disponivel != null &&
      Number(item.volume_disponivel) > 0
    ) {
      volumeDisponivel = Number(item.volume_disponivel);
    }
  }

  const currentVol = Number(container.volume) || 0;
  const newVol = round3(
    volumeDisponivel != null && volumeDisponivel > 0
      ? volumeDisponivel
      : currentVol + volTaken
  );

  const dens = parseDensidade(container.density);
  const currentNet = Number(container.net_weight) || 0;
  const newNet = round3(
    dens > 0 ? newVol * dens : Math.max(0, currentNet + pesoTaken)
  );
  const tare = Number(container.tare) || 0;

  const patch = {
    status: "No Pátio",
    departure_date: null,
    volume: newVol,
    net_weight: newNet,
    gross_weight: round3(tare + newNet),
  };

  if (isUnitPackagingType(container.type) && qtdEmbTaken > 0) {
    const qtdAtual = getContainerPackageQty(container);
    const qtdNova = Math.max(1, qtdAtual + qtdEmbTaken);
    patch.container_number = formatAggregatedContainerLabel(
      qtdNova,
      container.type
    );
  }

  return patch;
}
