import {
  containerDensity,
  containerDisplayVolume,
  isContainerFractional,
  productionOfContainer,
} from "@industrializacao/lib/fractionalSupply";
import { isUnidadeVolumeEntrada } from "@transbordo/lib/estoqueSaldo";
import { parseNumero } from "@transbordo/lib/format";
import {
  getUnitPackagingCapacity,
  isUnitPackagingLike,
} from "@industrializacao/lib/packagingTypes";
import { resolveProductCode } from "@industrializacao/lib/recipeRevisions";
import {
  isContainerNoPatio,
  ORIGEM_INDUSTRIALIZACAO,
} from "@transbordo/lib/saidaOrigem";
import { isVasilhameLegadoEmbalado } from "@transbordo/lib/tiposEmbalagem";

function normName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normPlacaKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

/**
 * Capacidade em litros. Trata milhar BR ("5.000", "1.500") que o parseNumero
 * interpretaria como decimal (5 / 1.5).
 */
export function parseCapacidadeLitros(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const s = String(value).trim();
  if (!s || s === "-") return 0;
  // 5.000 | 1.500 | 12.000 → milhar BR sem casas decimais
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    const n = parseFloat(s.replace(/\./g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return parseNumero(s);
}

export function matchesCapacidadePadrao(cap, target) {
  if (cap == null) return false;
  const n = parseCapacidadeLitros(cap);
  if (n <= 0) return false;
  const tol = Math.max(5, target * 0.02);
  return Math.abs(n - target) <= tol;
}

/** Capacidade real do vasilhame: campo próprio → cadastro pela placa → inferência. */
export function resolveVasilhameCapacidade(v, placaStats) {
  const snapPadrao = (n) => {
    if (n == null || n <= 0) return null;
    for (const std of [5000, 1500]) {
      const tol = Math.max(5, std * 0.02);
      if (Math.abs(n - std) <= tol) return std;
    }
    return null;
  };

  const own = parseCapacidadeLitros(v?.capacidade);
  if (own > 0) return snapPadrao(own) || own;

  const placa = normPlacaKey(v?.placa);
  const stats = placa && placaStats ? placaStats.get(placa) : null;
  if (stats?.maxCap > 0) return snapPadrao(stats.maxCap) || stats.maxCap;

  const vol = parseCapacidadeLitros(v?.volume);
  const maxVol = Math.max(vol, stats?.maxVol || 0);
  const snapped = snapPadrao(maxVol);
  if (snapped) return snapped;

  // Frota típica: volume atual/histórico acima de ~1.500 L ⇒ tanque 5.000 L
  // (cobre tanques 5.000 parcialmente cheios sem capacidade cadastrada)
  if (maxVol > 1600) return 5000;

  return null;
}

/** Estatísticas por placa (capacidade cadastrada + maior volume histórico). */
export function buildPlacaCapacidadeStats(vasilhames = []) {
  const placaStats = new Map();
  for (const v of vasilhames || []) {
    const placa = normPlacaKey(v?.placa);
    if (!placa) continue;
    const prev = placaStats.get(placa) || { maxCap: 0, maxVol: 0 };
    prev.maxCap = Math.max(prev.maxCap, parseCapacidadeLitros(v?.capacidade));
    prev.maxVol = Math.max(prev.maxVol, parseCapacidadeLitros(v?.volume));
    placaStats.set(placa, prev);
  }
  return placaStats;
}

/**
 * Quantidade do tanque clássico na UOM de entrada pela capacidade nominal
 * (ex.: 33 × 5.000 L). Sem capacidade resolvida, cai no volume atual.
 */
export function resolveQuantidadeTanquePorCapacidade(
  v,
  {
    unidadePreferida = "kg",
    densidadeKgPorL = 0,
    placaStats = null,
  } = {}
) {
  const unidade = String(unidadePreferida || "kg").toLowerCase();
  const dens = densidadeKgPorL > 0 ? densidadeKgPorL : 0;
  const cap = resolveVasilhameCapacidade(v, placaStats);
  const litros =
    cap != null && cap > 0
      ? cap
      : parseCapacidadeLitros(v?.volume) || Number(v?.volume) || 0;

  if (!(litros > 0)) {
    return { quantidade: 0, unidade: unidadePreferida || "kg", litros: 0 };
  }

  if (isUnidadeVolumeEntrada(unidade)) {
    return {
      quantidade: litros,
      unidade: unidadePreferida || "L",
      litros,
    };
  }

  if (dens > 0) {
    return {
      quantidade: litros * dens,
      unidade: unidadePreferida || "kg",
      litros,
    };
  }

  // Sem densidade: não inventar kg a partir de litros de capacidade.
  return { quantidade: litros, unidade: "L", litros };
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
 * Bombona / tambor / IBC (Transbordo ou Industrialização).
 * Continuam na listagem de vasilhames, mas no consolidado de Estoque Envio
 * entram na coluna Embalado — mesma regra da tela de Estoque.
 */
export function isEstoqueEnvioEmbaladoUnitario(v) {
  if (!v) return false;
  const tipo = v.tipo || v.type || "";
  const placa = v.placa || v.container_number || "";
  if (isVasilhameLegadoEmbalado(tipo)) return true;
  return isUnitPackagingLike(tipo, placa);
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
