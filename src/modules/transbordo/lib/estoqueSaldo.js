import {
  roundMass,
  parseDensidade,
  roundVolume,
  roundQuantidade,
  litrosFromMassaKg,
} from "@transbordo/lib/format";
import {
  loteToKg,
  loteToLitros,
  loteUnidadeEstoque,
  saldoKgToLitros,
} from "@transbordo/lib/conversao";
import {
  calculateFIFOAllocation,
  expandOrigensForFifo,
} from "@transbordo/lib/fifo";
import { entities } from "@transbordo/services/entities";
import { computeTankaLotesDisponiveis } from "@transbordo/lib/tankaVolume";
import { isSaidaValidadaNoModulo, ORIGEM_TRANSBORDO } from "@transbordo/lib/saidaOrigem";
import {
  estoqueIdsFromSaidaItem,
  quantidadeItemParaEstoque,
} from "@painel/lib/saidaEmbaladoLotes";
import { resolveTipoRecebimentoEstoque } from "@transbordo/lib/tipoRecebimento";
import { isVasilhameLegadoEmbalado } from "@transbordo/lib/tiposEmbalagem";
import {
  EMPTY_PLACA_KEY,
  getTransbordoIndex,
  getVasilhameIndex,
  placaBarrilKey,
} from "@transbordo/lib/transbordoIndexes";

/**
 * Quantidade original do registro de estoque (unidade operacional).
 * Entrada em L/gal → litros; demais → kg.
 */
export function getEstoqueQuantidade(estoqueItem) {
  const lote = estoqueItem?.lotes?.[0];
  const embalado = Boolean(estoqueItem?.embalado || lote?.embalado);

  if (isUnidadeVolumeEntrada(getEstoqueUnidadeEntrada(estoqueItem))) {
    const declaredL = loteToLitros(lote);
    const umOp = normalizeUnidadeEntrada(estoqueItem?.unidade_medida);
    const qtd = Number(estoqueItem?.saldo_inicial ?? estoqueItem?.quantidade) || 0;

    // Já migrado / persistido em litros. Se a coluna foi inteira, recupera
    // a fração ainda presente no lote da entrada (ex.: 19.849 → 19.848,5).
    if (umOp === "l" && qtd > 0) return quantidadeComDecimalDoLote(lote, qtd);
    // Persistido em galões → litros operacionais
    if (umOp === "gal" && qtd > 0) {
      const litros = roundQuantidade(qtd * 3.78541);
      const declaredGal = roundQuantidade(lote?.quantidade);
      const galTemFracao = Math.abs(declaredGal - Math.trunc(declaredGal)) > 1e-9;
      if (
        galTemFracao &&
        Math.abs(Math.round(declaredGal) - Math.round(qtd)) < 0.001
      ) {
        return roundQuantidade(declaredGal * 3.78541);
      }
      return litros;
    }
    // Legado (kg) ou embalado em L: volume declarado da entrada
    if (declaredL > 0) return declaredL;
    if (embalado && qtd > 0) return quantidadeComDecimalDoLote(lote, qtd);
  }

  const qtd = Number(estoqueItem?.saldo_inicial ?? estoqueItem?.quantidade) || 0;
  if (qtd > 0) return quantidadeComDecimalDoLote(lote, qtd);

  if (lote) {
    const fromLote = loteToKg({
      ...lote,
      embalado: lote.embalado ?? estoqueItem.embalado,
    });
    if (fromLote > 0) return fromLote;
  }
  return 0;
}

/** NF original — coluna ou lote embutido. */
export function getEstoqueNotaFiscal(estoqueItem) {
  const fromCol = estoqueItem?.nota_fiscal;
  if (fromCol != null && String(fromCol).trim() !== "") return String(fromCol);
  const fromLote = estoqueItem?.lotes?.[0]?.nota_fiscal;
  if (fromLote != null && String(fromLote).trim() !== "") return String(fromLote);
  return "";
}

/** Troca fiscal — coluna ou lote embutido (JSONB). */
export function getEstoqueNotaFiscalTroca(estoqueItem) {
  const fromCol = estoqueItem?.nota_fiscal_troca;
  if (fromCol != null && String(fromCol).trim() !== "") return String(fromCol);
  const fromLote = estoqueItem?.lotes?.[0]?.nota_fiscal_troca;
  if (fromLote != null && String(fromLote).trim() !== "") return String(fromLote);
  return "";
}

/** Hidrata campos fiscais a partir do lote quando a coluna vier vazia. */
export function hydrateEstoqueFiscal(estoqueItem) {
  if (!estoqueItem) return estoqueItem;
  return {
    ...estoqueItem,
    nota_fiscal: getEstoqueNotaFiscal(estoqueItem) || estoqueItem.nota_fiscal || null,
    nota_fiscal_troca:
      getEstoqueNotaFiscalTroca(estoqueItem) || estoqueItem.nota_fiscal_troca || null,
  };
}

/** Unidade a exibir/persistir, com correção para lotes embalados e entrada em volume. */
export function getEstoqueUnidade(estoqueItem) {
  const lote = estoqueItem?.lotes?.[0];
  if (estoqueItem?.embalado || lote?.embalado) {
    return loteUnidadeEstoque({
      ...lote,
      embalado: true,
      unidade_medida: lote?.unidade_medida || estoqueItem?.unidade_medida,
    });
  }
  if (isUnidadeVolumeEntrada(getEstoqueUnidadeEntrada(estoqueItem))) {
    return "L";
  }
  return estoqueItem?.unidade_medida || "kg";
}

/**
 * Unidade de medida informada na entrada do produto (lote).
 * Diferente da unidade operacional do saldo (geralmente kg no convencional).
 */
export function getEstoqueUnidadeEntrada(estoqueItem) {
  const fromLote = estoqueItem?.lotes?.[0]?.unidade_medida;
  if (fromLote != null && String(fromLote).trim() !== "") {
    return String(fromLote).trim();
  }
  return estoqueItem?.unidade_medida || "kg";
}

/** Normaliza unidade de entrada para comparação (l/lt/litros → l, etc.). */
export function normalizeUnidadeEntrada(unidade) {
  const u = String(unidade || "kg").trim().toLowerCase();
  if (u === "l" || u === "lt" || u === "litro" || u === "litros") return "l";
  if (u === "gal" || u === "gallon" || u === "gallons" || u === "galão" || u === "galoes" || u === "galões") {
    return "gal";
  }
  if (u === "lb" || u === "lbs" || u === "libra" || u === "libras") return "lb";
  if (u === "kg" || u === "kgs" || u === "quilo" || u === "quilos") return "kg";
  return u || "kg";
}

export function isUnidadeVolumeEntrada(unidade) {
  const u = normalizeUnidadeEntrada(unidade);
  return u === "l" || u === "gal";
}

export function isUnidadeMassaEntrada(unidade) {
  const u = normalizeUnidadeEntrada(unidade);
  return u === "kg" || u === "lb";
}

/** Estoque embalado: quantidade operacional segue a UOM da entrada (sem densidade). */
export function isEstoqueEmbalado(estoqueItem) {
  const tipo =
    estoqueItem?.tipo_recebimento || estoqueItem?.lotes?.[0]?.tipo_recebimento;
  return Boolean(
    estoqueItem?.embalado ||
      estoqueItem?.lotes?.[0]?.embalado ||
      tipo === "embalado"
  );
}

/** Embalado lançado em kg/lb: o campo `volume` do OP guarda a massa, não o litro. */
export function isEstoqueEmbaladoMassa(estoqueItem) {
  return (
    isEstoqueEmbalado(estoqueItem) &&
    isUnidadeMassaEntrada(getEstoqueUnidadeEntrada(estoqueItem))
  );
}

/**
 * Densidade para converter volume de tanque → massa operacional.
 * Ordem: override → vasilhame → estoque/lote → OPs ligados ao tanque.
 */
function resolveDensidadeParaMassa(
  estoqueItem,
  { densidade, vasilhame = null, transbordos = [] } = {}
) {
  const fromOpt = parseDensidade(densidade);
  if (fromOpt > 0) return fromOpt;
  const fromVas = parseDensidade(vasilhame?.densidade);
  if (fromVas > 0) return fromVas;
  const fromEst =
    parseDensidade(estoqueItem?.densidade) ||
    parseDensidade(estoqueItem?.lotes?.[0]?.densidade);
  if (fromEst > 0) return fromEst;
  if (!vasilhame) return 0;
  for (const t of findTransbordosForVasilhame(vasilhame, transbordos)) {
    const densT = parseDensidade(t?.densidade);
    if (densT > 0) return densT;
  }
  return 0;
}

/**
 * Fatia FIFO na unidade operacional do estoque.
 * Embalado em massa: `volume` já é kg/lb. Granel em massa: `volume` é litro
 * e `pesoLiq` é a massa (volume × densidade não pode voltar para a coluna).
 * Sem densidade, não promove litro a kg.
 */
export function quantidadeFifoOperacional(row, estoqueItem) {
  const vol = Number(row?.volume) || 0;
  const peso = Number(row?.pesoLiq) || 0;
  if (estoqueOperaEmLitros(estoqueItem)) return vol;
  if (isEstoqueEmbaladoMassa(estoqueItem)) return vol > 0 ? vol : peso;
  if (peso > 0) return peso;
  const dens = parseDensidade(
    row?.densidade ||
      estoqueItem?.densidade ||
      estoqueItem?.lotes?.[0]?.densidade
  );
  return dens > 0 && vol > 0 ? roundMass(vol * dens) : 0;
}

/**
 * Volume (L) e peso líquido para a tabela de destinos.
 * Embalado em kg: o número gravado em `volume` é a massa envasada;
 * o litro é derivado pela densidade. O peso gravado (volume × densidade)
 * não é o peso líquido.
 */
export function quantidadesDestinoParaExibicao(estoqueItem, row) {
  const vol = Number(row?.volume) || 0;
  const peso = Number(row?.pesoLiq) || 0;
  if (!isEstoqueEmbaladoMassa(estoqueItem)) {
    return { volumeL: vol, pesoKg: peso };
  }
  const kg = roundMass(vol > 0 ? vol : peso);
  const dens = parseDensidade(
    row?.densidade ||
      estoqueItem?.densidade ||
      estoqueItem?.lotes?.[0]?.densidade
  );
  return {
    volumeL: dens > 0 ? litrosFromMassaKg(kg, dens) : 0,
    pesoKg: kg,
  };
}

/**
 * Converte valor operacional para a unidade de medida da entrada.
 * Quando o estoque já opera em litros (entrada L/gal), não reconverte via kg.
 */
export function valorNaUnidadeEntrada(estoqueItem, valorOperacional) {
  const valor = Number(valorOperacional) || 0;
  if (valor <= 0) return 0;

  const um = normalizeUnidadeEntrada(getEstoqueUnidadeEntrada(estoqueItem));

  // Embalado ou operacional já em litros: valor já está na unidade de volume/entrada
  if (
    estoqueItem?.embalado ||
    estoqueItem?.lotes?.[0]?.embalado ||
    estoqueOperaEmLitros(estoqueItem)
  ) {
    if (um === "gal") {
      // Operacional interno em L → exibir galões
      const umOp = normalizeUnidadeEntrada(estoqueItem?.unidade_medida);
      if (umOp === "l" || estoqueOperaEmLitros(estoqueItem)) {
        return roundQuantidade(valor / 3.78541);
      }
    }
    return roundQuantidade(valor);
  }

  const dens =
    parseFloat(
      String(
        estoqueItem?.densidade ||
          estoqueItem?.lotes?.[0]?.densidade ||
          "0"
      ).replace(",", ".")
    ) || 0;

  switch (um) {
    case "l":
      return saldoKgToLitros(valor, dens, {
        ...estoqueItem,
        quantidade: getEstoqueQuantidade(estoqueItem),
      });
    case "gal": {
      const litros = saldoKgToLitros(valor, dens, {
        ...estoqueItem,
        quantidade: getEstoqueQuantidade(estoqueItem),
      });
      return roundQuantidade(litros / 3.78541);
    }
    case "lb":
      return Math.round(valor / 0.453592);
    case "kg":
    default:
      return roundQuantidade(valor);
  }
}

/** Quantidade inicial na unidade de medida da entrada. */
export function getEstoqueQuantidadeEntrada(estoqueItem) {
  return valorNaUnidadeEntrada(estoqueItem, getEstoqueQuantidade(estoqueItem));
}

/**
 * Saldo atual na unidade de medida da entrada.
 * Com entrada em L/gal o saldo operacional já está em litros.
 */
export function getEstoqueSaldoEntrada(estoqueItem) {
  return valorNaUnidadeEntrada(
    estoqueItem,
    Number(estoqueItem?.saldo_final ?? estoqueItem?.saldo_atual) || 0
  );
}

/**
 * Saldo já expedido na unidade de medida da entrada.
 * Calculado como inicial − atual na mesma unidade (evita round-trip assimétrico).
 */
export function getEstoqueExpedidoEntrada(estoqueItem) {
  const inicial = getEstoqueQuantidadeEntrada(estoqueItem);
  const atual = getEstoqueSaldoEntrada(estoqueItem);
  return Math.max(0, roundQuantidade(inicial - atual));
}

/**
 * Massa/volume já retirado via transbordo para um registro de estoque.
 * Em transbordos, `origem.entrada_id` aponta para `estoque.id`.
 * Usado só para disponibilidade de novo transbordo — não para saldo na tela.
 */
export function calcTransbordado(
  estoqueItem,
  transbordos,
  { excludeTransbordoId } = {}
) {
  const id = estoqueItem?.id;
  if (!id) return 0;
  const skipId = String(excludeTransbordoId || "").trim();

  return (transbordos || []).reduce((sum, t) => {
    if (skipId && String(t.id) === skipId) return sum;
    const dens =
      parseFloat(String(t.densidade || "0").replace(",", ".")) || 0;
    const matches = (t.origens || []).filter((o) =>
      origemMatchesEstoque(o, estoqueItem)
    );
    if (matches.length === 0) return sum;

    // Embalado e entrada em L/gal: volume_retirado já está na UOM da entrada
    if (estoqueOperaEmLitros(estoqueItem) || isEstoqueEmbalado(estoqueItem)) {
      return (
        sum + matches.reduce((s, o) => s + (Number(o.volume_retirado) || 0), 0)
      );
    }

    return (
      sum +
      matches.reduce((s, o) => {
        const vol = Number(o.volume_retirado) || 0;
        const stored = Number(o.massa_retirada) || 0;
        // Volume operacional × dens é a fonte de verdade; evita herdar
        // massa inteira legada (ex.: 16193 vs 16193,35 da entrada).
        const fromVol = dens > 0 && vol > 0 ? roundMass(vol * dens) : 0;
        return s + (fromVol > 0 ? fromVol : stored);
      }, 0)
    );
  }, 0);
}

/** Origem de OP vinculada a este registro de estoque (id do estoque). */
function idsEqual(a, b) {
  if (a == null || b == null || a === "" || b === "") return false;
  return String(a) === String(b);
}

function origemMatchesEstoque(origem, estoqueItem) {
  if (!estoqueItem?.id || !origem) return false;
  const estoqueId = estoqueItem.id;
  if (origem.estoque_id && idsEqual(origem.estoque_id, estoqueId)) return true;
  // Em transbordos, `origem.entrada_id` aponta para `estoque.id`
  // (exceto origem tanka: aí entrada_id é o isotanque — ver abaixo).
  if (
    (origem.tipo_origem || "") !== "tanka" &&
    origem.entrada_id &&
    idsEqual(origem.entrada_id, estoqueId)
  ) {
    return true;
  }
  return false;
}

/**
 * Ids gravados em composicao.estoque_id / entrada_id.
 * Em OPs com origem tanka, o FIFO costumava lastrear o id do isotanque
 * (não o id do estoque) — esses stamps não bloqueiam o saldo do lote.
 */
function collectComposicaoEstoqueStamps(composicao) {
  const stamps = new Set();
  for (const c of composicao || []) {
    if (c?.estoque_id != null && String(c.estoque_id).trim() !== "") {
      stamps.add(String(c.estoque_id));
    }
    if (c?.entrada_id != null && String(c.entrada_id).trim() !== "") {
      stamps.add(String(c.entrada_id));
    }
  }
  return stamps;
}

/**
 * True quando todos os stamps da composição são ids de tanka/isotanque
 * das OPs que geraram o tanque — não ids de registro de estoque.
 */
function compositionStampsAreOnlyTankaIds(vasilhame, transbordos = []) {
  const composicao = Array.isArray(vasilhame?.composicao)
    ? vasilhame.composicao
    : [];
  const stamps = collectComposicaoEstoqueStamps(composicao);
  if (stamps.size === 0) return false;

  const opCodes = new Set(
    composicao
      .map((c) => String(c?.transbordo_codigo || "").trim())
      .filter(Boolean)
  );
  const tankaIds = new Set();
  for (const t of transbordos || []) {
    const code = String(t?.codigo_transbordo || "").trim();
    const related =
      (vasilhame?.transbordo_id && t.id === vasilhame.transbordo_id) ||
      (code && opCodes.has(code));
    if (!related) continue;
    for (const o of t.origens || []) {
      if ((o?.tipo_origem || "") !== "tanka") continue;
      if (o.entrada_id != null && String(o.entrada_id).trim() !== "") {
        tankaIds.add(String(o.entrada_id));
      }
    }
  }
  if (tankaIds.size === 0) return false;
  for (const s of stamps) {
    if (!tankaIds.has(s)) return false;
  }
  return true;
}

/**
 * Id de estoque lastreável na origem do OP.
 * Origem tanka usa entrada_id = isotanque — nunca promover a estoque_id.
 */
export function resolveEstoqueIdFromOrigemTransbordo(origem) {
  if (!origem) return null;
  if (origem.estoque_id != null && String(origem.estoque_id).trim() !== "") {
    return origem.estoque_id;
  }
  if ((origem.tipo_origem || "") === "tanka") return null;
  if (origem.entrada_id != null && String(origem.entrada_id).trim() !== "") {
    return origem.entrada_id;
  }
  return null;
}

function addInListOrder(target, candidates, order) {
  if (candidates.size === 0) return;
  const sorted =
    candidates.size === 1
      ? [...candidates]
      : [...candidates].sort((a, b) => order.get(a) - order.get(b));
  for (const t of sorted) if (!target.has(t.id)) target.set(t.id, t);
}

/**
 * Transbordos relacionados a um vasilhame (id, código OP ou placa/barril).
 * Usa índices memoizados — custo O(k) por chamada em vez de O(T).
 * Ordem preservada: vínculo direto (transbordo_id), depois casados por código
 * OP e por fim por placa/barril — cada grupo na ordem da lista original.
 */
export function findTransbordosForVasilhame(vasilhame, transbordos = []) {
  if (!vasilhame) return [];
  const index = getTransbordoIndex(transbordos);
  const byId = new Map();

  if (vasilhame.transbordo_id) {
    const t = index.byId.get(vasilhame.transbordo_id);
    if (t) byId.set(t.id, t);
  }

  const codigos = new Set(
    [
      vasilhame.numero_op,
      ...((vasilhame.composicao || []).map((c) => c.transbordo_codigo) || []),
    ].filter(Boolean)
  );
  const byCodigo = new Set();
  for (const codigo of codigos) {
    for (const t of index.byCodigo.get(codigo) || []) byCodigo.add(t);
  }
  addInListOrder(byId, byCodigo, index.order);

  const key = placaBarrilKey(vasilhame.placa, vasilhame.barril);
  if (key !== EMPTY_PLACA_KEY) {
    const byPlaca = new Set(index.byDestinoPlacaKey.get(key) || []);
    addInListOrder(byId, byPlaca, index.order);
  }

  return [...byId.values()];
}

function normCodigo(v) {
  return String(v || "")
    .trim()
    .toUpperCase();
}

/** Chaves que identificam uma embalagem de destino como possível origem futura. */
function collectEmbalagemKeysFromDestino(destino, transbordoId, vasilhames = []) {
  const keys = new Set();
  if (!destino) return keys;

  if (destino.tanka_id) keys.add(`tanka:${destino.tanka_id}`);
  const tankaCodigo = normCodigo(destino.tanka_codigo);
  if (tankaCodigo) keys.add(`tanka_codigo:${tankaCodigo}`);

  if (destino.vasilhame_existente_id) {
    keys.add(`vasilhame:${destino.vasilhame_existente_id}`);
  }

  const placa = destino.placa || destino.tanka_codigo || "";
  const barril = destino.barril || "";
  const pb = placaBarrilKey(placa, barril);
  if (pb !== "||") keys.add(`placa:${pb}`);

  if (transbordoId) {
    const doTransbordo =
      getVasilhameIndex(vasilhames).byTransbordoId.get(transbordoId) || [];
    doTransbordo.forEach((v) => {
      const vPb = placaBarrilKey(v.placa, v.barril);
      if (pb !== "||" && vPb === pb) {
        if (v.id) keys.add(`vasilhame:${v.id}`);
      } else if (
        destino.tipo_embalagem === "Tankagem" &&
        v.tipo === "Tankagem" &&
        tankaCodigo &&
        normCodigo(v.placa) === tankaCodigo
      ) {
        if (v.id) keys.add(`vasilhame:${v.id}`);
      }
    });
  }

  return keys;
}

/** Verifica se a origem de um transbordo consome alguma embalagem rastreada. */
function origemMatchesEmbalagemKeys(origem, keys, vasilhames = []) {
  if (!origem || !keys || keys.size === 0) return false;
  const tipo = origem.tipo_origem || "";

  if (tipo === "tanka") {
    if (origem.entrada_id && keys.has(`tanka:${origem.entrada_id}`)) return true;
    const codigo = normCodigo(
      origem.entrada_codigo || origem.tanka_codigo || ""
    );
    if (codigo && keys.has(`tanka_codigo:${codigo}`)) return true;
    return false;
  }

  if (tipo === "vasilhame") {
    if (origem.entrada_id && keys.has(`vasilhame:${origem.entrada_id}`)) {
      return true;
    }
    const v = getVasilhameIndex(vasilhames).byId.get(origem.entrada_id);
    if (v) {
      const pb = placaBarrilKey(v.placa, v.barril);
      if (pb !== "||" && keys.has(`placa:${pb}`)) return true;
      if (v.tipo === "Tankagem" && normCodigo(v.placa)) {
        if (keys.has(`tanka_codigo:${normCodigo(v.placa)}`)) return true;
      }
    }
    const codigo = normCodigo(origem.entrada_codigo || "");
    if (codigo) {
      // Labels do tipo "PLACA - Produto (N L)" — tenta placa no início
      const placaHint = codigo.split(/\s*[-–]\s*/)[0];
      if (placaHint && keys.has(`placa:${placaBarrilKey(placaHint, "")}`)) {
        return true;
      }
    }
    return false;
  }

  return false;
}

/** Extrai só o código da origem (ex.: "TANKA 04"), sem produto/volume. */
function stripOrigemCodigoLimpo(codigo) {
  const raw = String(codigo || "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  if (!raw) return "";
  const sep = raw.indexOf(" - ");
  if (sep > 0) return raw.slice(0, sep).trim();
  return raw;
}

function labelOrigemTransbordo(origem, vasilhames = []) {
  if (!origem) return "—";
  const tipo = origem.tipo_origem || "";
  if (tipo === "tanka") {
    if (origem.tanka_codigo) return String(origem.tanka_codigo).trim();
    return stripOrigemCodigoLimpo(origem.entrada_codigo) || "Tanka";
  }
  if (tipo === "vasilhame" && origem.entrada_id) {
    const v = getVasilhameIndex(vasilhames).byId.get(origem.entrada_id);
    if (v) {
      return [v.placa, v.barril].filter(Boolean).join(" / ") || v.codigo || "Vasilhame";
    }
  }
  if (origem.entrada_codigo) {
    return stripOrigemCodigoLimpo(origem.entrada_codigo) || origem.entrada_codigo;
  }
  return tipo || "—";
}

function labelDestinoTransbordo(destino) {
  if (!destino) return "—";
  const placaBarril = [destino.placa, destino.barril].filter(Boolean).join(" / ");
  if (placaBarril) return placaBarril;
  if (destino.tanka_codigo) return destino.tanka_codigo;
  if (destino.tipo_embalagem) {
    const qtd = Number(destino.quantidade_embalagens) || 0;
    return qtd > 0
      ? `${destino.tipo_embalagem} (${qtd})`
      : destino.tipo_embalagem;
  }
  return "—";
}

/**
 * Destinos de transbordo que receberam volume deste estoque via FIFO.
 * Não lista todos os destinos do OP — só as embalagens alocadas a esta origem,
 * com volume/peso da fração FIFO (não o volume total do destino).
 */
export function listDestinosFifoForEstoque(estoqueItem, transbordos = []) {
  const id = estoqueItem?.id;
  if (!id) return [];

  const rows = [];

  for (const t of transbordos || []) {
    const origens = t.origens || [];
    const destinos = t.destinos || [];
    const matchOrigem = (o) => origemMatchesEstoque(o, estoqueItem);
    if (!origens.some(matchOrigem)) continue;
    if (destinos.length === 0) continue;

    const dens = parseDensidade(t.densidade);
    const origensFifo = expandOrigensForFifo(origens, dens);

    const matchingOrigemIdx = new Set();
    origensFifo.forEach((o, idx) => {
      if (origemMatchesEstoque(o, estoqueItem)) matchingOrigemIdx.add(idx);
    });
    if (matchingOrigemIdx.size === 0) continue;

    const { destinoCompositions } = calculateFIFOAllocation(
      origensFifo,
      destinos,
      dens
    );

    destinos.forEach((d, idx) => {
      const fromThis = (destinoCompositions[idx] || []).filter((c) =>
        matchingOrigemIdx.has(c.origem_index)
      );
      if (fromThis.length === 0) return;

      const volume = roundVolume(
        fromThis.reduce((s, c) => s + (Number(c.quantidade_l) || 0), 0)
      );
      if (volume <= 0) return;

      let pesoLiq = roundMass(
        fromThis.reduce((s, c) => s + (Number(c.quantidade_kg) || 0), 0)
      );
      // Embalado em kg/lb: quantidade_l já é a massa. quantidade_kg do FIFO
      // pode ter sido volume × densidade (kg tratado como litro).
      if (isEstoqueEmbaladoMassa(estoqueItem)) {
        pesoLiq = roundMass(volume);
      } else if (pesoLiq <= 0 && dens > 0) {
        pesoLiq = roundMass(volume * dens);
      }

      rows.push({
        key: `${t.id}-${idx}`,
        transbordoId: t.id,
        codigo: t.codigo_transbordo || "—",
        data: t.data,
        densidade: dens || null,
        destino:
          [d.placa, d.barril].filter(Boolean).join(" / ") ||
          d.tanka_codigo ||
          (d.tipo_embalagem
            ? Number(d.quantidade_embalagens) > 0
              ? `${d.tipo_embalagem} (${d.quantidade_embalagens})`
              : d.tipo_embalagem
            : "—"),
        tipo: d.tipo_embalagem || (d.tanka_codigo ? "Tanka" : "—"),
        volume,
        pesoLiq,
        rawDestino: d,
      });
    });
  }

  return rows.sort((a, b) => {
    const da = new Date(a.data || 0).getTime();
    const db = new Date(b.data || 0).getTime();
    if (da !== db) return da - db;
    return String(a.codigo).localeCompare(String(b.codigo));
  });
}

/**
 * Histórico de re-transbordos encadeados: embalagens pelas quais
 * o produto deste estoque/lote passou após o destino inicial
 * (ex.: tanka → vasilhame).
 *
 * Importante: origem em tanka compartilhada só encadeia quando o lote
 * retirado coincide com o lote deste estoque — evita listar envases
 * de outro lote que saiu do mesmo isotanque.
 */
export function listHistoricoTransbordosEncadeados(
  estoqueItem,
  transbordos = [],
  vasilhames = []
) {
  const id = estoqueItem?.id;
  if (!id) return [];

  const trackedLotes = new Set();
  const loteEstoque = normLoteKey(estoqueItem?.lote);
  if (loteEstoque) trackedLotes.add(loteEstoque);

  // Só rastreia destinos que o FIFO atribuiu a este estoque
  const firstDestinos = listDestinosFifoForEstoque(estoqueItem, transbordos);
  const firstIds = new Set(firstDestinos.map((r) => r.transbordoId).filter(Boolean));

  const trackedKeys = new Set();
  firstDestinos.forEach((row) => {
    if (!row.rawDestino) return;
    collectEmbalagemKeysFromDestino(
      row.rawDestino,
      row.transbordoId,
      vasilhames
    ).forEach((k) => trackedKeys.add(k));
  });

  if (trackedKeys.size === 0) return [];

  const visited = new Set(firstIds);
  const rows = [];
  let grew = true;

  while (grew) {
    grew = false;
    for (const t of transbordos || []) {
      if (!t?.id || visited.has(t.id)) continue;

      const origens = t.origens || [];
      const destinos = t.destinos || [];
      if (destinos.length === 0) continue;

      const hasKeyMatch = origens.some((o) =>
        origemMatchesEmbalagemKeys(o, trackedKeys, vasilhames)
      );
      if (!hasKeyMatch) continue;

      const dens = parseDensidade(t.densidade);
      const origensFifo = expandOrigensForFifo(origens, dens);

      const matchingOrigemIdx = new Set();
      origensFifo.forEach((o, idx) => {
        if (!origemMatchesEmbalagemKeys(o, trackedKeys, vasilhames)) return;
        if (!origemCarregaLoteRastreado(o, trackedLotes)) return;
        matchingOrigemIdx.add(idx);
      });
      if (matchingOrigemIdx.size === 0) continue;

      visited.add(t.id);
      grew = true;

      const matchingOrigens = origensFifo.filter((_, idx) =>
        matchingOrigemIdx.has(idx)
      );
      const origemLabel = matchingOrigens
        .map((o) => labelOrigemTransbordo(o, vasilhames))
        .filter(Boolean)
        .join(", ");

      const { destinoCompositions } = calculateFIFOAllocation(
        origensFifo,
        destinos,
        dens
      );

      destinos.forEach((d, idx) => {
        const fromThis = (destinoCompositions[idx] || []).filter((c) =>
          matchingOrigemIdx.has(c.origem_index)
        );
        if (fromThis.length === 0) return;

        const volume = roundVolume(
          fromThis.reduce((s, c) => s + (Number(c.quantidade_l) || 0), 0)
        );
        if (volume <= 0) return;

        let pesoLiq = roundMass(
          fromThis.reduce((s, c) => s + (Number(c.quantidade_kg) || 0), 0)
        );
        if (isEstoqueEmbaladoMassa(estoqueItem)) {
          pesoLiq = roundMass(volume);
        } else if (pesoLiq <= 0 && dens > 0) {
          pesoLiq = roundMass(volume * dens);
        }

        rows.push({
          key: `${t.id}-${idx}`,
          transbordoId: t.id,
          codigo: t.codigo_transbordo || "—",
          data: t.data,
          densidade: dens || null,
          origem: origemLabel || "—",
          destino: labelDestinoTransbordo(d),
          tipo: d.tipo_embalagem || (d.tanka_codigo ? "Tanka" : "—"),
          volume,
          pesoLiq,
          rawDestino: d,
        });

        // Só continua o rastro pelas embalagens que receberam este lote
        collectEmbalagemKeysFromDestino(d, t.id, vasilhames).forEach((k) =>
          trackedKeys.add(k)
        );
      });
    }
  }

  return rows.sort((a, b) => {
    const da = new Date(a.data || 0).getTime();
    const db = new Date(b.data || 0).getTime();
    if (da !== db) return da - db;
    return String(a.codigo).localeCompare(String(b.codigo));
  });
}

function normLoteKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

/**
 * Origem em vasilhame específico: a embalagem já foi filtrada pelo FIFO.
 * Origem em tanka: só conta se o lote retirado for o do estoque visualizado.
 */
function origemCarregaLoteRastreado(origem, trackedLotes) {
  if (!origem) return false;
  const tipo = origem.tipo_origem || "";

  // Embalagem unitária já rastreada por identidade — não exige lote
  if (tipo !== "tanka") return true;

  // Sem lote no estoque: não dá para distinguir misturas na tanka
  if (!trackedLotes || trackedLotes.size === 0) return false;

  // Após expandOrigensForFifo cada fatia traz o lote específico em `lote`
  const lote = normLoteKey(origem.lote);
  if (lote) return trackedLotes.has(lote);

  const lotesRet = (origem.lotes_retirados || []).filter(
    (l) => roundVolume(l.volume_retirado || 0) > 0
  );
  if (lotesRet.length > 0) {
    return lotesRet.some((l) => trackedLotes.has(normLoteKey(l.lote)));
  }

  return false;
}

/**
 * Frações do conteúdo do vasilhame atribuídas a cada estoque de origem.
 * Retorna Map<estoqueId, weight> com soma ≈ 1.
 *
 * Prefere a composição do próprio vasilhame (FIFO por destino). Fallback:
 * origens do OP (legado). Inclui vínculo de entrada direta.
 */
export function getEstoqueWeightsForVasilhame(vasilhame, transbordos = [], estoqueItem = null) {
  const weights = new Map();
  const related = findTransbordosForVasilhame(vasilhame, transbordos);
  const composicao = Array.isArray(vasilhame?.composicao)
    ? vasilhame.composicao
    : [];

  // 0) Composição lastreada pelo id do estoque (preferencial)
  if (composicao.length > 0) {
    for (const c of composicao) {
      const estoqueKey = c.estoque_id || c.entrada_id || null;
      if (!estoqueKey) continue;
      const qtd =
        Number(c.quantidade_l) ||
        Number(c.quantidade_kg) ||
        0;
      if (qtd <= 0) continue;
      const key =
        estoqueItem && idsEqual(estoqueKey, estoqueItem.id)
          ? estoqueItem.id
          : estoqueKey;
      weights.set(key, (weights.get(key) || 0) + qtd);
    }
    const totalStamped = [...weights.values()].reduce((a, b) => a + b, 0);
    if (totalStamped > 0) {
      for (const [id, m] of weights) {
        weights.set(id, m / totalStamped);
      }
      return weights;
    }
  }

  // 1) Composição do destino: atribui só as origens que realmente alimentaram este tanque
  if (composicao.length > 0 && related.length > 0) {
    for (const t of related) {
      const origens = t.origens || [];
      for (const c of composicao) {
        let o = null;
        const idx = Number(c.origem_index);
        if (Number.isInteger(idx) && idx >= 0 && origens[idx]) {
          o = origens[idx];
        } else if ((c.lote || "").trim()) {
          const loteKey = String(c.lote).trim();
          o = origens.find((x) => String(x.lote || "").trim() === loteKey);
        }
        // Troca de lote (REP OF→OS / lote_manual): o lote exibido no tanque
        // deixa de bater com origem.lote — vincula pelo id do estoque.
        if (!o && (c.estoque_id || c.entrada_id)) {
          o = origens.find(
            (x) =>
              idsEqual(x.entrada_id, c.estoque_id) ||
              idsEqual(x.entrada_id, c.entrada_id)
          );
        }
        if (!o?.entrada_id) continue;
        const qtd =
          Number(c.quantidade_l) ||
          Number(c.quantidade_kg) ||
          0;
        if (qtd <= 0) continue;
        const key =
          estoqueItem && origemMatchesEstoque(o, estoqueItem)
            ? estoqueItem.id
            : o.entrada_id;
        weights.set(key, (weights.get(key) || 0) + qtd);
      }
    }
  }

  // 2) Fallback legado: todas as origens do OP (pode diluir multi-origem)
  if ([...weights.values()].reduce((a, b) => a + b, 0) <= 0) {
    related.forEach((t) => {
      (t.origens || []).forEach((o) => {
        if (!o.entrada_id) return;
        const dens =
          parseFloat(String(t.densidade || "0").replace(",", ".")) || 0;
        const vol = Number(o.volume_retirado) || 0;
        const massa =
          Number(o.massa_retirada) ||
          (dens > 0 ? vol * dens : 0) ||
          vol ||
          0;
        const key =
          estoqueItem && origemMatchesEstoque(o, estoqueItem)
            ? estoqueItem.id
            : o.entrada_id;
        weights.set(key, (weights.get(key) || 0) + massa);
      });
    });
  }

  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) {
    const ids = new Set();
    related.forEach((t) =>
      (t.origens || []).forEach((o) => {
        if (o.entrada_id) ids.add(o.entrada_id);
      })
    );
    if (ids.size === 0) {
      if (estoqueItem && isVasilhameFromEntradaDireta(vasilhame, estoqueItem)) {
        weights.set(estoqueItem.id, 1);
      }
      return weights;
    }
    const w = 1 / ids.size;
    ids.forEach((id) => weights.set(id, w));
    return weights;
  }

  for (const [id, m] of weights) {
    weights.set(id, m / total);
  }
  return weights;
}

/** Tanque criado na própria entrada (sem transbordo intermediário). */
export function isVasilhameFromEntradaDireta(vasilhame, estoqueItem) {
  if (!vasilhame?.id || !estoqueItem?.id) return false;

  const lote = estoqueItem.lotes?.[0];
  const composicao = Array.isArray(vasilhame.composicao)
    ? vasilhame.composicao
    : [];
  const estoqueIds = composicao.map((c) => c?.estoque_id).filter(Boolean);

  // Dois lotes da mesma entrada geram dois tanques. A composição já aponta
  // o estoque de cada um; o irmão não entra no local deste saldo.
  if (estoqueIds.length > 0) {
    return estoqueIds.some((id) => idsEqual(id, estoqueItem.id));
  }

  if (lote?.vasilhame_id && idsEqual(lote.vasilhame_id, vasilhame.id)) {
    return true;
  }

  const tipo =
    lote?.tipo_recebimento || estoqueItem.tipo_recebimento || "";
  if (tipo !== "vasilhame") return false;

  const entradaId = estoqueItem.entrada_id;
  if (
    entradaId &&
    composicao.some((c) => c?.entrada_id && idsEqual(c.entrada_id, entradaId))
  ) {
    return true;
  }

  return false;
}

/**
 * Quantidade já baixada por saídas de embalado (enviadas ao fiscal).
 * Em saídas, `item.entrada_id` aponta para `estoque.id`.
 */
export function calcSaidasEmbalado(estoqueItem, saidas) {
  const id = estoqueItem?.id;
  if (!id) return 0;

  return (saidas || []).reduce((sum, saida) => {
    if (!isSaidaValidadaNoModulo(saida, ORIGEM_TRANSBORDO)) return sum;
    return (
      sum +
      (saida.itens || []).reduce((s, item) => {
        if (item.validado === false) return s;
        if (item.tipo !== "embalado") return s;
        return s + quantidadeItemParaEstoque(item, id);
      }, 0)
    );
  }, 0);
}

/** Ids de vasilhame com saída convencional validada no fiscal. */
function buildFiscalVasilhameIds(saidas) {
  const fiscalVasilhameIds = new Set();
  (saidas || []).forEach((saida) => {
    if (!isSaidaValidadaNoModulo(saida, ORIGEM_TRANSBORDO)) return;
    (saida.itens || []).forEach((item) => {
      if (item.validado === false) return;
      if (item.tipo === "convencional" && item.vasilhame_id) {
        fiscalVasilhameIds.add(item.vasilhame_id);
      }
    });
  });
  return fiscalVasilhameIds;
}

/**
 * Peso deste estoque no vasilhame (0..1). Usado para saber se a saída fiscal
 * já cobre a baixa — após troca de lote o Map pode guardar id em outro tipo.
 */
function weightForEstoqueInVasilhame(vasilhame, transbordos, estoqueItem) {
  if (!vasilhame || !estoqueItem?.id) return 0;
  const weights = getEstoqueWeightsForVasilhame(
    vasilhame,
    transbordos,
    estoqueItem
  );
  let w = Number(weights.get(estoqueItem.id)) || 0;
  if (w > 0) return w;
  for (const [k, weight] of weights) {
    if (!idsEqual(k, estoqueItem.id)) continue;
    w = Number(weight) || 0;
    break;
  }
  return w;
}

/** Saída fiscal já debita este estoque neste tanque — não baixar de novo no pátio. */
function fiscalJaDebitaEstoque(vasilhame, transbordos, estoqueItem) {
  return weightForEstoqueInVasilhame(vasilhame, transbordos, estoqueItem) > 0;
}

function buildEmbaladoByEstoqueId(saidas) {
  const index = new Map();
  (saidas || []).forEach((saida) => {
    if (!isSaidaValidadaNoModulo(saida, ORIGEM_TRANSBORDO)) return;
    (saida.itens || []).forEach((item) => {
      if (item.validado === false) return;
      if (item.tipo !== "embalado") return;
      const ids = estoqueIdsFromSaidaItem(item);
      ids.forEach((estoqueId) => {
        const id = String(estoqueId);
        const entry = index.get(id) || { litros: 0, massa: 0 };
        const qtd = quantidadeItemParaEstoque(item, estoqueId);
        entry.litros += qtd;
        entry.massa += qtd;
        index.set(id, entry);
      });
    });
  });
  return index;
}

/**
 * Índices reutilizáveis para calcular saldo de muitos itens sem varrer saídas/vasilhames a cada linha.
 */
export function createEstoqueSaldoContext(
  transbordos = [],
  saidas = [],
  vasilhames = []
) {
  return {
    transbordos,
    saidas,
    vasilhames,
    vasilhameById: new Map((vasilhames || []).map((v) => [v.id, v])),
    fiscalVasilhameIds: buildFiscalVasilhameIds(saidas),
    embaladoByEstoqueId: buildEmbaladoByEstoqueId(saidas),
  };
}

function saidasEmbaladoFromContext(ctx, estoqueItem) {
  const id = estoqueItem?.id;
  if (!id || !ctx?.embaladoByEstoqueId) return null;
  const entry = ctx.embaladoByEstoqueId.get(String(id));
  if (!entry) return 0;
  return estoqueOperaEmLitros(estoqueItem) ? entry.litros : entry.massa;
}

export function mapEstoqueListWithSaldo(
  estoqueList,
  transbordos,
  saidas,
  vasilhames = []
) {
  const ctx = createEstoqueSaldoContext(transbordos, saidas, vasilhames);
  return (estoqueList || []).map((item) => {
    const saldo_final = computeEstoqueSaldo(item, transbordos, saidas, vasilhames, ctx);
    return {
      ...item,
      saldo_final,
      saldo_atual: saldo_final,
      expedido: Math.max(
        0,
        (Number(item?.saldo_inicial ?? item?.quantidade) || 0) - saldo_final
      ),
    };
  });
}

/**
 * Massa/volume já baixado por saídas convencionais fiscais
 * cujos vasilhames se originaram deste estoque (via transbordo ou entrada direta).
 *
 * Se o tanque ainda está No Pátio com conteúdo, a baixa fiscal não consumiu o
 * físico — não debita (evita saldo errado quando a saída fiscal existe mas o
 * vasilhame foi mantido/restaurado no pátio).
 */
export function calcSaidasConvencional(
  estoqueItem,
  saidas,
  vasilhames = [],
  transbordos = [],
  saldoCtx = null
) {
  const id = estoqueItem?.id;
  if (!id) return 0;

  const vasilhameById =
    saldoCtx?.vasilhameById ?? getVasilhameIndex(vasilhames).byId;

  return (saidas || []).reduce((sum, saida) => {
    if (!isSaidaValidadaNoModulo(saida, ORIGEM_TRANSBORDO)) return sum;
    return (
      sum +
      (saida.itens || []).reduce((s, item) => {
        if (item.validado === false) return s;
        if (item.tipo !== "convencional" || !item.vasilhame_id) return s;
        const v = vasilhameById.get(item.vasilhame_id);
        if (!v) return s;
        // Tanque ainda no pátio com volume/peso → conteúdo não saiu de fato
        const aindaNoPatio =
          (v.status || "No Pátio") === "No Pátio" &&
          (v.data_saida == null || String(v.data_saida).trim() === "") &&
          ((Number(v.volume) || 0) > 0 || (Number(v.peso_liquido) || 0) > 0);
        if (aindaNoPatio) return s;

        const w = weightForEstoqueInVasilhame(v, transbordos, estoqueItem);
        if (w <= 0) return s;
        // Baixa na unidade do estoque: L → volume_solicitado; kg → massa
        const qtd =
          estoqueOperaEmLitros(estoqueItem) || isEstoqueEmbalado(estoqueItem)
            ? Number(item.volume_solicitado) ||
              Number(item.quantidade_solicitada) ||
              0
            : Number(item.quantidade_solicitada) ||
              Number(item.peso_liquido) ||
              0;
        return s + qtd * w;
      }, 0)
    );
  }, 0);
}

/** Vasilhame marcado como expedido (saída registrada no pátio). */
export function isVasilhameExpedido(vasilhame) {
  if (!vasilhame) return false;
  if (vasilhame.status === "Expedido") return true;
  const data = vasilhame.data_saida;
  return data != null && String(data).trim() !== "";
}

/** Estoque operacional em litros (entrada/embalado em L ou gal). */
export function estoqueOperaEmLitros(estoqueItem) {
  return isUnidadeVolumeEntrada(getEstoqueUnidadeEntrada(estoqueItem));
}

/**
 * Volume (L) do conteúdo do vasilhame para baixa de estoque em litros.
 * Preferência: volume atual → composição → volume do OP.
 * Não usa peso÷densidade (gera distorção, ex.: 500 kg / 0,4 = 1.250 L).
 */
export function resolveVolumeVasilhameParaBaixa(vasilhame, transbordos = []) {
  if (!vasilhame) return 0;

  const vol = Number(vasilhame.volume) || 0;
  if (vol > 0) return vol;

  const fromComp = (vasilhame.composicao || []).reduce(
    (s, c) => s + (Number(c.quantidade_l) || 0),
    0
  );
  if (fromComp > 0) return fromComp;

  const related = findTransbordosForVasilhame(vasilhame, transbordos);
  let fromOp = 0;
  for (const t of related) {
    for (const d of t.destinos || []) {
      const sameId =
        d.vasilhame_existente_id &&
        d.vasilhame_existente_id === vasilhame.id;
      const samePlaca =
        placaBarrilKey(d.placa || d.tanka_codigo, d.barril) ===
          placaBarrilKey(vasilhame.placa, vasilhame.barril) &&
        placaBarrilKey(vasilhame.placa, vasilhame.barril) !== "||";
      if (!sameId && !samePlaca) continue;
      fromOp += Number(d.volume_total || d.volume) || 0;
    }
  }
  return fromOp > 0 ? fromOp : 0;
}

/** Localiza o vasilhame gerado/associado a um destino de OP. */
function resolveVasilhameFromDestino(destino, transbordo, vasilhames = []) {
  if (!destino) return null;
  const index = getVasilhameIndex(vasilhames);

  if (destino.vasilhame_existente_id) {
    const byId = index.byId.get(destino.vasilhame_existente_id);
    if (byId) return byId;
  }

  const key = placaBarrilKey(destino.placa || destino.tanka_codigo, destino.barril);
  if (key !== EMPTY_PLACA_KEY) {
    const byPlaca = (index.byPlacaKey.get(key) || []).find((v) => {
      if (transbordo?.id && v.transbordo_id && v.transbordo_id !== transbordo.id) {
        return false;
      }
      return true;
    });
    if (byPlaca) return byPlaca;
  }

  if (transbordo?.id) {
    return (
      (index.byTransbordoId.get(transbordo.id) || []).find(
        (v) => key === EMPTY_PLACA_KEY || placaBarrilKey(v.placa, v.barril) === key
      ) || null
    );
  }
  return null;
}

/**
 * Litros retirados deste estoque (origem do OP) vinculados ao vasilhame.
 */
export function resolveVolumeRetiradoEstoqueParaVasilhame(
  estoqueId,
  vasilhame,
  transbordos = [],
  estoqueItem = null
) {
  if (!estoqueId || !vasilhame) return 0;
  const related = findTransbordosForVasilhame(vasilhame, transbordos);
  let total = 0;
  for (const t of related) {
    for (const o of t.origens || []) {
      const match = estoqueItem
        ? origemMatchesEstoque(o, estoqueItem)
        : o.entrada_id === estoqueId;
      if (!match) continue;
      total += Number(o.volume_retirado) || 0;
    }
  }
  return total;
}

/**
 * Massa do conteúdo do vasilhame para baixa de estoque.
 * Se o volume já foi zerado (saída fiscal), usa composição ou destino do OP.
 * Se peso_liquido foi gravado igual ao volume (L copiado como kg) e há
 * densidade ≠ 1, reconverte volume × densidade.
 */
export function resolveMassaVasilhameParaBaixa(vasilhame, transbordos = []) {
  if (!vasilhame) return 0;

  let dens =
    parseFloat(String(vasilhame.densidade || "0").replace(",", ".")) || 0;
  const vol = Number(vasilhame.volume) || 0;
  const peso = Number(vasilhame.peso_liquido) || 0;

  const related = findTransbordosForVasilhame(vasilhame, transbordos);
  if (dens <= 0) {
    for (const t of related) {
      const densT =
        parseFloat(String(t.densidade || "0").replace(",", ".")) || 0;
      if (densT > 0) {
        dens = densT;
        break;
      }
    }
  }

  if (peso > 0) {
    if (
      vol > 0 &&
      dens > 0 &&
      dens < 20 &&
      Math.abs(dens - 1) > 0.02 &&
      Math.abs(peso - vol) < 0.51
    ) {
      return roundMass(vol * dens);
    }
    return peso;
  }

  // Nunca tratar litros como kg quando a densidade estiver ausente
  if (vol > 0 && dens > 0) return vol * dens;

  const fromComp = (vasilhame.composicao || []).reduce(
    (s, c) => s + (Number(c.quantidade_kg) || 0),
    0
  );
  if (fromComp > 0) return fromComp;

  const fromCompL = (vasilhame.composicao || []).reduce(
    (s, c) => s + (Number(c.quantidade_l) || 0),
    0
  );
  if (fromCompL > 0 && dens > 0) return fromCompL * dens;

  let fromOp = 0;
  for (const t of related) {
    const densT =
      parseFloat(String(t.densidade || "0").replace(",", ".")) || dens;
    for (const d of t.destinos || []) {
      const sameId =
        d.vasilhame_existente_id &&
        d.vasilhame_existente_id === vasilhame.id;
      const samePlaca =
        placaBarrilKey(d.placa || d.tanka_codigo, d.barril) ===
          placaBarrilKey(vasilhame.placa, vasilhame.barril) &&
        placaBarrilKey(vasilhame.placa, vasilhame.barril) !== "||";
      if (!sameId && !samePlaca) continue;
      const pesoDest = Number(d.peso_liquido) || 0;
      if (pesoDest > 0) {
        fromOp += pesoDest;
        continue;
      }
      const volDest = Number(d.volume_total || d.volume) || 0;
      if (volDest > 0 && densT > 0) fromOp += volDest * densT;
    }
  }
  return fromOp;
}

/**
 * Quantidade a baixar do estoque na unidade operacional do registro.
 * - Entrada em L/gal: volume do tanque/embalagem.
 * - Embalado unitário (IBC/bombona/tambor) em kg/lb: o "volume" já é a UOM.
 * - Tanque clássico / tankagem com estoque em massa: sempre kg (L × densidade).
 */
export function resolveQuantidadeVasilhameParaBaixa(
  estoqueItem,
  vasilhame,
  transbordos = []
) {
  const unitario = isVasilhameLegadoEmbalado(vasilhame?.tipo || "");
  if (estoqueOperaEmLitros(estoqueItem) || (isEstoqueEmbalado(estoqueItem) && unitario)) {
    const vol = resolveVolumeVasilhameParaBaixa(vasilhame, transbordos);
    if (vol > 0) return vol;
    // Fallback legado quando só havia massa gravada
    if (isEstoqueEmbaladoMassa(estoqueItem)) {
      return resolveMassaVasilhameParaBaixa(vasilhame, transbordos);
    }
    return vol;
  }
  return resolveMassaVasilhameParaBaixa(vasilhame, transbordos);
}

/**
 * Quantidade já baixada porque o vasilhame de origem foi expedido no pátio.
 * Em estoque com entrada em L/gal ou Embalado: percorre os OPs e soma
 * volume_retirado (já na UOM da entrada) proporcional aos destinos expedidos —
 * nunca peso÷densidade / volume×densidade.
 */
export function calcVasilhamesExpedidosPatio(
  estoqueItem,
  vasilhames = [],
  transbordos = [],
  saidas = [],
  saldoCtx = null
) {
  const id = estoqueItem?.id;
  if (!id) return 0;

  const fiscalVasilhameIds =
    saldoCtx?.fiscalVasilhameIds ?? buildFiscalVasilhameIds(saidas);

  const usaQtdOrigemOp =
    estoqueOperaEmLitros(estoqueItem) || isEstoqueEmbalado(estoqueItem);

  if (usaQtdOrigemOp) {
    let total = 0;
    const countedDirect = new Set();
    const vasilhameById = getVasilhameIndex(vasilhames).byId;

    const debitaExpedidoSeCaber = (vasId, volBruto) => {
      if (!(volBruto > 0) || countedDirect.has(vasId)) return;
      const v = vasilhameById.get(vasId);
      if (!v || !isVasilhameExpedido(v)) return;
      if (
        fiscalVasilhameIds.has(v.id) &&
        fiscalJaDebitaEstoque(v, transbordos, estoqueItem)
      ) {
        return;
      }

      // Composição lastreada por id manda: após troca de lote REP (OF→OS),
      // a fatia FIFO do OP pode apontar um tanque que já não carrega este estoque.
      // Stamps que são só id de tanka (origem isotanque) não bloqueiam.
      const composicao = Array.isArray(v.composicao) ? v.composicao : [];
      const hasStamps = collectComposicaoEstoqueStamps(composicao).size > 0;
      let qtd = volBruto;
      if (hasStamps) {
        const compOpts = composicaoOptsForVasilhame(
          estoqueItem,
          v,
          transbordos
        );
        const fromComp = composicao.reduce((s, c) => {
          if (
            !idsEqual(c.estoque_id, id) &&
            !idsEqual(c.entrada_id, id)
          ) {
            return s;
          }
          return s + quantidadeComposicaoOperacional(c, estoqueItem, compOpts);
        }, 0);
        if (fromComp > 0) {
          qtd = fromComp;
        } else if (compositionStampsAreOnlyTankaIds(v, transbordos)) {
          const loteEstoque = normLoteKey(
            estoqueItem.lote || estoqueItem.lotes?.[0]?.lote
          );
          const fromLote = loteEstoque
            ? composicao.reduce((s, c) => {
                if (normLoteKey(c.lote) !== loteEstoque) return s;
                return (
                  s + quantidadeComposicaoOperacional(c, estoqueItem, compOpts)
                );
              }, 0)
            : 0;
          if (!(fromLote > 0)) return;
          qtd = fromLote;
        } else {
          return;
        }
      }

      const tankCap = resolveQuantidadeVasilhameParaBaixa(
        estoqueItem,
        v,
        transbordos
      );
      if (tankCap > 0 && qtd > tankCap) qtd = tankCap;

      total += qtd;
      countedDirect.add(vasId);
    };

    // 1) Destinos FIFO deste estoque (mesma base da tela DESTINOS).
    // Nunca ratear origemVol por todos os destinos do OP — isso debitava
    // tanque expedido de outro lote no mesmo OP (ex.: 9.000 → 8.333,333).
    const fifoRows = listDestinosFifoForEstoque(estoqueItem, transbordos);
    const fatiasFifo = indexFatiasEstoquePorVasilhame(
      fifoRows,
      transbordos,
      vasilhames,
      estoqueItem
    );
    for (const [vasId, vol] of fatiasFifo) {
      debitaExpedidoSeCaber(vasId, vol);
    }

    // 2) Produto que passou por tanka (ou outro vasilhame) antes do envase.
    // A baixa usa o lote do transbordo, não o lote atual do tanque: um
    // lote_manual (ex.: OF-1417-26 renomeado para OS-1831-26) não pode
    // esconder o volume já expedido.
    const chainRows = listHistoricoTransbordosEncadeados(
      estoqueItem,
      transbordos,
      vasilhames
    );
    const fatias = indexFatiasEstoquePorVasilhame(
      chainRows,
      transbordos,
      vasilhames,
      estoqueItem
    );
    for (const [vasId, vol] of fatias) {
      debitaExpedidoSeCaber(vasId, vol);
    }

    // 3) Entrada direta / composição em tanque expedido ainda não coberto
    for (const v of vasilhames || []) {
      if (countedDirect.has(v.id)) continue;
      if (!isVasilhameExpedido(v)) continue;
      if (
        fiscalVasilhameIds.has(v.id) &&
        fiscalJaDebitaEstoque(v, transbordos, estoqueItem)
      ) {
        continue;
      }

      const composicao = Array.isArray(v.composicao) ? v.composicao : [];
      const compOpts = composicaoOptsForVasilhame(
        estoqueItem,
        v,
        transbordos
      );
      const fromComp = composicao.reduce((s, c) => {
        if (
          !idsEqual(c.estoque_id, id) &&
          !idsEqual(c.entrada_id, id)
        ) {
          return s;
        }
        return s + quantidadeComposicaoOperacional(c, estoqueItem, compOpts);
      }, 0);
      if (fromComp > 0) {
        debitaExpedidoSeCaber(v.id, fromComp);
        continue;
      }

      if (!isVasilhameFromEntradaDireta(v, estoqueItem)) continue;
      debitaExpedidoSeCaber(
        v.id,
        resolveQuantidadeVasilhameParaBaixa(estoqueItem, v, transbordos)
      );
    }

    return isEstoqueEmbalado(estoqueItem) &&
      isUnidadeMassaEntrada(getEstoqueUnidadeEntrada(estoqueItem))
      ? roundMass(total)
      : roundVolume(total);
  }

  return (vasilhames || []).reduce((sum, v) => {
    if (!isVasilhameExpedido(v)) return sum;
    // Massa: se a fiscal já aponta peso para este estoque, deixa o convencional.
    // Sem peso (troca de lote / vínculo perdido), ainda baixa pelo fallback OP.
    const w = weightForEstoqueInVasilhame(v, transbordos, estoqueItem);
    if (fiscalVasilhameIds.has(v.id) && w > 0) return sum;
    if (w <= 0) return sum;

    const qtd = resolveMassaVasilhameParaBaixa(v, transbordos);
    return sum + qtd * w;
  }, 0);
}

/** Estoque IDs de origem afetados por um vasilhame (OP ou entrada direta). */
export function resolveEstoqueIdsFromVasilhame(
  vasilhame,
  transbordos = [],
  estoqueList = []
) {
  if (!vasilhame) return [];
  const ids = new Set();
  const weights = getEstoqueWeightsForVasilhame(vasilhame, transbordos);
  weights.forEach((w, estoqueId) => {
    if (w > 0) ids.add(estoqueId);
  });
  (estoqueList || []).forEach((e) => {
    if (isVasilhameFromEntradaDireta(vasilhame, e)) ids.add(e.id);
  });
  return [...ids];
}

function isTipoSaidaEmbalado(tipo) {
  return String(tipo || "").trim().toLowerCase() === "embalado";
}

function sameLoteText(a, b) {
  const left = String(a || "").trim().toLowerCase();
  const right = String(b || "").trim().toLowerCase();
  return Boolean(left) && left === right;
}

function sameProdutoSaidaEstoque(item, estoqueItem) {
  if (
    item?.produto_id &&
    estoqueItem?.produto_id &&
    String(item.produto_id) === String(estoqueItem.produto_id)
  ) {
    return true;
  }
  if (
    item?.produto_codigo &&
    estoqueItem?.produto_codigo &&
    String(item.produto_codigo).trim() ===
      String(estoqueItem.produto_codigo).trim()
  ) {
    return true;
  }
  if (
    item?.produto_nome &&
    estoqueItem?.produto_nome &&
    String(item.produto_nome).trim().toLowerCase() ===
      String(estoqueItem.produto_nome).trim().toLowerCase()
  ) {
    return true;
  }
  return false;
}

/**
 * Lista entradas do histórico de saídas vinculadas a um estoque
 * (embalado direto + convencional via vasilhame/transbordo).
 */
export function listSaidasHistoricoForEstoque(
  estoqueItem,
  saidas = [],
  vasilhames = [],
  transbordos = []
) {
  const id = estoqueItem?.id;
  if (!id) return [];

  const vasilhameById = new Map((vasilhames || []).map((v) => [v.id, v]));
  const estoqueEmbalado =
    Boolean(estoqueItem?.embalado || estoqueItem?.lotes?.[0]?.embalado) ||
    resolveTipoRecebimentoEstoque(estoqueItem) === "embalado";
  const rows = [];

  (saidas || []).forEach((saida) => {
    (saida.itens || []).forEach((item, idx) => {
      let quantidade = 0;
      let unidade = "kg";
      let linked = false;
      const tipoEmbalado = isTipoSaidaEmbalado(item.tipo);

      if (tipoEmbalado) {
        const qtdEstoque = quantidadeItemParaEstoque(item, id);
        if (qtdEstoque > 0) {
          linked = true;
          quantidade = qtdEstoque;
          unidade = estoqueItem.unidade_medida || item.unidade || "kg";
        } else if (
          estoqueEmbalado &&
          sameLoteText(item.lote, estoqueItem.lote) &&
          sameProdutoSaidaEstoque(item, estoqueItem) &&
          // Fallback só quando a saída não aponta nenhum estoque físico.
          estoqueIdsFromSaidaItem({ ...item, tipo: "embalado" }).length === 0
        ) {
          linked = true;
          quantidade =
            item.quantidade_carregada != null &&
            item.quantidade_carregada !== ""
              ? Number(item.quantidade_carregada) || 0
              : Number(item.quantidade_solicitada) || 0;
          unidade = item.unidade || estoqueItem.unidade_medida || "kg";
        }
      } else if (item.tipo === "convencional" && item.vasilhame_id) {
        const v = vasilhameById.get(item.vasilhame_id);
        if (v) {
          const weights = getEstoqueWeightsForVasilhame(
            v,
            transbordos,
            estoqueItem
          );
          const w = weights.get(id) || 0;
          if (w > 0) {
            linked = true;
            const massa =
              Number(item.quantidade_solicitada) ||
              Number(item.peso_liquido) ||
              0;
            quantidade = roundMass(massa * w);
            unidade = "kg";
          }
        }
      }

      if (!linked) return;

      const vasilhameLabel = tipoEmbalado
        ? "Embalado"
        : `${item.vasilhame_placa || vasilhameById.get(item.vasilhame_id)?.placa || "—"} - ${
            item.vasilhame_barril ||
            vasilhameById.get(item.vasilhame_id)?.barril ||
            "—"
          }`;

      const vasilhameRef = item.vasilhame_id
        ? vasilhameById.get(item.vasilhame_id)
        : null;

      rows.push({
        key: `${saida.id}-${idx}`,
        codigo: saida.codigo || "—",
        data:
          saida.data_solicitacao ||
          saida.data_programada ||
          saida.created_at ||
          saida.created_date,
        tipo: tipoEmbalado ? "embalado" : item.tipo || "—",
        lote: item.lote || estoqueItem.lote || "—",
        vasilhame: vasilhameLabel,
        vasilhame_id: item.vasilhame_id || null,
        placa:
          item.vasilhame_placa ||
          vasilhameRef?.placa ||
          "",
        barril:
          item.vasilhame_barril ||
          vasilhameRef?.barril ||
          "",
        quantidade,
        unidade,
        status: isSaidaValidadaNoModulo(saida, ORIGEM_TRANSBORDO)
          ? "Validado"
          : "Pendente",
        enviadoEm: saida.enviado_fiscal_data,
        responsavel:
          saida.enviado_fiscal_usuario ||
          saida.usuario_responsavel ||
          saida.usuario_criador ||
          "—",
        enviado_ao_fiscal: isSaidaValidadaNoModulo(saida, ORIGEM_TRANSBORDO),
      });
    });
  });

  return rows.sort(
    (a, b) => new Date(b.data || 0) - new Date(a.data || 0)
  );
}

/** Estoque IDs afetados por itens convencionais de uma saída. */
export function resolveEstoqueIdsFromSaidaConvencional(
  itens = [],
  vasilhames = [],
  transbordos = [],
  estoqueList = []
) {
  const vasilhameById = new Map((vasilhames || []).map((v) => [v.id, v]));
  const ids = new Set();
  itens.forEach((item) => {
    if (item.tipo !== "convencional" || !item.vasilhame_id) return;
    const v = vasilhameById.get(item.vasilhame_id);
    if (!v) return;

    // Origens via OP
    const weights = getEstoqueWeightsForVasilhame(v, transbordos);
    weights.forEach((w, estoqueId) => {
      if (w > 0) ids.add(estoqueId);
    });

    // Entrada direta: vincula pelo vasilhame_id / composição
    (estoqueList || []).forEach((e) => {
      if (isVasilhameFromEntradaDireta(v, e)) ids.add(e.id);
    });
  });
  return [...ids];
}

/**
 * Saldo atual na tela de Estoque.
 *
 * Regras de negócio:
 * - Na entrada: saldo = quantidade recebida
 * - Transbordo (OP) NÃO reduz o saldo (movimento interno granel → vasilhame)
 * - Embalado: reduz na UOM da entrada quando o vasilhame destino é expedido
 *   ou quando há saída embalado enviada ao fiscal (sem conversão por densidade)
 * - Convencional: reduz quando o vasilhame é expedido
 *   (Registrar Saída no pátio ou saída enviada ao fiscal)
 */
export function computeEstoqueSaldo(
  estoqueItem,
  transbordos,
  saidas,
  vasilhames = [],
  saldoCtx = null
) {
  const quantidade = getEstoqueQuantidade(estoqueItem);
  const saidoEmb = saldoCtx
    ? saidasEmbaladoFromContext(saldoCtx, estoqueItem) ?? 0
    : calcSaidasEmbalado(estoqueItem, saidas);
  const saidoConv = calcSaidasConvencional(
    estoqueItem,
    saidas,
    vasilhames,
    transbordos,
    saldoCtx
  );
  const saidoPatio = calcVasilhamesExpedidosPatio(
    estoqueItem,
    vasilhames,
    transbordos,
    saidas,
    saldoCtx
  );
  return Math.max(
    0,
    estoqueOperaEmLitros(estoqueItem)
      ? roundVolume(quantidade - saidoEmb - saidoConv - saidoPatio)
      : roundQuantidade(quantidade - saidoEmb - saidoConv - saidoPatio)
  );
}

/**
 * Quanto ainda pode ser retirado em um novo transbordo (kg/L conforme unidade).
 * Independente do saldo da tela de Estoque.
 * Em edição, passe `excludeTransbordoId` para não subtrair a própria OP.
 */
export function computeDisponivelTransbordo(
  estoqueItem,
  transbordos,
  { excludeTransbordoId } = {}
) {
  const tipoRecebimento =
    estoqueItem?.lotes?.[0]?.tipo_recebimento ||
    estoqueItem?.tipo_recebimento;
  // Entrada já em tanque não é origem granel de OP
  if (tipoRecebimento === "vasilhame") return 0;
  if (estoqueItem?.embalado || estoqueItem?.lotes?.[0]?.embalado) return 0;

  const quantidade = getEstoqueQuantidade(estoqueItem);
  const transbordado = calcTransbordado(estoqueItem, transbordos, {
    excludeTransbordoId,
  });
  return Math.max(0, quantidade - transbordado);
}

/** Converte litros (ledger tanka) para a unidade operacional do estoque. */
function litrosParaQuantidadeOperacional(estoqueItem, litros, densOverride = 0) {
  const vol = roundVolume(litros);
  if (vol <= 0) return 0;
  if (estoqueOperaEmLitros(estoqueItem)) return vol;
  // Embalado em massa no ledger de tanka unitária: "volume" já é kg/lb.
  // Litros reais de tankagem clássica caem no ramo de densidade abaixo.
  const dens =
    parseDensidade(densOverride) ||
    parseDensidade(estoqueItem?.densidade) ||
    parseDensidade(estoqueItem?.lotes?.[0]?.densidade);
  if (dens > 0) return roundMass(vol * dens);
  // Sem densidade: não promover litro a kg/lb
  return 0;
}

/**
 * Quantidade de uma fatia de composição na UOM operacional do estoque.
 * - Entrada em L/gal → quantidade_l
 * - Embalado unitário em massa (`volumeIsMass`) → quantidade_l já é kg/lb
 * - Tanque/granel em massa → quantidade_kg ou L × densidade (nunca L cru)
 *
 * @param {object} [opts]
 * @param {number} [opts.densidade] Densidade do tanque/OP quando o estoque não tem.
 * @param {boolean} [opts.volumeIsMass] true = quantidade_l é massa (IBC/bombona/tambor).
 *   false = quantidade_l é litro físico (tanque clássico / tankagem).
 *   omitido + embalado massa = legado (trata qL como massa).
 */
function quantidadeComposicaoOperacional(c, estoqueItem, opts = {}) {
  if (!c) return 0;
  const qL = Number(c.quantidade_l) || 0;
  const qKg = Number(c.quantidade_kg) || 0;
  if (estoqueOperaEmLitros(estoqueItem)) return qL;

  const volumeIsMass =
    opts.volumeIsMass === true ||
    (opts.volumeIsMass == null && isEstoqueEmbaladoMassa(estoqueItem));

  if (volumeIsMass) {
    // OP embalado: quantidade_l já é a massa; quantidade_kg pode ter dens indevida
    return qL > 0 ? qL : qKg;
  }

  const dens = resolveDensidadeParaMassa(estoqueItem, {
    densidade: opts.densidade,
  });

  if (qKg > 0) {
    // Granel: quantidade_kg às vezes foi copiado do litro (dens ≠ 1).
    // Não aplicar em embalado: aí qL e qKg são ambos massa do OP.
    if (
      !isEstoqueEmbaladoMassa(estoqueItem) &&
      dens > 0 &&
      dens < 20 &&
      qL > 0 &&
      Math.abs(qKg - qL) < 0.51 &&
      Math.abs(dens - 1) > 0.02
    ) {
      return roundMass(qL * dens);
    }
    return roundMass(qKg);
  }

  // Embalado kg no tanque clássico: o OP grava a massa em quantidade_l.
  if (isEstoqueEmbaladoMassa(estoqueItem) && qL > 0) {
    return roundMass(qL);
  }

  if (qL > 0 && dens > 0) return roundMass(qL * dens);
  // Sem densidade: não promover litro a kg
  return 0;
}

/** Opções de composição conforme o tipo físico do vasilhame. */
function composicaoOptsForVasilhame(estoqueItem, vasilhame, transbordos = []) {
  const tipo = vasilhame?.tipo || "";
  const unitario = isVasilhameLegadoEmbalado(tipo);
  return {
    densidade: resolveDensidadeParaMassa(estoqueItem, {
      vasilhame,
      transbordos,
    }),
    // Só unitários embalados tratam quantidade_l como massa.
    // Tanque clássico / tankagem: litros físicos → converter.
    volumeIsMass: isEstoqueEmbaladoMassa(estoqueItem) && unitario,
  };
}

function roundOp(estoqueItem, value) {
  return estoqueOperaEmLitros(estoqueItem)
    ? roundVolume(value)
    : roundQuantidade(value);
}

/** Se a coluna foi gravada inteira, recupera a fração ainda presente no lote da entrada. */
function quantidadeComDecimalDoLote(lote, quantidadeColuna) {
  const coluna = roundQuantidade(quantidadeColuna);
  const informada = roundQuantidade(lote?.quantidade);
  if (!(informada > 0)) return coluna;
  const temFracao = Math.abs(informada - Math.trunc(informada)) > 1e-9;
  if (!temFracao) return coluna;
  if (coluna <= 0) return informada;
  if (Math.abs(Math.round(informada) - Math.round(coluna)) < 0.001) return informada;
  if (Math.abs(informada - coluna) < 1) return informada;
  return coluna;
}

/** Chaves de identificação de um vasilhame no pátio (para cruzar com FIFO/cadeia). */
function collectVasilhameKeys(vasilhame) {
  const keys = new Set();
  if (!vasilhame) return keys;
  if (vasilhame.id) keys.add(`vasilhame:${vasilhame.id}`);
  const pb = placaBarrilKey(vasilhame.placa, vasilhame.barril);
  if (pb !== "||") keys.add(`placa:${pb}`);
  if (vasilhame.tipo === "Tankagem") {
    const codigo = normCodigo(vasilhame.placa || vasilhame.tanka || "");
    if (codigo) keys.add(`tanka_codigo:${codigo}`);
    if (vasilhame.tanka_id) keys.add(`tanka:${vasilhame.tanka_id}`);
  }
  return keys;
}

/**
 * Volume deste estoque em cada vasilhame, pela fatia FIFO/cadeia.
 * Ignora o lote reescrito no cadastro do tanque.
 */
function indexFatiasEstoquePorVasilhame(
  rows,
  transbordos = [],
  vasilhames = [],
  estoqueItem = null
) {
  const map = new Map();
  const transbordoById = getTransbordoIndex(transbordos).byId;
  for (const row of rows || []) {
    const destino = row?.rawDestino;
    if (!destino || destino.tipo_embalagem === "Tankagem") continue;
    const qtd = quantidadeFifoOperacional(row, estoqueItem);
    if (qtd <= 0) continue;
    const transbordo = transbordoById.get(row.transbordoId) || {
      id: row.transbordoId,
    };
    const vasilhame = resolveVasilhameFromDestino(destino, transbordo, vasilhames);
    if (!vasilhame?.id) continue;
    map.set(vasilhame.id, (map.get(vasilhame.id) || 0) + qtd);
  }
  return map;
}

/**
 * Quantidade deste registro de estoque ainda presente em um vasilhame No Pátio.
 * Prioridade: composicao.estoque_id → fatia FIFO/cadeia → vínculo OP/produto.
 * A fatia da cadeia prevalece sobre o volume cheio do tanque quando o
 * vasilhame mistura outros lotes.
 */
function resolveQuantidadeEstoqueNoVasilhame(
  estoqueItem,
  vasilhame,
  transbordos,
  trackedKeys,
  fatiaPorVasilhame = null
) {
  if (!estoqueItem?.id || !vasilhame) return 0;

  const estoqueId = estoqueItem.id;
  const composicao = Array.isArray(vasilhame.composicao)
    ? vasilhame.composicao
    : [];

  const compOpts = composicaoOptsForVasilhame(
    estoqueItem,
    vasilhame,
    transbordos
  );
  const sumComp = (pred) =>
    composicao.reduce((s, c) => {
      if (!pred(c)) return s;
      return s + quantidadeComposicaoOperacional(c, estoqueItem, compOpts);
    }, 0);

  const capToTankPhysical = (qty, fromEstoqueId = 0) => {
    if (!(qty > 0)) return 0;
    const tankCap = resolveQuantidadeVasilhameParaBaixa(
      estoqueItem,
      vasilhame,
      transbordos
    );
    if (!(tankCap > 0) || qty <= tankCap) return roundOp(estoqueItem, qty);
    // Composição/lote_manual pode ficar acima do volume do tanque após troca
    // de lote REP (OF→OS). Rateia a fatia deste estoque pelo físico real.
    const totalComp = roundOp(estoqueItem, sumComp(() => true));
    if (totalComp > tankCap && fromEstoqueId > 0) {
      return roundOp(estoqueItem, (fromEstoqueId * tankCap) / totalComp);
    }
    return roundOp(estoqueItem, tankCap);
  };

  const estoqueStamps = collectComposicaoEstoqueStamps(composicao);
  const hasEstoqueStamps = estoqueStamps.size > 0;
  const byEstoqueId = roundOp(
    estoqueItem,
    sumComp(
      (c) =>
        idsEqual(c.estoque_id, estoqueId) || idsEqual(c.entrada_id, estoqueId)
    )
  );
  if (byEstoqueId > 0) return capToTankPhysical(byEstoqueId, byEstoqueId);

  // Stamps de outro estoque (ex.: troca REP OF→OS) bloqueiam fatia antiga.
  // Stamps que são só id de tanka (bug de lastro em origem tanka) NÃO bloqueiam:
  // o volume ainda é deste lote via cadeia FIFO entrada→tanka→tanque.
  const tankaStampsOnly =
    hasEstoqueStamps &&
    compositionStampsAreOnlyTankaIds(vasilhame, transbordos);
  if (hasEstoqueStamps && !tankaStampsOnly) return 0;

  const fatia = Number(fatiaPorVasilhame?.get(vasilhame.id)) || 0;
  if (fatia > 0) return capToTankPhysical(fatia);

  // Fallback: composição com stamp de tanka + mesmo lote deste estoque
  // (quando a cadeia FIFO não indexou a fatia, ex. placa/legado).
  if (tankaStampsOnly) {
    const loteEstoque = normLoteKey(
      estoqueItem.lote || estoqueItem.lotes?.[0]?.lote
    );
    if (loteEstoque) {
      const byLote = roundOp(
        estoqueItem,
        sumComp((c) => normLoteKey(c.lote) === loteEstoque)
      );
      if (byLote > 0) return capToTankPhysical(byLote, byLote);
    }
  }

  const vKeys = collectVasilhameKeys(vasilhame);
  const linkedByTrack = [...vKeys].some((k) => trackedKeys.has(k));
  const linkedDirect = isVasilhameFromEntradaDireta(vasilhame, estoqueItem);
  const weights = getEstoqueWeightsForVasilhame(
    vasilhame,
    transbordos,
    estoqueItem
  );
  let share = Number(weights.get(estoqueId)) || 0;
  if (share <= 0) {
    for (const [k, w] of weights) {
      if (idsEqual(k, estoqueId)) {
        share = Number(w) || 0;
        break;
      }
    }
  }

  const related = findTransbordosForVasilhame(vasilhame, transbordos);
  const linkedByOp = related.some((t) =>
    (t.origens || []).some((o) => origemMatchesEstoque(o, estoqueItem))
  );

  // Vínculo preferencial por id (composicao/OP). Lote só entra no fallback tanka.
  const linked =
    linkedByTrack || linkedDirect || share > 0 || linkedByOp;

  if (linked) {
    // O rastro só diz que o tanque participou da cadeia. Sem fatia nem
    // participação, o volume cheio inclui lotes de outros estoques.
    if (linkedByTrack && share <= 0 && !linkedDirect && !linkedByOp) return 0;

    const qtdTotal = resolveQuantidadeVasilhameParaBaixa(
      estoqueItem,
      vasilhame,
      transbordos
    );
    if (share > 0 && share < 0.999) {
      return roundOp(estoqueItem, qtdTotal * share);
    }
    return roundOp(estoqueItem, qtdTotal);
  }

  return 0;
}

/**
 * Quantidades ainda no pátio, por tipo de armazenamento, na UOM da entrada.
 * Todo vínculo é lastreado pelo id do registro de estoque (FIFO + cadeia + composicao.estoque_id).
 *
 * Embalado (`patio`) recebe:
 * - entrada registrada como embalado que ainda não foi para tanque/tanka; e
 * - destinos unitários de transbordo (bombona / tambor / IBC), que continuam
 *   na tela de Vasilhames mas contabilizam na coluna Embalado do Estoque.
 * Envase integral para um único local absorve a fração de arredondamento.
 *
 * @param {object} estoqueItem
 * @param {object} deps
 * @param {Array} [deps.transbordos]
 * @param {Array} [deps.vasilhames]
 * @param {Array} [deps.saidas]
 * @param {number} [deps.saldo] Saldo operacional já calculado para o item
 *   (evita recomputar `computeEstoqueSaldo` quando a tela já o possui).
 * @param {object} [deps.saldoCtx] Contexto de `createEstoqueSaldoContext`.
 */
export function computeEstoqueQuantidadesPorLocal(
  estoqueItem,
  { transbordos = [], vasilhames = [], saidas = [], saldo, saldoCtx = null } = {}
) {
  const empty = {
    vasilhames: 0,
    tankas: 0,
    patio: 0,
    total: 0,
    unidade: getEstoqueUnidadeEntrada(estoqueItem),
  };
  if (!estoqueItem?.id) return empty;

  const fifoRows = listDestinosFifoForEstoque(estoqueItem, transbordos);
  const chainRows = listHistoricoTransbordosEncadeados(
    estoqueItem,
    transbordos,
    vasilhames
  );
  const trackedKeys = new Set();
  for (const row of [...fifoRows, ...chainRows]) {
    if (!row?.rawDestino) continue;
    collectEmbalagemKeysFromDestino(
      row.rawDestino,
      row.transbordoId,
      vasilhames
    ).forEach((k) => trackedKeys.add(k));
  }
  const fatias = indexFatiasEstoquePorVasilhame(
    [...fifoRows, ...chainRows],
    transbordos,
    vasilhames,
    estoqueItem
  );

  let qtyVasilhamesOp = 0;
  let qtyTankasOp = 0;
  let qtyPatioOp = 0;
  const tankasContadasViaVasilhame = new Set();
  const vasilhamesContados = new Set();

  for (const v of vasilhames || []) {
    if (!v || isVasilhameExpedido(v)) continue;
    if ((v.status || "No Pátio") !== "No Pátio") continue;

    const qtd = resolveQuantidadeEstoqueNoVasilhame(
      estoqueItem,
      v,
      transbordos,
      trackedKeys,
      fatias
    );
    if (qtd <= 0) continue;

    vasilhamesContados.add(v.id);
    const tipo = v.tipo || "";
    if (tipo === "Tankagem") {
      qtyTankasOp += qtd;
      const key = `${v.tanka_id || v.id || ""}|${normCodigo(v.placa || v.tanka || "")}`;
      tankasContadasViaVasilhame.add(key);
    } else if (isVasilhameLegadoEmbalado(tipo)) {
      // Bombona / tambor / IBC: permanecem em Vasilhames, mas no Estoque
      // entram na coluna Embalado (não em Saldo Tanque).
      qtyPatioOp += qtd;
    } else {
      // Tanque clássico (tipo Vasilhame) → coluna Saldo Tanque
      qtyVasilhamesOp += qtd;
    }
  }

  // Garante fatias FIFO/cadeia cujo destino ainda não entrou pelo vínculo do vasilhame
  const transbordoById = getTransbordoIndex(transbordos).byId;
  for (const row of [...fifoRows, ...chainRows]) {
    const d = row?.rawDestino;
    if (!d || d.tipo_embalagem === "Tankagem") continue;
    const t = transbordoById.get(row.transbordoId) || {
      id: row.transbordoId,
    };
    const v = resolveVasilhameFromDestino(d, t, vasilhames);
    if (!v || vasilhamesContados.has(v.id)) continue;
    if (isVasilhameExpedido(v)) continue;
    if ((v.status || "No Pátio") !== "No Pátio") continue;

    // Mesma regra da composição: stamps de outro estoque (REP) bloqueiam a
    // fatia antiga. Stamps que são só id de tanka não bloqueiam.
    const compV = Array.isArray(v.composicao) ? v.composicao : [];
    const stamped = collectComposicaoEstoqueStamps(compV).size > 0;
    const matchesThis = compV.some(
      (c) =>
        idsEqual(c.estoque_id, estoqueItem.id) ||
        idsEqual(c.entrada_id, estoqueItem.id)
    );
    if (
      stamped &&
      !matchesThis &&
      !compositionStampsAreOnlyTankaIds(v, transbordos)
    ) {
      continue;
    }

    const qtdFifo = quantidadeFifoOperacional(row, estoqueItem);
    if (qtdFifo <= 0) continue;

    vasilhamesContados.add(v.id);
    if (isVasilhameLegadoEmbalado(d.tipo_embalagem || v.tipo || "")) {
      qtyPatioOp += qtdFifo;
    } else {
      qtyVasilhamesOp += qtdFifo;
    }
  }

  const tankaKeys = new Map();
  for (const row of [...fifoRows, ...chainRows]) {
    const d = row?.rawDestino;
    if (!d || d.tipo_embalagem !== "Tankagem") continue;
    const id = d.tanka_id || "";
    const codigo = d.tanka_codigo || d.placa || "";
    const key = `${id}|${normCodigo(codigo)}`;
    if (!tankaKeys.has(key)) {
      tankaKeys.set(key, { id, codigo, enviado: 0 });
    }
    const entry = tankaKeys.get(key);
    entry.enviado += Number(row.volume) || 0;
  }

  const loteEstoque = normLoteKey(
    estoqueItem.lote || estoqueItem.lotes?.[0]?.lote
  );
  for (const [key, { id, codigo, enviado }] of tankaKeys) {
    if (tankasContadasViaVasilhame.has(key)) continue;
    const lotes = computeTankaLotesDisponiveis({
      isotanqueId: id || null,
      tankaCodigo: codigo,
      transbordos,
    });
    let litros = 0;
    for (const l of lotes) {
      const loteL = normLoteKey(l.lote);
      if (loteEstoque && loteL && loteL !== loteEstoque) continue;
      litros += Number(l.quantidade_l) || 0;
    }
    if (enviado > 0) litros = Math.min(litros, enviado);
    qtyTankasOp += litrosParaQuantidadeOperacional(estoqueItem, litros);
  }

  const saldoOp = Number.isFinite(saldo)
    ? saldo
    : computeEstoqueSaldo(estoqueItem, transbordos, saidas, vasilhames, saldoCtx);

  // Volume do tanque em litros não pode aparecer como kg. Quando a quantidade
  // rastreada passa do saldo (ex.: 4.000 L de uma entrada de 3.320 kg), converte
  // pela densidade ou limita ao saldo — o tanque não contém mais do que a entrada.
  let densLocal =
    parseDensidade(
      estoqueItem?.densidade || estoqueItem?.lotes?.[0]?.densidade
    ) ||
    parseDensidade(fifoRows[0]?.densidade) ||
    parseDensidade(chainRows[0]?.densidade);
  if (!(densLocal > 0)) {
    for (const v of vasilhames || []) {
      if (!vasilhamesContados.has(v?.id)) continue;
      const densV = parseDensidade(v.densidade);
      if (densV > 0) {
        densLocal = densV;
        break;
      }
    }
  }

  const capQtyMassToSaldo = (qty) => {
    if (estoqueOperaEmLitros(estoqueItem) || !(qty > saldoOp + 0.5)) return qty;
    const kg = densLocal > 0 && densLocal < 20 ? roundMass(qty * densLocal) : 0;
    if (kg > 0 && kg < qty - 0.5 && kg <= saldoOp + 0.5) return kg;
    return saldoOp;
  };
  qtyVasilhamesOp = capQtyMassToSaldo(qtyVasilhamesOp);
  qtyPatioOp = capQtyMassToSaldo(qtyPatioOp);
  qtyTankasOp = capQtyMassToSaldo(qtyTankasOp);

  // Embalado = entrada embalada residual + destinos unitários (bombona/tambor/IBC).
  // Envase integral em um único local absorve a fração de arredondamento.
  const tipoRecebimento = resolveTipoRecebimentoEstoque(estoqueItem);
  const entradaEmbalado = tipoRecebimento === "embalado";
  const alocado = qtyVasilhamesOp + qtyTankasOp + qtyPatioOp;
  const diff = roundOp(estoqueItem, saldoOp - alocado);
  const diffAbs = Math.abs(diff);
  const envaseIntegral =
    alocado > 0 &&
    saldoOp > 0 &&
    (estoqueOperaEmLitros(estoqueItem) ? diffAbs <= 0.001 : diffAbs <= 1);

  if (envaseIntegral) {
    const buckets = [
      {
        qty: qtyPatioOp,
        set: (v) => {
          qtyPatioOp = v;
        },
      },
      {
        qty: qtyVasilhamesOp,
        set: (v) => {
          qtyVasilhamesOp = v;
        },
      },
      {
        qty: qtyTankasOp,
        set: (v) => {
          qtyTankasOp = v;
        },
      },
    ];
    const active = buckets.filter((b) => b.qty > 0);
    if (active.length === 1) {
      active[0].set(roundOp(estoqueItem, saldoOp));
      for (const b of buckets) {
        if (b !== active[0]) b.set(0);
      }
    } else if (active.length > 1) {
      active.sort((a, b) => b.qty - a.qty);
      const top = active[0];
      top.set(Math.max(0, roundOp(estoqueItem, top.qty + diff)));
    }
  } else if (diff > 0) {
    if (entradaEmbalado) {
      // Entrada embalada ainda sem tanque/tanka/unitário vinculado.
      qtyPatioOp += diff;
    }
    // Não reinjetar residual em Saldo Tanque. Tanques No Pátio já foram
    // somados acima (composição / entrada direta / OP). Diff positivo após
    // expedição (ex.: troca de lote REP OF→OS) era estoque fantasma — o
    // tanque expedido não pode voltar a aparecer na coluna Saldo Tanque.
  }

  qtyVasilhamesOp = roundOp(estoqueItem, qtyVasilhamesOp);
  qtyTankasOp = roundOp(estoqueItem, qtyTankasOp);
  qtyPatioOp = roundOp(estoqueItem, qtyPatioOp);

  const qtyVasilhamesEntrada = valorNaUnidadeEntrada(
    estoqueItem,
    qtyVasilhamesOp
  );
  const qtyTankasEntrada = valorNaUnidadeEntrada(estoqueItem, qtyTankasOp);
  const qtyPatioEntrada = valorNaUnidadeEntrada(estoqueItem, qtyPatioOp);

  return {
    vasilhames: qtyVasilhamesEntrada,
    tankas: qtyTankasEntrada,
    patio: qtyPatioEntrada,
    // Saldo Atual na tela = embalado + tanque + tanka (já na UOM da entrada).
    total: somaLocaisEstoque({
      patio: qtyPatioEntrada,
      vasilhames: qtyVasilhamesEntrada,
      tankas: qtyTankasEntrada,
    }),
    unidade: getEstoqueUnidadeEntrada(estoqueItem),
  };
}

/**
 * Soma das colunas físicas (embalado/pátio + tanque + tanka) na UOM da entrada.
 * É a definição de Saldo Atual na grade de Estoque.
 */
export function somaLocaisEstoque(locais) {
  if (!locais) return 0;
  return roundQuantidade(
    (Number(locais.patio) || 0) +
      (Number(locais.vasilhames) || 0) +
      (Number(locais.tankas) || 0)
  );
}

/** Indica se o vasilhame contém produto deste registro de estoque. */
export function isVasilhameLinkedToEstoque(
  vasilhame,
  estoqueItem,
  { transbordos = [], vasilhames = [] } = {}
) {
  if (!vasilhame || !estoqueItem?.id) return false;
  if ((vasilhame.tipo || "") === "Tankagem") return false;

  const fifoRows = listDestinosFifoForEstoque(estoqueItem, transbordos);
  const chainRows = listHistoricoTransbordosEncadeados(
    estoqueItem,
    transbordos,
    vasilhames
  );
  const trackedKeys = new Set();
  for (const row of [...fifoRows, ...chainRows]) {
    if (!row?.rawDestino) continue;
    collectEmbalagemKeysFromDestino(
      row.rawDestino,
      row.transbordoId,
      vasilhames
    ).forEach((k) => trackedKeys.add(k));
  }

  const fatias = indexFatiasEstoquePorVasilhame(
    [...fifoRows, ...chainRows],
    transbordos,
    vasilhames,
    estoqueItem
  );

  return (
    resolveQuantidadeEstoqueNoVasilhame(
      estoqueItem,
      vasilhame,
      transbordos,
      trackedKeys,
      fatias
    ) > 0
  );
}

/** Tankas (isotanques) que receberam produto deste registro de estoque. */
export function listTankaIdsLinkedToEstoque(
  estoqueItem,
  { transbordos = [], vasilhames = [] } = {}
) {
  const ids = new Set();
  const codigos = new Set();
  if (!estoqueItem?.id) return { ids, codigos };

  const rows = [
    ...listDestinosFifoForEstoque(estoqueItem, transbordos),
    ...listHistoricoTransbordosEncadeados(
      estoqueItem,
      transbordos,
      vasilhames
    ),
  ];
  for (const row of rows) {
    const d = row?.rawDestino;
    if (!d || d.tipo_embalagem !== "Tankagem") continue;
    if (d.tanka_id) ids.add(d.tanka_id);
    const codigo = normCodigo(d.tanka_codigo || d.placa || "");
    if (codigo) codigos.add(codigo);
  }
  return { ids, codigos };
}

/**
 * Recalcula e persiste saldo_atual dos registros de estoque informados.
 * Se `estoqueIds` for omitido/vazio, recalcula todos.
 */
export async function syncEstoqueSaldos(estoqueIds) {
  const [allEstoque, allTransbordos, allSaidas, allVasilhames] =
    await Promise.all([
      entities.estoque.list(),
      entities.transbordos.list(),
      entities.saidas.list(),
      entities.vasilhames.list(),
    ]);

  const idSet =
    estoqueIds && estoqueIds.length > 0
      ? new Set(estoqueIds.filter(Boolean))
      : null;

  const targets = idSet
    ? allEstoque.filter((e) => idSet.has(e.id))
    : allEstoque;

  const updates = [];
  const withSaldo = targets.map((item) => {
    const saldo_inicial = getEstoqueQuantidade(item);
    const unidade_medida = getEstoqueUnidade(item);
    const saldo_final = computeEstoqueSaldo(
      item,
      allTransbordos,
      allSaidas,
      allVasilhames
    );
    const patch = { id: item.id, saldo_final };
    if ((Number(item.saldo_inicial ?? item.quantidade) || 0) <= 0 && saldo_inicial > 0) {
      patch.saldo_inicial = saldo_inicial;
    }
    if (item.unidade_medida !== unidade_medida) {
      patch.unidade_medida = unidade_medida;
    }
    if (
      Math.abs((Number(item.saldo_final ?? item.saldo_atual) || 0) - saldo_final) > 0.001 ||
      patch.saldo_inicial != null ||
      patch.unidade_medida != null
    ) {
      updates.push(patch);
    }
    return {
      ...item,
      saldo_inicial,
      quantidade: saldo_inicial,
      unidade_medida,
      saldo_final,
      saldo_atual: saldo_final,
      expedido: Math.max(0, saldo_inicial - saldo_final),
    };
  });

  if (updates.length > 0) {
    await entities.estoque.bulkUpdate(updates);
  }

  return withSaldo;
}
