import {
  containerDisplayVolume,
  isContainerFractional,
  productionOfContainer,
} from "@industrializacao/lib/fractionalSupply";
import { getUnitPackagingCapacity } from "@industrializacao/lib/packagingTypes";
import { resolveProductCode } from "@industrializacao/lib/recipeRevisions";
import {
  isContainerNoPatio,
  ORIGEM_INDUSTRIALIZACAO,
} from "@transbordo/lib/saidaOrigem";

function normName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function isTankType(container) {
  return String(container?.type || "")
    .toLowerCase()
    .includes("tank");
}

/** Nomes de tanka fixa (Transbordo + Industrialização) para não listar o mesmo volume duas vezes. */
export function collectTankIdentityNames({ indTanks = [], isotanques = [] } = {}) {
  const names = new Set();
  const add = (value) => {
    const key = normName(value);
    if (key) names.add(key);
  };
  for (const tank of indTanks || []) add(tank?.name);
  for (const iso of isotanques || []) {
    add(iso?.tanka);
    add(iso?.codigo_itku);
  }
  return names;
}

/**
 * Contentor tipo Tankagem cujo número é o nome da tanka já entra no silo.
 * Placa de pátio (contentor, IBC, tambor ou tankagem avulsa) continua vasilhame.
 */
export function isIndContainerShownAsTanka(container, tankNames) {
  if (!isTankType(container)) return false;
  const plate = normName(container?.container_number);
  return Boolean(plate && tankNames?.has(plate));
}

/**
 * Vasilhames "No Pátio" da Industrialização no mesmo formato da listagem de Estoque Envio.
 */
export function mapIndContainersForEstoqueEnvio({
  containers = [],
  productions = [],
  recipes = [],
  transfers = [],
  tankNames = new Set(),
} = {}) {
  const rows = [];

  for (const container of containers || []) {
    if (!container?.id || !isContainerNoPatio(container)) continue;
    if (isIndContainerShownAsTanka(container, tankNames)) continue;

    const production = productionOfContainer(container, productions);
    const codigo = resolveProductCode(recipes, container, production);
    const capacidade = getUnitPackagingCapacity(container.type);

    rows.push({
      id: container.id,
      origem: ORIGEM_INDUSTRIALIZACAO,
      placa: container.container_number || "",
      barril: container.barril_number || "",
      tipo: container.type || "",
      produto_codigo: codigo || "",
      produto_nome: container.product || "",
      cliente_nome: String(container.client || "").trim(),
      cliente_id: null,
      lote: container.lot || "",
      volume: containerDisplayVolume(container, productions),
      capacidade: capacidade || null,
      fracionado: isContainerFractional(container, production, transfers),
      status: "No Pátio",
      composicao: [],
    });
  }

  return rows;
}
