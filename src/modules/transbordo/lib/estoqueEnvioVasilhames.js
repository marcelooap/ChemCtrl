import {
  containerDensity,
  containerDisplayVolume,
  isContainerFractional,
  productionOfContainer,
} from "@industrializacao/lib/fractionalSupply";
import { isUnidadeVolumeEntrada } from "@transbordo/lib/estoqueSaldo";
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

/** Nomes de tanka no mestre (cadastro_tanka) para não listar o mesmo volume duas vezes. */
export function collectTankIdentityNames({
  tankas = [],
  indTanks = [],
  isotanques = [],
} = {}) {
  const names = new Set();
  const add = (value) => {
    const key = normName(value);
    if (key) names.add(key);
  };
  const master = tankas?.length ? tankas : isotanques;
  for (const row of master || []) {
    add(row?.nome);
    add(row?.tanka);
    add(row?.name);
    add(row?.codigo_itku);
  }
  for (const tank of indTanks || []) {
    add(tank?.name);
    add(tank?.nome);
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
 * Quantidade do vasilhame na UOM de entrada do produto.
 * PA industrializado costuma ter só volume (L): sem densidade, usa litros.
 */
export function resolveQuantidadeFisicaVasilhame(
  v,
  unidadePreferida = "kg",
  densidadeKgPorL = 0
) {
  const unidade = String(unidadePreferida || "kg").toLowerCase();
  const dens = densidadeKgPorL > 0 ? densidadeKgPorL : 0;
  const volL = Number(v?.volume) || 0;

  if (isUnidadeVolumeEntrada(unidade)) {
    return { quantidade: volL > 0 ? volL : 0, unidade: unidadePreferida || "L" };
  }

  const peso = Number(v?.peso_liquido) || 0;
  if (peso > 0) return { quantidade: peso, unidade: unidadePreferida || "kg" };

  const comp = Array.isArray(v?.composicao) ? v.composicao : [];
  const sumKg = comp.reduce((s, c) => s + (Number(c.quantidade_kg) || 0), 0);
  if (sumKg > 0) return { quantidade: sumKg, unidade: unidadePreferida || "kg" };

  const sumL = comp.reduce((s, c) => s + (Number(c.quantidade_l) || 0), 0);
  const litros = sumL > 0 ? sumL : volL;
  if (litros <= 0) return { quantidade: 0, unidade: unidadePreferida || "kg" };

  if (dens > 0) {
    return { quantidade: litros * dens, unidade: unidadePreferida || "kg" };
  }

  return { quantidade: litros, unidade: "L" };
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
    const densidade = containerDensity(container, productions, recipes);

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
      densidade: densidade > 0 ? densidade : "",
      capacidade: capacidade || null,
      fracionado: isContainerFractional(container, production, transfers),
      status: "No Pátio",
      composicao: [],
    });
  }

  return rows;
}
