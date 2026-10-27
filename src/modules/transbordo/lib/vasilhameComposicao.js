/**
 * Utilitários de composição de lotes em vasilhames (fracionamento / top-up).
 */

import {
  parseDensidade,
  roundVolume,
  roundMass,
  litrosFromMassaKg,
  distributeByWeights,
} from "@transbordo/lib/format";
import {
  isUnidadeMassaEntrada,
  findTransbordosForVasilhame,
} from "@transbordo/lib/estoqueSaldo";
import {
  calculateFIFOAllocation,
  expandOrigensForFifo,
} from "@transbordo/lib/fifo";
import {
  TIPOS_NAO_VASILHAME,
  isDestinoEmbalagemUnitaria,
  isVasilhameLegadoEmbalado,
} from "@transbordo/lib/tiposEmbalagem";

/** Rótulo sintético — só quando há residual sem lote real atribuível. */
export const LOTE_APORTE_ANTERIOR = "Aporte anterior";

export const isOrigemEmbaladoMassa = (origem) => {
  const embalado =
    origem?.tipo_origem === "embalado" || Boolean(origem?.embalado);
  if (!embalado) return false;
  return isUnidadeMassaEntrada(origem?.unidade_medida || "kg");
};

const placaKey = (placa, barril) =>
  `${String(placa || "").trim().toUpperCase()}||${String(barril || "").trim().toUpperCase()}`;

const isLoteReal = (lote) => {
  const l = (lote || "").trim();
  return Boolean(l) && l !== LOTE_APORTE_ANTERIOR;
};

const hasAporteAnterior = (composicao = []) =>
  (composicao || []).some(
    (c) => (c.lote || "").trim() === LOTE_APORTE_ANTERIOR
  );

/** Soma residual ao primeiro entry do lote alvo (evita inventar "Aporte anterior"). */
function foldResidualIntoLote(raw, loteAlvo, residual, dens) {
  let folded = false;
  return raw.map((c) => {
    if (folded || (c.lote || "").trim() !== loteAlvo) return c;
    folded = true;
    const qL = roundVolume((c.quantidade_l || 0) + residual);
    return {
      ...c,
      quantidade_l: qL,
      quantidade_kg:
        dens > 0
          ? roundMass(qL * dens)
          : roundMass((c.quantidade_kg || 0) + residual * dens),
    };
  });
}

/**
 * Garante que o volume atual do tanque esteja representado na composição.
 * Se composicao estiver vazia ou incompleta, semeia com lote/volume existentes
 * para não perder o aporte inicial ao completar (top-up).
 */
export function seedComposicaoFromVasilhame(v) {
  if (!v) return [];
  const dens =
    parseFloat(String(v.densidade || "0").replace(",", ".")) || 0;
  const vol = roundVolume(v.volume || 0);
  const raw = Array.isArray(v.composicao)
    ? v.composicao.filter((c) => roundVolume(c.quantidade_l || 0) > 0)
    : [];
  const compVol = roundVolume(
    raw.reduce((s, c) => s + (c.quantidade_l || 0), 0)
  );

  if (vol <= 0) return raw;

  if (raw.length === 0) {
    return [
      {
        lote: v.lote || "",
        quantidade_l: vol,
        quantidade_kg:
          roundMass(v.peso_liquido || 0) ||
          (dens > 0 ? roundMass(vol * dens) : 0),
        transbordo_codigo: v.numero_op || v.codigo || null,
        data: null,
      },
    ];
  }

  // Volume do tanque maior que a soma da composição → falta o aporte inicial
  if (vol > compVol) {
    const residual = vol - compVol;
    const lotesReais = new Set(
      raw.map((c) => (c.lote || "").trim()).filter(isLoteReal)
    );
    const loteCampo = (v.lote || "").trim();
    const loteCampoReal =
      loteCampo && loteCampo !== LOTE_APORTE_ANTERIOR ? loteCampo : "";

    // Mesmo lote já na composição (ou único lote real) → incorpora residual nele
    if (loteCampoReal && lotesReais.has(loteCampoReal)) {
      return foldResidualIntoLote(raw, loteCampoReal, residual, dens);
    }
    if (!loteCampoReal && lotesReais.size === 1) {
      return foldResidualIntoLote(raw, [...lotesReais][0], residual, dens);
    }

    // Lote do tanque ainda não está na composição → usa esse lote
    const loteInicial =
      loteCampoReal && !lotesReais.has(loteCampoReal)
        ? loteCampoReal
        : LOTE_APORTE_ANTERIOR;

    return [
      {
        lote: loteInicial,
        quantidade_l: residual,
        quantidade_kg: dens > 0 ? roundMass(residual * dens) : 0,
        transbordo_codigo: v.numero_op || v.codigo || null,
        data: null,
      },
      ...raw,
    ];
  }

  return raw;
}

/** Só absorve residual de arredondamento — nunca inventa milhares de litros. */
const ALIGN_VOLUME_TOLERANCIA_L = 1;
const TOLERANCIA_TANQUE_CHEIO_L = 0.5;

function fifoEntryKey(e) {
  return `${String(e.transbordo_codigo || "").trim()}|${e.destino_index ?? ""}|${(e.lote || "").trim()}|${roundVolume(e.quantidade_l || 0)}`;
}

function dedupeFifoEntries(entries = []) {
  const seen = new Set();
  const out = [];
  for (const e of entries || []) {
    const key = fifoEntryKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * Capacidade operacional do tanque. Vasilhame padrão é 5.000 L; 10.000 L no
 * cadastro é o caso típico de volume duplicado, não um tanque real de 10 m³.
 */
export function capacidadeOperacionalDoTanque(vasilhame, fifoSum = 0) {
  const cap = Number(vasilhame?.capacidade);
  const stored = roundVolume(vasilhame?.volume || 0);
  const hasCap = Number.isFinite(cap) && cap > 0;
  const looksLikeTanque5000 =
    Math.abs(stored - 10000) < 1 ||
    Math.abs(fifoSum - 10000) < 1 ||
    Math.abs(stored - 5000) < 1 ||
    Math.abs(fifoSum - 5000) < 1;

  if (hasCap && Math.abs(cap - 10000) < 1 && looksLikeTanque5000) {
    return 5000;
  }
  if (hasCap) return roundVolume(cap);
  if (looksLikeTanque5000) return 5000;
  return 0;
}

/**
 * Quando vários OPs apontam para a mesma placa e a soma ultrapassa a
 * capacidade, os destinos mais antigos costumam ter o volume acumulado
 * (tanque cheio) em vez do incremento. Recorta do fim para o começo.
 */
function clipFifoEntriesToCapacidade(entries = [], capacidade, dens = 0) {
  const cap = roundVolume(capacidade || 0);
  if (!(cap > 0) || entries.length === 0) return entries;
  const sum = roundVolume(entries.reduce((s, e) => s + (e.quantidade_l || 0), 0));
  if (sum <= cap + TOLERANCIA_TANQUE_CHEIO_L) return entries;

  let remaining = cap;
  const kept = [];
  for (let i = entries.length - 1; i >= 0 && remaining > 0; i--) {
    const e = entries[i];
    const take = roundVolume(Math.min(e.quantidade_l || 0, remaining));
    if (take <= 0) continue;
    const kg =
      dens > 0
        ? roundMass(take * dens)
        : (e.quantidade_l || 0) > 0
          ? roundMass(((e.quantidade_kg || 0) * take) / e.quantidade_l)
          : roundMass(e.quantidade_kg || 0);
    kept.push({ ...e, quantidade_l: take, quantidade_kg: kg });
    remaining = roundVolume(remaining - take);
  }
  return kept.reverse();
}

function composicaoSignature(list = []) {
  return (list || [])
    .map(
      (c) =>
        `${String(c.transbordo_codigo || "").trim()}|${(c.lote || "").trim()}|${roundVolume(c.quantidade_l || 0)}`
    )
    .join(";");
}

/**
 * Reconstrói composição a partir dos destinos FIFO que caíram nesta placa.
 * @param {{ alignToVolume?: boolean }} options — se true, só alinha residual de arredondamento
 *   (|diff| ≤ 1 L). Nunca padra a composição a um volume inflado do cadastro.
 */
export function rebuildComposicaoFromTransbordos(
  vasilhame,
  transbordos = [],
  options = {}
) {
  const { alignToVolume = true } = options;
  if (!vasilhame?.placa) return seedComposicaoFromVasilhame(vasilhame);

  const sorted = [...(transbordos || [])].sort((a, b) => {
    const ta = new Date(a.created_at || a.created_date || a.data || 0).getTime();
    const tb = new Date(b.created_at || b.created_date || b.data || 0).getTime();
    return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
  });

  const entries = [];
  for (const raw of sorted) {
    const t = transbordoOperacionalEmLitros(raw);
    const fifo = composicaoFifoNaPlaca(t, vasilhame.placa, vasilhame.barril);
    if (fifo.length > 0) {
      entries.push(...fifo);
      continue;
    }

    const dens =
      parseDensidade(t.densidade) || parseDensidade(vasilhame.densidade);
    (t.destinos || []).forEach((d, destinoIndex) => {
      if (!destinoNaPlaca(d, vasilhame.placa, vasilhame.barril)) return;
      const volDest = roundVolume(d.volume_total || d.volume || 0);
      if (volDest <= 0) return;
      const kgDest = roundMass(d.peso_liquido || 0);
      entries.push({
        lote: d.lote || t.lote || "",
        quantidade_l: volDest,
        quantidade_kg:
          kgDest > 0 ? kgDest : dens > 0 ? roundMass(volDest * dens) : 0,
        transbordo_codigo: t.codigo_transbordo || null,
        data: t.data || null,
        destino_index: destinoIndex,
      });
    });
  }

  if (entries.length === 0) {
    return seedComposicaoFromVasilhame(vasilhame);
  }

  const unique = dedupeFifoEntries(entries);
  const dens =
    parseDensidade(vasilhame.densidade) ||
    parseDensidade(sorted.find((t) => parseDensidade(t.densidade))?.densidade);
  const fifoSum = roundVolume(
    unique.reduce((s, e) => s + (e.quantidade_l || 0), 0)
  );
  const cap = capacidadeOperacionalDoTanque(vasilhame, fifoSum);
  const clipped = clipFifoEntriesToCapacidade(unique, cap, dens);

  const sum = roundVolume(clipped.reduce((s, e) => s + e.quantidade_l, 0));
  const vol = roundVolume(vasilhame.volume || 0);
  if (alignToVolume && vol > 0 && sum !== vol && clipped.length > 0) {
    const diff = vol - sum;
    if (Math.abs(diff) <= ALIGN_VOLUME_TOLERANCIA_L) {
      clipped[clipped.length - 1].quantidade_l = Math.max(
        0,
        roundVolume(clipped[clipped.length - 1].quantidade_l + diff)
      );
    }
  }

  return clipped.filter((e) => e.quantidade_l > 0);
}

/** Agrega composição por lote (soma L e kg). */
export function aggregateComposicaoByLote(composicao = []) {
  const map = new Map();
  for (const c of composicao || []) {
    const loteKey = (c.lote || "").trim() || "—";
    const prev = map.get(loteKey) || {
      lote: loteKey === "—" ? "" : loteKey,
      quantidade_l: 0,
      quantidade_kg: 0,
      historico: [],
    };
    const qL = roundVolume(c.quantidade_l || 0);
    const qKg = roundMass(c.quantidade_kg || 0);
    prev.quantidade_l += qL;
    prev.quantidade_kg += qKg;
    prev.historico.push({
      lote: c.lote || "",
      quantidade_l: qL,
      quantidade_kg: qKg,
      transbordo_codigo: c.transbordo_codigo || null,
      data: c.data || null,
    });
    map.set(loteKey, prev);
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      quantidade_l: roundVolume(r.quantidade_l),
      quantidade_kg: roundMass(r.quantidade_kg),
    }))
    .sort((a, b) => b.quantidade_l - a.quantidade_l);
}

/**
 * Data em que o lote foi envasado na embalagem (mais recente do histórico).
 * Aceita item agregado (`historico[]`) ou entrada simples da composição.
 */
export function getLoteEnvaseDate(item) {
  if (!item) return null;
  const rawDates = Array.isArray(item.historico)
    ? item.historico.map((h) => h?.data).filter(Boolean)
    : item.data
      ? [item.data]
      : [];
  const dates = rawDates
    .map((d) =>
      new Date(String(d).includes("T") ? d : `${String(d).slice(0, 10)}T00:00:00`)
    )
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b - a);
  return dates.length > 0 ? dates[0] : null;
}

const toDateOnly = (value) => {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 10) : "";
};

const sameLoteText = (a, b) => (a || "").trim() === (b || "").trim();

/**
 * Registros de estoque (entrada) que originaram o lote do vasilhame,
 * do vínculo mais confiável para o menos confiável:
 * 1) id do estoque na composição; 2) entrada da composição;
 * 3) origens dos transbordos do tanque; 4) código da entrada; 5) mesmo lote.
 * Dentro de cada grupo, registros do mesmo lote vêm primeiro.
 */
function listEstoqueOrigemDoLote(vasilhame, lote, entries, estoqueById, transbordos) {
  const all = [...estoqueById.values()].filter(Boolean);
  const result = [];
  const seen = new Set();
  const push = (rows) => {
    const ordered = [
      ...rows.filter((r) => sameLoteText(r.lote, lote)),
      ...rows.filter((r) => !sameLoteText(r.lote, lote)),
    ];
    for (const row of ordered) {
      const key = row?.id ?? row;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(row);
    }
  };

  push(
    entries
      .flatMap((c) => [c.estoque_id, c.entrada_id])
      .map((id) => (id ? estoqueById.get(id) : null))
      .filter(Boolean)
  );

  const entradaIds = new Set(entries.map((c) => c.entrada_id).filter(Boolean));
  if (entradaIds.size > 0) push(all.filter((r) => entradaIds.has(r.entrada_id)));

  const opCodes = new Set(
    [
      vasilhame.codigo,
      vasilhame.numero_op,
      ...entries.map((c) => c.transbordo_codigo),
    ]
      .map((c) => (c || "").trim())
      .filter(Boolean)
  );
  const origemIds = new Set();
  for (const t of transbordos || []) {
    const ligado =
      (vasilhame.transbordo_id && t.id === vasilhame.transbordo_id) ||
      opCodes.has((t.codigo_transbordo || "").trim());
    if (!ligado) continue;
    for (const o of t.origens || []) {
      if (o.estoque_id) origemIds.add(o.estoque_id);
      if (o.entrada_id) origemIds.add(o.entrada_id);
    }
  }
  if (origemIds.size > 0) {
    push(all.filter((r) => origemIds.has(r.id) || origemIds.has(r.entrada_id)));
  }

  const entradaCodigos = new Set(
    [vasilhame.codigo, ...entries.map((c) => c.entrada_codigo)]
      .map((c) => (c || "").trim())
      .filter(Boolean)
  );
  push(all.filter((r) => entradaCodigos.has((r.entrada_codigo || "").trim())));

  if (lote) push(all.filter((r) => sameLoteText(r.lote, lote)));

  return result;
}

/**
 * Fabricação/validade do lote do vasilhame (YYYY-MM-DD).
 * Prioriza o que foi editado no vasilhame (composição); senão usa as datas
 * informadas na entrada que originou o lote.
 *
 * @param {object} vasilhame
 * @param {Map<string, object>|null} estoqueById
 * @param {{ transbordos?: object[] }} [options]
 */
export function resolveVasilhameLoteDatas(
  vasilhame,
  estoqueById = null,
  { transbordos = [] } = {}
) {
  const empty = { data_fabricacao: "", data_validade: "" };
  if (!vasilhame) return empty;

  const lote = (vasilhame.lote || getDominantLote(vasilhame.composicao) || "").trim();
  const composicao = Array.isArray(vasilhame.composicao) ? vasilhame.composicao : [];
  const doLote = composicao.filter((c) => sameLoteText(c.lote, lote));
  const entries = doLote.length > 0 ? doLote : composicao;

  const origens =
    estoqueById && estoqueById.size > 0
      ? listEstoqueOrigemDoLote(vasilhame, lote, entries, estoqueById, transbordos)
      : [];

  const pick = (field) => {
    const own = entries.find((c) => Object.prototype.hasOwnProperty.call(c, field));
    if (own) return toDateOnly(own[field]);
    for (const est of origens) {
      const value = toDateOnly(est[field]);
      if (value) return value;
    }
    return "";
  };

  return {
    data_fabricacao: pick("data_fabricacao"),
    data_validade: pick("data_validade"),
  };
}

/**
 * Grava fabricação/validade nas entradas da composição do lote informado.
 * Sem composição, cria uma entrada única para carregar as datas.
 */
export function applyLoteDatasToComposicao(
  composicao = [],
  lote,
  datas = {},
  fallback = {}
) {
  const loteKey = (lote || "").trim();
  const patch = {};
  if ("data_fabricacao" in datas) {
    patch.data_fabricacao = toDateOnly(datas.data_fabricacao) || null;
  }
  if ("data_validade" in datas) {
    patch.data_validade = toDateOnly(datas.data_validade) || null;
  }
  if (Object.keys(patch).length === 0) return composicao || [];

  const base = Array.isArray(composicao) ? composicao : [];
  if (base.length === 0) {
    return [
      {
        lote: loteKey,
        quantidade_l: fallback.quantidade_l || 0,
        quantidade_kg: fallback.quantidade_kg || 0,
        transbordo_codigo: fallback.transbordo_codigo || null,
        data: null,
        ...patch,
      },
    ];
  }

  const hasLote = base.some((c) => (c.lote || "").trim() === loteKey);
  return base.map((c) =>
    !hasLote || (c.lote || "").trim() === loteKey ? { ...c, ...patch } : c
  );
}

/**
 * Tanque fechado na capacidade cadastrada (ex.: 5.000 L).
 * Sem capacidade no cadastro, não infere “cheio” só pelo volume — evita
 * bloquear fracionado com 1.500 L em tanque de 5.000 L.
 */
export function tanqueEstaCheio(volume, capacidade) {
  const vol = roundVolume(volume || 0);
  if (vol <= 0) return false;
  const cap = Number(capacidade);
  if (Number.isFinite(cap) && cap > 0) {
    return vol + 1e-9 >= roundVolume(cap) - TOLERANCIA_TANQUE_CHEIO_L;
  }
  return false;
}

/** O interruptor só vale enquanto o tanque não fechou a capacidade. */
export function fracionadoEfetivo(marcado, volume, capacidade) {
  return !!marcado && !tanqueEstaCheio(volume, capacidade);
}

/**
 * Volume do tanque depois deste lançamento.
 * No complemento, soma o que já está no pátio. Na reedição do mesmo OP,
 * tira da base a fatia que este OP já gravou para não contar duas vezes.
 */
export function volumeAcumuladoDoTanque(
  destinos = [],
  { placa, barril, vasilhames = [], codigoOp = "" } = {}
) {
  const slices = (destinos || []).filter(
    (d) =>
      (d?.tipo_embalagem || "") === "Vasilhame" &&
      sameTanqueIdentity(d.placa, d.barril, placa, barril)
  );
  if (slices.length === 0) return 0;
  const soma = roundVolume(
    slices.reduce(
      (s, d) => s + roundVolume(d.volume_total || d.volume || 0),
      0
    )
  );
  const id = slices.map((d) => d.vasilhame_existente_id).find(Boolean);
  const patio = id
    ? (vasilhames || []).find((v) => String(v.id) === String(id))
    : null;
  let base = roundVolume(patio?.volume || 0);
  const code = String(codigoOp || "").trim();
  if (patio && code) {
    const deste = roundVolume(
      (patio.composicao || [])
        .filter((c) => String(c.transbordo_codigo || "").trim() === code)
        .reduce((s, c) => s + (Number(c.quantidade_l) || 0), 0)
    );
    if (deste > 0) base = Math.max(0, roundVolume(base - deste));
  }
  return roundVolume(base + soma);
}

/** Lote de maior volume na composição (para coluna da listagem). */
export function getDominantLote(composicao = []) {
  const agg = aggregateComposicaoByLote(composicao).filter((r) =>
    isLoteReal(r.lote)
  );
  if (agg.length === 0) {
    const fallback = aggregateComposicaoByLote(composicao);
    return fallback[0]?.lote || "";
  }
  return agg[0].lote || "";
}

/**
 * Soma um destino (mesmo OP, mesma placa) a um vasilhame já calculado.
 * Usado quando vários destinos do transbordo apontam para o mesmo tanque.
 */
export function applyAdditionalDestino(
  base,
  {
    addVolume = 0,
    comp = [],
    tara,
    fracionado = false,
    codigo = null,
    data = null,
    dens = 0,
  } = {}
) {
  if (!base) return base;
  const addVol = roundVolume(addVolume || 0);
  const baseComp = seedComposicaoFromVasilhame(base);
  const baseVol = Math.max(
    roundVolume(base.volume || 0),
    roundVolume(baseComp.reduce((s, c) => s + (c.quantidade_l || 0), 0))
  );
  const newVol = roundVolume(baseVol + addVol);
  const merged = mergeComposicao(baseComp, comp, {
    transbordo_codigo: codigo,
    data,
  });
  const densV = parseDensidade(base.densidade) || parseDensidade(dens) || 0;
  const addedKg = (comp || []).reduce((s, c) => s + (c.quantidade_kg || 0), 0);
  const peso =
    densV > 0
      ? roundMass(newVol * densV)
      : roundMass((base.peso_liquido || 0) + addedKg);
  const taraFinal =
    tara != null && tara !== ""
      ? roundMass(tara)
      : roundMass(base.tara || 0);
  return {
    volume: newVol,
    composicao: merged,
    lote: getDominantLote(merged) || base.lote || "",
    peso_liquido: peso,
    peso_bruto: roundMass(taraFinal + peso),
    tara: taraFinal,
    // O interruptor do destino vale mesmo com vários lotes na composição.
    // Tanque que fechou a capacidade deixa de ser fracionado.
    fracionado: fracionadoEfetivo(
      fracionado,
      newVol,
      capacidadeOperacionalDoTanque({ ...base, volume: newVol }, newVol)
    ),
  };
}

function destinoNaPlaca(destino, placa, barril) {
  if (!destino) return false;
  if (destino.tipo_embalagem && destino.tipo_embalagem !== "Vasilhame") {
    return false;
  }
  const dPlaca = String(destino.placa || "").trim().toUpperCase();
  const p = String(placa || "").trim().toUpperCase();
  if (!p || dPlaca !== p) return false;
  const dBarril = String(destino.barril || "").trim().toUpperCase();
  const b = String(barril || "").trim().toUpperCase();
  if (b && dBarril && b !== dBarril) return false;
  return true;
}

/**
 * Fracionado do tanque no pátio: o último destino desta placa/barril.
 * Sem transbordo correspondente, permanece o flag já gravado no vasilhame.
 * Volume na capacidade cadastrada nunca fica fracionado.
 */
export function resolveFracionadoFromTransbordos(vasilhame, transbordos = []) {
  if (!vasilhame) return false;
  const cap = capacidadeOperacionalDoTanque(
    vasilhame,
    roundVolume(vasilhame.volume || 0)
  );
  const related = (transbordos || []).filter((t) =>
    (t.destinos || []).some((d) =>
      destinoNaPlaca(d, vasilhame.placa, vasilhame.barril)
    )
  );
  if (related.length === 0) {
    return fracionadoEfetivo(vasilhame.fracionado, vasilhame.volume, cap);
  }

  const lastT = [...related].sort(
    (a, b) =>
      new Date(b.data || b.created_at || 0) -
      new Date(a.data || a.created_at || 0)
  )[0];
  const destinos = (lastT?.destinos || []).filter((d) =>
    destinoNaPlaca(d, vasilhame.placa, vasilhame.barril)
  );
  const lastDest = destinos[destinos.length - 1];
  if (!lastDest) {
    return fracionadoEfetivo(vasilhame.fracionado, vasilhame.volume, cap);
  }
  return fracionadoEfetivo(
    lastDest.fracionado === true,
    vasilhame.volume,
    cap
  );
}

/**
 * Origem embalada em kg grava a quantidade no volume do destino.
 * A soma dos destinos fecha com a massa (kg), não com os litros.
 * Volume já convertido (soma = litros da massa) não entra de novo.
 */
function destinosGravadosEmKg(transbordo, dens) {
  const densidade = parseDensidade(dens || transbordo?.densidade);
  if (!(densidade > 0)) return false;
  const origens = transbordo?.origens || [];
  if (!origens.some(isOrigemEmbaladoMassa)) return false;

  const destinos = transbordo?.destinos || [];
  const sumQty = roundVolume(
    destinos.reduce(
      (s, d) => s + roundVolume(d.volume_total || d.volume || 0),
      0
    )
  );
  const massaDeclarada = roundMass(transbordo?.massa_total || 0);
  const massa =
    massaDeclarada > 0
      ? massaDeclarada
      : roundMass(
          origens.reduce((s, o) => {
            if (!isOrigemEmbaladoMassa(o)) return s;
            return s + roundMass(o.massa_retirada || o.volume_retirado || 0);
          }, 0)
        );
  if (!(sumQty > 0) || !(massa > 0)) return false;

  const tol = Math.max(1, destinos.length || 1);
  if (Math.abs(sumQty - massa) <= tol) return true;
  const litros = roundVolume(litrosFromMassaKg(massa, densidade));
  if (litros > 0 && Math.abs(sumQty - litros) <= tol) return false;
  return false;
}

/** Copia o transbordo com origens e destinos em litros operacionais. */
function transbordoOperacionalEmLitros(transbordo) {
  if (!transbordo || !destinosGravadosEmKg(transbordo)) return transbordo;
  const dens = parseDensidade(transbordo.densidade);
  if (!(dens > 0)) return transbordo;

  const destinosRaw = transbordo.destinos || [];
  const kgList = destinosRaw.map((d) =>
    roundMass(d.volume_total || d.volume || 0)
  );
  const totalKg = kgList.reduce((s, kg) => s + kg, 0);
  const totalL = roundVolume(litrosFromMassaKg(totalKg, dens));
  const litrosList = distributeByWeights(totalL, kgList);

  const destinos = destinosRaw.map((d, i) => {
    const kg = kgList[i] || 0;
    const vol = roundVolume(litrosList[i] || 0);
    return {
      ...d,
      volume: vol,
      volume_total: vol,
      peso_liquido: kg > 0 ? kg : roundMass(d.peso_liquido || 0),
    };
  });

  const origens = (transbordo.origens || []).map((o) => {
    if (!isOrigemEmbaladoMassa(o)) return o;
    const kg = roundMass(o.massa_retirada || o.volume_retirado || 0);
    const lotesRaw = Array.isArray(o.lotes_retirados) ? o.lotes_retirados : null;
    if (lotesRaw && lotesRaw.length > 0) {
      const loteKg = lotesRaw.map((l) => roundMass(l.volume_retirado || 0));
      const loteSum = loteKg.reduce((s, n) => s + n, 0);
      const loteL = distributeByWeights(
        roundVolume(litrosFromMassaKg(loteSum || kg, dens)),
        loteKg
      );
      return {
        ...o,
        massa_retirada: kg,
        volume_retirado: roundVolume(loteL.reduce((s, n) => s + n, 0)),
        lotes_retirados: lotesRaw.map((l, i) => ({
          ...l,
          volume_retirado: roundVolume(loteL[i] || 0),
        })),
      };
    }
    return {
      ...o,
      massa_retirada: kg,
      volume_retirado: roundVolume(litrosFromMassaKg(kg, dens)),
    };
  });

  return { ...transbordo, origens, destinos };
}

/** Fatias FIFO de um transbordo que caíram nesta placa. */
export function composicaoFifoNaPlaca(transbordo, placa, barril) {
  if (!transbordo) return [];
  const op = transbordoOperacionalEmLitros(transbordo);
  const dens = parseDensidade(op.densidade);
  const origensFifo = expandOrigensForFifo(op.origens || [], dens);
  const destinos = op.destinos || [];
  const { destinoCompositions } = calculateFIFOAllocation(
    origensFifo,
    destinos,
    dens
  );
  const entries = [];
  destinos.forEach((d, destinoIndex) => {
    if (!destinoNaPlaca(d, placa, barril)) return;
    const destinoVol = roundVolume(d.volume_total || d.volume || 0);
    const destinoKg = roundMass(d.peso_liquido || 0);
    for (const c of destinoCompositions[destinoIndex] || []) {
      const qL = roundVolume(c.quantidade_l || 0);
      if (qL <= 0) continue;
      const o = origensFifo[c.origem_index];
      const estoqueId = o?.estoque_id || o?.entrada_id || null;
      const kgFromDestino =
        destinoVol > 0 && destinoKg > 0
          ? roundMass((destinoKg * qL) / destinoVol)
          : 0;
      entries.push({
        lote: c.lote || "",
        origem_index: c.origem_index,
        quantidade_l: qL,
        quantidade_kg:
          kgFromDestino > 0
            ? kgFromDestino
            : dens > 0
              ? roundMass(qL * dens)
              : roundMass(c.quantidade_kg || 0),
        estoque_id: estoqueId,
        entrada_id: estoqueId,
        transbordo_codigo: transbordo.codigo_transbordo || null,
        data: transbordo.data || null,
        destino_index: destinoIndex,
      });
    }
  });
  return entries;
}

/**
 * Restaura volume e composição quando vários destinos da mesma placa/OP
 * foram gravados como um único lote (o de maior volume).
 * Retorna null quando o registro já está coerente.
 */
export function collapsedPlacaHealPatch(vasilhame, transbordos = []) {
  if (!vasilhame?.placa) return null;
  if ((vasilhame.tipo || "Vasilhame") !== "Vasilhame") return null;
  if ((vasilhame.status || "No Pátio") !== "No Pátio") return null;
  if (vasilhame.data_saida) return null;
  if (composicaoTemLoteManual(vasilhame.composicao)) return null;

  const codigo = String(vasilhame.numero_op || vasilhame.codigo || "").trim();
  const op = (transbordos || []).find((t) => {
    if (vasilhame.transbordo_id && t.id === vasilhame.transbordo_id) return true;
    return codigo && String(t.codigo_transbordo || "").trim() === codigo;
  });
  if (!op) return null;

  const opCode = String(op.codigo_transbordo || "").trim();
  const codes = new Set(
    (vasilhame.composicao || [])
      .map((c) => String(c.transbordo_codigo || "").trim())
      .filter((c) => c && c.toLowerCase() !== "manual")
  );
  if (codes.size > 1) return null;
  if (codes.size === 1 && opCode && !codes.has(opCode)) return null;

  const entries = composicaoFifoNaPlaca(op, vasilhame.placa, vasilhame.barril);
  const fifoLotes = new Set(
    entries.map((e) => (e.lote || "").trim()).filter(isLoteReal)
  );
  if (fifoLotes.size < 2) return null;

  const storedLotes = new Set(
    (Array.isArray(vasilhame.composicao) ? vasilhame.composicao : [])
      .map((c) => (c.lote || "").trim())
      .filter(isLoteReal)
  );
  if (storedLotes.size >= fifoLotes.size) return null;
  if (
    storedLotes.size > 0 &&
    ![...storedLotes].every((l) => fifoLotes.has(l))
  ) {
    return null;
  }

  const fifoVol = roundVolume(entries.reduce((s, e) => s + e.quantidade_l, 0));
  const storedVol = roundVolume(vasilhame.volume || 0);
  if (fifoVol <= storedVol) return null;

  const destinoVols = (op.destinos || [])
    .filter((d) => destinoNaPlaca(d, vasilhame.placa, vasilhame.barril))
    .map((d) => roundVolume(d.volume_total || d.volume || 0));
  const explained =
    storedVol === 0 ||
    destinoVols.some((v) => v === storedVol) ||
    entries.some((e) => e.quantidade_l === storedVol);
  if (!explained) return null;

  const dens =
    parseDensidade(vasilhame.densidade) || parseDensidade(op.densidade);
  const composicao = entries.map((e) => ({
    ...e,
    quantidade_kg:
      dens > 0 ? roundMass(e.quantidade_l * dens) : e.quantidade_kg,
  }));
  const peso =
    dens > 0
      ? roundMass(fifoVol * dens)
      : roundMass(composicao.reduce((s, c) => s + (c.quantidade_kg || 0), 0));
  const tara = roundMass(vasilhame.tara || 0);

  return {
    volume: fifoVol,
    composicao,
    lote: getDominantLote(composicao) || vasilhame.lote || "",
    peso_liquido: peso,
    peso_bruto: roundMass(tara + peso),
  };
}

function sameTransbordoDoVasilhame(vasilhame, transbordo) {
  if (!vasilhame || !transbordo) return false;
  if (vasilhame.transbordo_id && vasilhame.transbordo_id === transbordo.id) {
    return true;
  }
  const codigo = String(vasilhame.numero_op || vasilhame.codigo || "").trim();
  return Boolean(
    codigo && codigo === String(transbordo.codigo_transbordo || "").trim()
  );
}

function destinoMatchesVasilhame(destino, vasilhame, transbordo, destIndex) {
  if (!destino || !vasilhame) return false;
  if (destinoNaPlaca(destino, vasilhame.placa, vasilhame.barril)) return true;

  const destinoTemPlaca = Boolean(String(destino.placa || "").trim());
  // Destino sem placa, apontando explicitamente para este tanque.
  if (
    !destinoTemPlaca &&
    destino.vasilhame_existente_id &&
    destino.vasilhame_existente_id === vasilhame.id
  ) {
    return true;
  }
  if (!sameTransbordoDoVasilhame(vasilhame, transbordo)) return false;
  if (destinoTemPlaca) return false;
  if (
    vasilhame.destino_index != null &&
    Number(vasilhame.destino_index) === destIndex
  ) {
    return true;
  }
  return false;
}

/**
 * Destino de origem embalada em kg: a UI grava a quantidade em kg no volume.
 * Converte o transbordo inteiro quando a soma dos destinos fecha com a massa.
 * O fallback só converte um destino isolado quando o peso é o próprio kg.
 */
function destinoToLitrosKg(destino, origens = [], densidade, transbordo = null) {
  const dens = parseDensidade(densidade);
  const qty = roundVolume(destino?.volume_total || destino?.volume || 0);
  const peso = roundMass(destino?.peso_liquido || 0);

  if (transbordo && destinosGravadosEmKg(transbordo, dens) && qty > 0) {
    const op = transbordoOperacionalEmLitros(transbordo);
    const idx = (transbordo.destinos || []).indexOf(destino);
    const converted = idx >= 0 ? op?.destinos?.[idx] : null;
    if (converted) {
      return {
        volume: roundVolume(converted.volume_total || converted.volume || 0),
        massa: roundMass(converted.peso_liquido || qty),
      };
    }
    return {
      volume: roundVolume(litrosFromMassaKg(qty, dens)),
      massa: roundMass(qty),
    };
  }

  const origemLinked = (origens || []).find(
    (o) => o?._uid && o._uid === destino?.origem_uid
  );
  const massaOrigem =
    isOrigemEmbaladoMassa(origemLinked) ||
    (origens || []).some(isOrigemEmbaladoMassa);

  if (massaOrigem && dens > 0 && qty > 0) {
    const origMass = roundMass(
      origemLinked?.massa_retirada || transbordo?.massa_total || 0
    );
    if (peso > 0 && Math.abs(peso - roundMass(qty)) <= 1) {
      return {
        volume: roundVolume(litrosFromMassaKg(qty, dens)),
        massa: peso,
      };
    }
    if (
      origMass > 0 &&
      Math.abs(qty - origMass) <= 1 &&
      Math.abs(peso - roundMass(qty * dens)) <= 2
    ) {
      return {
        volume: roundVolume(litrosFromMassaKg(qty, dens)),
        massa: origMass,
      };
    }
  }

  return {
    volume: qty,
    massa: peso > 0 ? peso : dens > 0 ? roundMass(qty * dens) : 0,
  };
}

function destinosDoVasilhame(vasilhame, transbordos = []) {
  const related = findTransbordosForVasilhame(vasilhame, transbordos);
  const hits = [];
  for (const t of related) {
    const destinos = t.destinos || [];
    const matched = destinos
      .map((d, i) => ({ dest: d, transbordo: t, destIndex: i }))
      .filter(({ dest, destIndex }) =>
        destinoMatchesVasilhame(dest, vasilhame, t, destIndex)
      );
    if (matched.length > 0) {
      hits.push(...matched);
      continue;
    }
    if (
      destinos.length === 1 &&
      sameTransbordoDoVasilhame(vasilhame, t) &&
      (!String(destinos[0]?.placa || "").trim() ||
        destinoNaPlaca(destinos[0], vasilhame.placa, vasilhame.barril))
    ) {
      hits.push({ dest: destinos[0], transbordo: t, destIndex: 0 });
    }
  }
  return hits;
}

/** Volume/massa esperados pelos destinos do transbordo. Null se não houver vínculo. */
export function expectedVolumeFromDestinos(vasilhame, transbordos = []) {
  if ((vasilhame?.tipo || "Vasilhame") === "Vasilhame" && vasilhame?.placa) {
    const history = rebuildComposicaoFromTransbordos(vasilhame, transbordos, {
      alignToVolume: false,
    }).filter((c) => (c.lote || "").trim() !== LOTE_APORTE_ANTERIOR);
    const volume = roundVolume(
      history.reduce((s, c) => s + (c.quantidade_l || 0), 0)
    );
    if (volume > 0) {
      const dens =
        parseDensidade(vasilhame?.densidade) ||
        parseDensidade(
          (transbordos || []).find((t) => parseDensidade(t?.densidade))
            ?.densidade
        );
      const massaFromComp = roundMass(
        history.reduce((s, c) => s + (c.quantidade_kg || 0), 0)
      );
      const massa =
        massaFromComp > 0
          ? massaFromComp
          : dens > 0
            ? roundMass(volume * dens)
            : 0;
      return { volume, massa, densidade: dens };
    }
  }

  const hits = destinosDoVasilhame(vasilhame, transbordos);
  if (hits.length === 0) return null;

  const dens =
    parseDensidade(vasilhame?.densidade) ||
    parseDensidade(hits.find((h) => h.transbordo?.densidade)?.transbordo?.densidade);
  let volume = 0;
  let massa = 0;
  for (const { dest, transbordo } of hits) {
    const par = destinoToLitrosKg(
      dest,
      transbordo?.origens || [],
      dens || transbordo?.densidade,
      transbordo
    );
    volume += par.volume;
    massa += par.massa;
  }
  volume = roundVolume(volume);
  massa = roundMass(massa);
  if (!(volume > 0)) return null;
  if (!(massa > 0) && dens > 0) massa = roundMass(volume * dens);
  return { volume, massa, densidade: dens };
}

/** Volume/massa operacionais: destinos do OP prevalecem sobre o campo corrompido. */
export function resolveVasilhameOperacionalPar(vasilhame, opts = {}) {
  const fromDest = expectedVolumeFromDestinos(
    vasilhame,
    opts.transbordos || []
  );
  const dens =
    parseDensidade(opts.densidade) ||
    parseDensidade(fromDest?.densidade) ||
    parseDensidade(vasilhame?.densidade);
  if (fromDest) {
    return {
      volume: fromDest.volume,
      massa: fromDest.massa,
      densidade: dens,
    };
  }
  return {
    volume: roundVolume(vasilhame?.volume || 0),
    massa: roundMass(vasilhame?.peso_liquido || 0),
    densidade: dens,
  };
}

/** Edição do lote na tela de vasilhames. O reparo FIFO não pode desfazer esse nome. */
export function composicaoTemLoteManual(composicao) {
  return (composicao || []).some((entry) => entry?.lote_manual);
}

/**
 * Lote da listagem e da etiqueta.
 * Lote editado no cadastro prevalece sobre o lote dominante da composição.
 */
export function loteExibidoDoVasilhame(vasilhame) {
  if (!vasilhame) return "";
  const header = String(vasilhame.lote || "").trim();
  if (composicaoTemLoteManual(vasilhame.composicao) && header) return header;
  return getDominantLote(vasilhame.composicao) || header || "";
}

/**
 * Restaura volume, peso e composição FIFO a partir dos destinos reais da placa.
 * Idempotente: só grava quando o cadastro diverge dos envases.
 *
 * Cobre o caso de tanque completado por vários OPs (ex.: T087 + T100)
 * cujo volume foi duplicado (10.000 L em tanque de 5.000 L).
 */
export function repairVolumeFromDestinosPatch(vasilhame, transbordos = []) {
  if (!vasilhame?.id) return null;
  if ((vasilhame.tipo || "Vasilhame") !== "Vasilhame") return null;
  if ((vasilhame.status || "No Pátio") !== "No Pátio" || vasilhame.data_saida) {
    return null;
  }
  // Lote alterado no cadastro é a fonte da tela e da etiqueta.
  if (composicaoTemLoteManual(vasilhame.composicao)) return null;

  const history = rebuildComposicaoFromTransbordos(vasilhame, transbordos, {
    alignToVolume: false,
  }).filter((c) => (c.lote || "").trim() !== LOTE_APORTE_ANTERIOR);
  const historySum = roundVolume(
    history.reduce((s, c) => s + (c.quantidade_l || 0), 0)
  );
  if (historySum <= 0) return null;

  const pre = preTransbordoEntries(vasilhame, transbordos).filter(
    (c) => (c.lote || "").trim() !== LOTE_APORTE_ANTERIOR
  );
  const preSum = roundVolume(
    pre.reduce((s, c) => s + (c.quantidade_l || 0), 0)
  );
  const keepManual =
    vasilhame.origem === "manual" && preSum > 0;
  const composicao = keepManual ? [...pre, ...history] : history;
  const volume = roundVolume(
    composicao.reduce((s, c) => s + (c.quantidade_l || 0), 0)
  );
  if (volume <= 0) return null;

  if (
    vasilhame.origem === "manual" &&
    preSum <= 0 &&
    roundVolume(vasilhame.volume || 0) > volume + 0.01
  ) {
    return null;
  }

  const storedVol = roundVolume(vasilhame.volume || 0);
  const expected = expectedVolumeFromDestinos(vasilhame, transbordos);
  const storedKg = roundMass(vasilhame.peso_liquido || 0);
  // Volume gravado como kg (1245 no lugar de 1500 L) precisa subir.
  // Baixa real de origem continua sem devolver o volume do destino.
  const volumeEraKg =
    (expected?.massa > 0 && Math.abs(storedVol - expected.massa) <= 1) ||
    (storedKg > 0 &&
      Math.abs(storedVol - storedKg) <= 1 &&
      volume > storedVol + 0.01);
  if (!volumeEraKg && storedVol + 0.01 < volume) return null;

  const storedComp = Array.isArray(vasilhame.composicao)
    ? vasilhame.composicao.filter(
        (c) => (c.lote || "").trim() !== LOTE_APORTE_ANTERIOR
      )
    : [];
  const dens =
    parseDensidade(vasilhame.densidade) ||
    parseDensidade(expected?.densidade);
  const pesoFromComp = roundMass(
    composicao.reduce((s, c) => s + (c.quantidade_kg || 0), 0)
  );
  const peso =
    pesoFromComp > 0
      ? pesoFromComp
      : expected?.massa > 0
        ? expected.massa
        : dens > 0
          ? roundMass(volume * dens)
          : 0;
  const lote = getDominantLote(composicao) || vasilhame.lote || "";
  const next = {
    ...vasilhame,
    volume,
    composicao,
    lote,
    peso_liquido: peso,
  };
  const fracionado = resolveFracionadoFromTransbordos(next, transbordos);
  const sameVolume = Math.abs(storedVol - volume) < 0.01;
  const sameComp =
    composicaoSignature(storedComp) === composicaoSignature(composicao);
  const sameKg = storedKg <= 0 || Math.abs(storedKg - peso) < 1;
  const sameFracionado = Boolean(fracionado) === Boolean(vasilhame.fracionado);
  const sameLote = lote === (vasilhame.lote || "");
  const tara = roundMass(vasilhame.tara || 0);
  const cap = capacidadeOperacionalDoTanque(next, volume);
  const sameCap =
    cap > 0
      ? Math.abs(Number(vasilhame.capacidade || 0) - cap) < 0.01
      : true;
  if (
    sameVolume &&
    sameComp &&
    sameKg &&
    sameFracionado &&
    sameLote &&
    sameCap
  ) {
    return null;
  }

  return {
    volume,
    composicao,
    lote,
    peso_liquido: peso,
    peso_bruto: roundMass(tara + peso),
    fracionado,
    ...(cap > 0 && Math.abs(Number(vasilhame.capacidade || 0) - cap) >= 0.01
      ? { capacidade: cap }
      : {}),
  };
}

/**
 * Restaura volume/peso do tanque a partir dos destinos do transbordo.
 * Idempotente: só grava quando o cadastro diverge do OP.
 */
export function repairEmbaladoKgStoredAsLitersPatch(vasilhame, transbordos = []) {
  const fromDestinos = repairVolumeFromDestinosPatch(vasilhame, transbordos);
  if (fromDestinos) return fromDestinos;
  if (composicaoTemLoteManual(vasilhame.composicao)) return null;

  if (!vasilhame?.id) return null;
  if ((vasilhame.status || "No Pátio") !== "No Pátio" || vasilhame.data_saida) {
    return null;
  }

  const expected = expectedVolumeFromDestinos(vasilhame, transbordos);
  if (!expected) return null;

  const storedVol = roundVolume(vasilhame.volume || 0);
  const storedKg = roundMass(vasilhame.peso_liquido || 0);
  if (
    Math.abs(storedVol - expected.volume) < 0.01 &&
    (storedKg <= 0 || Math.abs(storedKg - expected.massa) < 1)
  ) {
    return null;
  }

  const dens = expected.densidade || parseDensidade(vasilhame.densidade);
  const composicao = rescaleComposicaoToVolume(
    Array.isArray(vasilhame.composicao) ? vasilhame.composicao : [],
    expected.volume,
    dens
  );
  const tara = roundMass(vasilhame.tara || 0);
  return {
    volume: expected.volume,
    peso_liquido: expected.massa,
    peso_bruto: roundMass(tara + expected.massa),
    ...(composicao.length > 0 ? { composicao } : {}),
  };
}

/** Mescla composição existente com novas entradas (mantém histórico). */
export function mergeComposicao(existing = [], incoming = [], meta = {}) {
  const base = Array.isArray(existing) ? [...existing] : [];
  const extras = (incoming || []).map((c) => ({
    lote: c.lote || "",
    origem_index: c.origem_index,
    estoque_id: c.estoque_id || null,
    entrada_id: c.entrada_id || c.estoque_id || null,
    quantidade_l: roundVolume(c.quantidade_l || 0),
    quantidade_kg: roundMass(c.quantidade_kg || 0),
    transbordo_codigo: meta.transbordo_codigo || c.transbordo_codigo || null,
    data: meta.data || c.data || null,
  }));
  return [...base, ...extras].filter(
    (c) => (c.quantidade_l || 0) > 0 || (c.quantidade_kg || 0) > 0
  );
}

function transbordoOpCodes(transbordos = []) {
  return new Set(
    (transbordos || [])
      .map((t) => String(t.codigo_transbordo || "").trim())
      .filter(Boolean)
  );
}

function isOpComposicaoEntry(c, opCodes) {
  const code = String(c?.transbordo_codigo || "").trim();
  if (!code) return false;
  if (code.toLowerCase() === "manual") return false;
  return opCodes.has(code);
}

/** Aportes anteriores aos OPs (entrada manual / residual), para não perder no repair. */
export function preTransbordoEntries(vasilhame, transbordos = []) {
  const opCodes = transbordoOpCodes(transbordos);
  return seedComposicaoFromVasilhame(vasilhame).filter(
    (c) => !isOpComposicaoEntry(c, opCodes)
  );
}

/** Remove entradas de composição de um transbordo específico. */
export function removeComposicaoByTransbordo(composicao = [], codigo) {
  if (!codigo) return composicao || [];
  return (composicao || []).filter((c) => c.transbordo_codigo !== codigo);
}

export const VASILHAME_EM_ESTOQUE_MSG = "Vasilhame em estoque";

function normTanqueCodigo(value) {
  return String(value || "").trim().toUpperCase();
}

/** Status operacional de pátio. Expedido (ou com data de saída) não bloqueia novo lançamento. */
export function isVasilhameNoPatio(vasilhame) {
  const status = String(vasilhame?.status || "No Pátio")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (status === "expedido") return false;
  if (vasilhame?.data_saida != null && String(vasilhame.data_saida).trim() !== "") {
    return false;
  }
  return status === "no patio" || status === "";
}

function pertenceAoTransbordo(vasilhame, { excludeTransbordoId, excludeTransbordoCodigo } = {}) {
  const id = String(excludeTransbordoId || "").trim();
  const codigo = String(excludeTransbordoCodigo || "").trim();
  if (id && String(vasilhame?.transbordo_id || "") === id) return true;
  if (codigo && String(vasilhame?.numero_op || "").trim() === codigo) return true;
  if (
    codigo &&
    (vasilhame?.composicao || []).some(
      (c) => String(c?.transbordo_codigo || "").trim() === codigo
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Tanque já em estoque (No Pátio) com a mesma placa e o mesmo barril.
 * Não altera o banco: só informa a tela para impedir o lançamento duplicado.
 * Tanque expedido não entra. O registro em edição e o tanque deste OP também não.
 */
export function findTanqueNoPatioDuplicado(
  vasilhames = [],
  {
    placa,
    barril,
    excludeId,
    excludeTransbordoId,
    excludeTransbordoCodigo,
    ignorarFracionado = false,
  } = {}
) {
  const p = normTanqueCodigo(placa);
  const b = normTanqueCodigo(barril);
  if (!p && !b) return null;

  const skipId = String(excludeId || "").trim();
  return (
    (vasilhames || []).find((v) => {
      if (!v) return false;
      if (skipId && String(v.id) === skipId) return false;
      if (!isVasilhameNoPatio(v)) return false;
      if (ignorarFracionado && v.fracionado === true) return false;
      if (
        pertenceAoTransbordo(v, { excludeTransbordoId, excludeTransbordoCodigo })
      ) {
        return false;
      }
      if (TIPOS_NAO_VASILHAME.has(v.tipo) || isDestinoEmbalagemUnitaria(v.tipo)) {
        return false;
      }
      if (isVasilhameLegadoEmbalado(v.tipo)) return false;
      return normTanqueCodigo(v.placa) === p && normTanqueCodigo(v.barril) === b;
    }) || null
  );
}

/**
 * Destino Vasilhame que criaria outro registro de um tanque que já está no pátio.
 * Complemento de fracionado (mesmo tanque, vasilhame_existente_id) não é duplicata.
 */
export function destinoLancaTanqueDuplicado(destino, vasilhames = [], opts = {}) {
  if ((destino?.tipo_embalagem || "") !== "Vasilhame") return null;
  const found = findTanqueNoPatioDuplicado(vasilhames, {
    placa: destino?.placa,
    barril: destino?.barril,
    ignorarFracionado: true,
    ...opts,
  });
  if (!found) return null;
  if (
    destino?.vasilhame_existente_id &&
    String(destino.vasilhame_existente_id) === String(found.id)
  ) {
    return null;
  }
  return found;
}

/** Mesmo tanque físico: placa, ou barril quando a placa está em branco. */
export function sameTanqueIdentity(aPlaca, aBarril, bPlaca, bBarril) {
  const p1 = String(aPlaca || "").trim().toUpperCase();
  const b1 = String(aBarril || "").trim().toUpperCase();
  const p2 = String(bPlaca || "").trim().toUpperCase();
  const b2 = String(bBarril || "").trim().toUpperCase();
  if (p1 || p2) {
    if (!p1 || !p2 || p1 !== p2) return false;
    if (b1 && b2 && b1 !== b2) return false;
    return true;
  }
  return Boolean(b1) && b1 === b2;
}

/**
 * Localiza vasilhame fracionado No Pátio pela placa ou, se a placa
 * estiver em branco, pelo número do barril.
 */
export function findFracionadoNoPatio(vasilhames = [], { placa, barril, id } = {}) {
  const noPatioAll = (vasilhames || []).filter(
    (v) =>
      (v.status || "No Pátio") === "No Pátio" &&
      !TIPOS_NAO_VASILHAME.has(v.tipo || "Vasilhame")
  );

  if (id) {
    const byId = noPatioAll.find((v) => v.id === id);
    if (byId) return byId;
  }

  const noPatio = noPatioAll.filter((v) => v.fracionado === true);

  const p = String(placa || "").trim();
  const b = String(barril || "").trim();
  if (!p && b) {
    const byBarril = noPatio.filter((v) =>
      sameTanqueIdentity(v.placa, v.barril, "", b)
    );
    if (byBarril.length === 0) return null;
    return [...byBarril].sort((a, c) => (c.volume || 0) - (a.volume || 0))[0];
  }
  if (!p) return null;

  const key = placaKey(placa, barril);
  const exact = noPatio.find((v) => placaKey(v.placa, v.barril) === key);
  if (exact) return exact;

  const byPlaca = noPatio.filter(
    (v) => String(v.placa || "").trim().toUpperCase() === p.toUpperCase()
  );
  if (byPlaca.length === 1) return byPlaca[0];
  if (byPlaca.length > 1) {
    const sameBarril = byPlaca.find(
      (v) =>
        String(v.barril || "").trim().toUpperCase() ===
        String(barril || "").trim().toUpperCase()
    );
    if (sameBarril) return sameBarril;
    return [...byPlaca].sort((a, b) => (b.volume || 0) - (a.volume || 0))[0];
  }
  return null;
}

/**
 * Tanque no pátio que deve receber o complemento (top-up).
 * Inclui tanque incompleto mesmo se a tag fracionado estiver desligada.
 */
export function findTanquePatioParaComplemento(
  vasilhames = [],
  { placa, barril, id } = {}
) {
  const fracionado = findFracionadoNoPatio(vasilhames, { placa, barril, id });
  if (fracionado) return fracionado;

  const noPatio = (vasilhames || []).filter(
    (v) =>
      (v.status || "No Pátio") === "No Pátio" &&
      !v.data_saida &&
      !TIPOS_NAO_VASILHAME.has(v.tipo || "Vasilhame") &&
      !isDestinoEmbalagemUnitaria(v.tipo) &&
      !isVasilhameLegadoEmbalado(v.tipo)
  );

  if (id) {
    const byId = noPatio.find((v) => v.id === id);
    if (
      byId &&
      !tanqueEstaCheio(
        byId.volume,
        capacidadeOperacionalDoTanque(byId, byId.volume)
      )
    ) {
      return byId;
    }
  }

  const same = noPatio.filter((v) =>
    sameTanqueIdentity(v.placa, v.barril, placa, barril)
  );
  const incomplete = same.filter(
    (v) =>
      !tanqueEstaCheio(
        v.volume,
        capacidadeOperacionalDoTanque(v, v.volume)
      )
  );
  if (incomplete.length === 0) return null;
  return [...incomplete].sort((a, b) => (b.volume || 0) - (a.volume || 0))[0];
}

/**
 * Unifica vasilhames duplicados No Pátio (mesma placa+barril).
 */
export async function unifyDuplicateVasilhames(vasilhames, entitiesApi) {
  const isOperacional = (v) =>
    (v.origem === "transbordo" || v.origem === "manual" || v.fracionado === true) &&
    (v.status || "No Pátio") === "No Pátio" &&
    (v.placa || v.barril) &&
    !TIPOS_NAO_VASILHAME.has(v.tipo) &&
    // Embalagens unitárias (bombona/tambor/IBC) não unificam por placa sintética
    !isDestinoEmbalagemUnitaria(v.tipo);

  const noPatio = (vasilhames || []).filter(isOperacional);

  const groups = new Map();
  for (const v of noPatio) {
    const k = placaKey(v.placa, v.barril);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }

  const deletedIds = [];
  const replacements = [];
  const kept = [];

  for (const [, group] of groups) {
    if (group.length === 1) {
      kept.push(normalizeVasilhameLote(group[0]));
      continue;
    }

    const sorted = [...group].sort((a, b) => {
      const da = new Date(a.created_at || a.created_date || 0).getTime();
      const db = new Date(b.created_at || b.created_date || 0).getTime();
      if (da !== db) return da - db;
      return (b.volume || 0) - (a.volume || 0);
    });
    const primary = sorted[0];
    const others = sorted.slice(1);

    const opKeyOf = (v) =>
      String(v?.transbordo_id || v?.numero_op || v?.codigo || "")
        .trim()
        .toUpperCase();

    // Mesma fatia do OP (mesmo destino, ou composição idêntica) = regravação.
    // Fatias diferentes na mesma placa = lotes reais que precisam ser somados.
    const sliceKeyOf = (v) => {
      if (
        v?.destino_index !== undefined &&
        v?.destino_index !== null &&
        v?.destino_index !== ""
      ) {
        return `idx:${v.destino_index}`;
      }
      const parts = seedComposicaoFromVasilhame(v)
        .map(
          (c) =>
            `${(c.lote || "").trim()}|${roundVolume(c.quantidade_l || 0)}`
        )
        .sort();
      return `comp:${parts.join(";")}`;
    };

    let composicao = seedComposicaoFromVasilhame(primary);
    let volume = roundVolume(primary.volume || 0);
    const seenSlices = new Set();
    const primaryOp = opKeyOf(primary);
    if (primaryOp) seenSlices.add(`${primaryOp}::${sliceKeyOf(primary)}`);
    const codesOf = (v) =>
      new Set(
        seedComposicaoFromVasilhame(v)
          .map((c) => String(c.transbordo_codigo || "").trim())
          .filter((c) => c && c.toLowerCase() !== "manual")
      );
    const seenCodes = codesOf(primary);

    for (const o of others) {
      const ok = opKeyOf(o);
      const slice = ok ? `${ok}::${sliceKeyOf(o)}` : "";
      const otherCodes = codesOf(o);
      const alreadyInPrimary =
        otherCodes.size > 0 && [...otherCodes].every((c) => seenCodes.has(c));
      if (alreadyInPrimary || (ok && seenSlices.has(slice))) {
        volume = Math.max(volume, roundVolume(o.volume || 0));
        const otherComp = seedComposicaoFromVasilhame(o);
        if (otherComp.length > composicao.length && !alreadyInPrimary) {
          composicao = otherComp;
        }
        continue;
      }
      if (slice) seenSlices.add(slice);
      for (const c of otherCodes) seenCodes.add(c);
      volume += roundVolume(o.volume || 0);
      composicao = mergeComposicao(composicao, seedComposicaoFromVasilhame(o));
    }

    volume = roundVolume(volume);
    // O registro mais recente carrega a decisão do último destino (fracionado ou completo).
    const latest = [...group].sort((a, b) => {
      const ta = new Date(a.updated_at || a.created_at || a.created_date || 0).getTime();
      const tb = new Date(b.updated_at || b.created_at || b.created_date || 0).getTime();
      if (ta !== tb) return tb - ta;
      return (b.fracionado === true) - (a.fracionado === true);
    })[0];
    const fracionado = fracionadoEfetivo(
      latest?.fracionado === true,
      volume,
      primary.capacidade || latest?.capacidade
    );
    const dens =
      parseFloat(String(primary.densidade || "0").replace(",", ".")) || 0;
    const peso_liquido =
      dens > 0 ? roundMass(volume * dens) : roundMass(primary.peso_liquido || 0);
    const tara = roundMass(primary.tara || 0);
    const lote = getDominantLote(composicao) || primary.lote || "";

    const updated = await entitiesApi.vasilhames.update(primary.id, {
      volume,
      peso_liquido,
      peso_bruto: roundMass(tara + peso_liquido),
      composicao,
      lote,
      fracionado,
    });

    for (const o of others) {
      await entitiesApi.vasilhames.delete(o.id);
      deletedIds.push(o.id);
      replacements.push({ from: o.id, to: primary.id });
    }

    kept.push(
      normalizeVasilhameLote(
        updated || { ...primary, volume, composicao, lote, fracionado }
      )
    );
  }

  const processedIds = new Set([
    ...kept.map((v) => v.id),
    ...deletedIds,
  ]);
  for (const v of vasilhames || []) {
    if (!processedIds.has(v.id)) {
      kept.push(normalizeVasilhameLote(v));
    }
  }

  return { kept, deletedIds, replacements };
}

/**
 * Reescala a composição por lote para o novo volume do tanque, mantendo a
 * proporção entre lotes e a soma exata (sem criar "Aporte anterior" no seed).
 * Sem densidade, os kg acompanham a mesma proporção dos litros.
 */
export function rescaleComposicaoToVolume(composicao = [], volume, densidade = 0) {
  const base = Array.isArray(composicao) ? composicao : [];
  const target = roundVolume(volume || 0);
  if (base.length === 0) return base;

  const dens = parseDensidade(densidade);
  const sum = roundVolume(base.reduce((s, c) => s + (c.quantidade_l || 0), 0));
  const scaled = base.map((c) => {
    const qL =
      sum > 0
        ? roundVolume(((c.quantidade_l || 0) * target) / sum)
        : base.length === 1
          ? target
          : 0;
    return { ...c, quantidade_l: qL };
  });

  const residual = roundVolume(
    target - scaled.reduce((s, c) => s + c.quantidade_l, 0)
  );
  if (residual !== 0) {
    let idx = 0;
    scaled.forEach((c, i) => {
      if (c.quantidade_l > scaled[idx].quantidade_l) idx = i;
    });
    scaled[idx] = {
      ...scaled[idx],
      quantidade_l: Math.max(0, roundVolume(scaled[idx].quantidade_l + residual)),
    };
  }

  return scaled
    .map((c, i) => {
      const prev = base[i];
      const kg =
        dens > 0
          ? roundMass(c.quantidade_l * dens)
          : sum > 0
            ? roundMass(((prev.quantidade_kg || 0) * c.quantidade_l) / (prev.quantidade_l || 1))
            : roundMass(prev.quantidade_kg || 0);
      return { ...c, quantidade_kg: kg };
    })
    .filter((c) => c.quantidade_l > 0);
}

/**
 * Aplica a edição lote a lote (nome + volume) sem redistribuir um lote no outro.
 * Entradas do mesmo lote são reescaladas entre si para somar o volume informado.
 * Lotes ausentes da edição (ex.: aporte sintético) permanecem como estão.
 */
export function applyEditedLotesToComposicao(composicao = [], edits = [], densidade = 0) {
  const base = (Array.isArray(composicao) ? composicao : []).map((c) => ({ ...c }));
  const dens = parseDensidade(densidade);
  const groups = new Map();

  base.forEach((c, index) => {
    const key = (c.lote || "").trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });

  for (const edit of edits || []) {
    const original = String(edit?.lote_original ?? "").trim();
    const nextLote = String(edit?.lote ?? "").trim();
    const target = roundVolume(Number(edit?.volume) || 0);
    const indices = groups.get(original);

    if (!indices || indices.length === 0) {
      if (target <= 0 && !nextLote) continue;
      base.push({
        lote: nextLote,
        lote_manual: true,
        quantidade_l: target,
        quantidade_kg: dens > 0 ? roundMass(target * dens) : 0,
        data: null,
      });
      continue;
    }

    const entries = indices.map((i) => base[i]);
    const sum = roundVolume(entries.reduce((s, c) => s + (c.quantidade_l || 0), 0));
    const scaled = entries.map((c) => {
      const prev = c.quantidade_l || 0;
      return sum > 0
        ? roundVolume((prev * target) / sum)
        : entries.length === 1
          ? target
          : 0;
    });
    const residual = roundVolume(target - scaled.reduce((s, n) => s + n, 0));
    if (residual !== 0 && scaled.length > 0) {
      let idx = 0;
      scaled.forEach((n, i) => {
        if (n > scaled[idx]) idx = i;
      });
      scaled[idx] = Math.max(0, roundVolume(scaled[idx] + residual));
    }

    indices.forEach((entryIndex, j) => {
      const prev = base[entryIndex];
      const qL = scaled[j];
      const kg =
        dens > 0
          ? roundMass(qL * dens)
          : sum > 0
            ? roundMass(((prev.quantidade_kg || 0) * qL) / (prev.quantidade_l || 1))
            : roundMass(prev.quantidade_kg || 0);
      const next = {
        ...prev,
        lote: nextLote,
        quantidade_l: qL,
        quantidade_kg: kg,
      };
      if (nextLote !== original) next.lote_manual = true;
      base[entryIndex] = next;
    });
  }

  return base.filter((c) => roundVolume(c.quantidade_l || 0) > 0);
}

export function normalizeVasilhameLote(v) {
  if (!v) return v;
  // Lote gravado na edição não volta para o lote dominante do FIFO.
  if (composicaoTemLoteManual(v.composicao) && String(v.lote || "").trim()) {
    return v;
  }
  const dominant = getDominantLote(v.composicao);
  if (dominant && dominant !== v.lote) {
    return { ...v, lote: dominant };
  }
  if (!v.lote && dominant) {
    return { ...v, lote: dominant };
  }
  return v;
}

/**
 * Corrige composição incompleta (só lote final) usando transbordos quando necessário.
 * Também remove "Aporte anterior" sintético quando há histórico real de transbordo.
 *
 * Nunca altera volume de tanque já coerente / completado — só reduz volume ao
 * remover aporte sintético inflado.
 */
export async function repairVasilhameComposicao(
  vasilhame,
  transbordos,
  entitiesApi
) {
  if (!vasilhame) return vasilhame;
  if (composicaoTemLoteManual(vasilhame.composicao)) {
    return normalizeVasilhameLote(vasilhame);
  }
  const rawHasFake = hasAporteAnterior(vasilhame.composicao);
  const seeded = seedComposicaoFromVasilhame(vasilhame);
  const seededHasFake = hasAporteAnterior(seeded);
  const hasFake = rawHasFake || seededHasFake;
  const compVol = roundVolume(
    seeded.reduce((s, c) => s + (c.quantidade_l || 0), 0)
  );
  const vol = roundVolume(vasilhame.volume || 0);
  const uniqueLotes = new Set(
    seeded.map((c) => (c.lote || "").trim()).filter(isLoteReal)
  );

  const transbordosPlaca = (transbordos || []).filter((t) =>
    (t.destinos || []).some(
      (d) =>
        String(d.placa || "").trim().toUpperCase() ===
        String(vasilhame.placa || "").trim().toUpperCase()
    )
  );

  let composicao = seeded;
  let volume = vol;
  let syncVolume = false;
  let preservedPreOp = false;

  // Histórico só dos OPs não inclui aporte manual. Nunca reduzir volume
  // de tanque manual/completado a apenas a soma dos transbordos.
  if (
    vol > 0 &&
    transbordosPlaca.length > 0 &&
    (vasilhame.origem === "transbordo" ||
      vasilhame.origem === "manual" ||
      vasilhame.fracionado)
  ) {
    const history = rebuildComposicaoFromTransbordos(vasilhame, transbordos, {
      alignToVolume: false,
    }).filter((c) => (c.lote || "").trim() !== LOTE_APORTE_ANTERIOR);
    const historySum = roundVolume(
      history.reduce((s, c) => s + (c.quantidade_l || 0), 0)
    );
    const pre = preTransbordoEntries(vasilhame, transbordos).filter(
      (c) => (c.lote || "").trim() !== LOTE_APORTE_ANTERIOR
    );
    const preSum = roundVolume(
      pre.reduce((s, c) => s + (c.quantidade_l || 0), 0)
    );
    const isManual = vasilhame.origem === "manual";

    if (historySum > 0 && preSum > 0) {
      composicao = [...pre, ...history];
      preservedPreOp = true;
    } else if (historySum > 0 && historySum < vol && isManual) {
      const residual = vol - historySum;
      const densSeed =
        parseFloat(String(vasilhame.densidade || "0").replace(",", ".")) || 0;
      const historyLotes = new Set(
        history.map((c) => (c.lote || "").trim()).filter(isLoteReal)
      );
      const loteCampo = (vasilhame.lote || "").trim();
      const loteInicial =
        loteCampo && loteCampo !== LOTE_APORTE_ANTERIOR && !historyLotes.has(loteCampo)
          ? loteCampo
          : "";
      composicao = [
        {
          lote: loteInicial,
          quantidade_l: residual,
          quantidade_kg: densSeed > 0 ? roundMass(residual * densSeed) : 0,
          transbordo_codigo: "Manual",
          data: null,
        },
        ...history,
      ];
      preservedPreOp = true;
    } else if (
      historySum > 0 &&
      historySum < vol &&
      !isManual &&
      preSum <= 0
    ) {
      composicao = history.length > 0 ? history : seeded;
      volume = historySum;
      syncVolume = true;
    }
  }

  // Composição já bate com o volume e sem aporte sintético → não mexe
  // (protege tanques completados de rebuild agressivo por múltiplos transbordos)
  const composicaoCoerente =
    !syncVolume &&
    seeded.length > 0 &&
    compVol === vol &&
    !hasFake;

  // Rebuild só para: composição vazia/incompleta, aporte sintético, ou
  // único lote com vários transbordos (histórico faltando).
  // NÃO altera volume salvo ao limpar aporte sintético (e só para baixo).
  const needsRebuild =
    !preservedPreOp &&
    !syncVolume &&
    vol > 0 &&
    !composicaoCoerente &&
    (seeded.length === 0 ||
      compVol < vol ||
      hasFake ||
      (uniqueLotes.size <= 1 && transbordosPlaca.length > 1));

  if (needsRebuild && transbordosPlaca.length > 0) {
    const rebuilt = rebuildComposicaoFromTransbordos(vasilhame, transbordos, {
      // Com aporte fake, não padra entries ao volume inflado
      alignToVolume: !hasFake,
    });
    const rebuiltClean = (rebuilt || []).filter(
      (c) => (c.lote || "").trim() !== LOTE_APORTE_ANTERIOR
    );
    const rebuiltLotes = new Set(
      rebuiltClean.map((c) => (c.lote || "").trim()).filter(isLoteReal)
    );
    const rebuiltSum = roundVolume(
      rebuiltClean.reduce((s, c) => s + (c.quantidade_l || 0), 0)
    );

    if (
      rebuiltClean.length > 0 &&
      rebuiltLotes.size > 0 &&
      (hasFake ||
        rebuiltClean.length >= seeded.length ||
        rebuiltLotes.size > uniqueLotes.size ||
        rebuiltSum === vol)
    ) {
      composicao = rebuiltClean;
      if (
        rebuiltSum > 0 &&
        rebuiltSum < volume &&
        vasilhame.origem !== "manual" &&
        preTransbordoEntries(vasilhame, transbordos).length === 0
      ) {
        volume = rebuiltSum;
        syncVolume = true;
      }
    }
  }

  // Fallback: remove entradas sintéticas e reduz volume à composição real
  if (hasAporteAnterior(composicao)) {
    const cleaned = composicao.filter(
      (c) => (c.lote || "").trim() !== LOTE_APORTE_ANTERIOR
    );
    if (cleaned.length > 0) {
      composicao = cleaned;
      const cleanedSum = roundVolume(
        cleaned.reduce((s, c) => s + (c.quantidade_l || 0), 0)
      );
      if (cleanedSum > 0 && cleanedSum < volume) {
        volume = cleanedSum;
        syncVolume = true;
      }
    }
  }

  const lote = getDominantLote(composicao) || vasilhame.lote || "";

  const fracionado = resolveFracionadoFromTransbordos(
    { ...vasilhame, composicao, lote },
    transbordos
  );

  const dens =
    parseFloat(String(vasilhame.densidade || "0").replace(",", ".")) || 0;
  const tara = roundMass(vasilhame.tara || 0);
  const peso_liquido = syncVolume
    ? dens > 0
      ? roundMass(volume * dens)
      : roundMass(
          composicao.reduce((s, c) => s + (c.quantidade_kg || 0), 0)
        )
    : undefined;
  const peso_bruto =
    syncVolume && peso_liquido != null
      ? roundMass(tara + peso_liquido)
      : undefined;

  const changed =
    JSON.stringify(composicao) !== JSON.stringify(vasilhame.composicao || []) ||
    lote !== (vasilhame.lote || "") ||
    Boolean(fracionado) !== Boolean(vasilhame.fracionado) ||
    (syncVolume && volume !== vol);

  if (changed && entitiesApi) {
    const patch = {
      composicao,
      lote,
      fracionado: !!fracionado,
    };
    if (syncVolume) {
      patch.volume = volume;
      if (peso_liquido != null) patch.peso_liquido = peso_liquido;
      if (peso_bruto != null) patch.peso_bruto = peso_bruto;
    }
    const updated = await entitiesApi.vasilhames.update(vasilhame.id, patch);
    return normalizeVasilhameLote(
      updated || {
        ...vasilhame,
        ...patch,
      }
    );
  }

  return normalizeVasilhameLote({
    ...vasilhame,
    composicao,
    lote,
    fracionado: !!fracionado,
    ...(syncVolume
      ? { volume, peso_liquido, peso_bruto }
      : {}),
  });
}

function saidaItemEhTanque(item) {
  const tipo = String(item?.tipo || "");
  return (
    tipo === "convencional" ||
    tipo === "Vasilhame" ||
    tipo === "ind_vasilhame"
  );
}

function volumeTanqueParaSaida(vasilhame, transbordos = []) {
  if (!vasilhame) return 0;
  const expected = expectedVolumeFromDestinos(vasilhame, transbordos);
  const stored = roundVolume(vasilhame.volume || 0);
  const cap = capacidadeOperacionalDoTanque(
    vasilhame,
    expected?.volume || stored
  );
  const candidates = [expected?.volume, stored].filter((v) => v > 0);
  if (cap > 0) {
    const fitting = candidates.filter(
      (v) => v <= cap + TOLERANCIA_TANQUE_CHEIO_L
    );
    if (fitting.length > 0) return roundVolume(Math.max(...fitting));
    return cap;
  }
  if (expected?.volume > 0) return expected.volume;
  return stored;
}

/**
 * Corrige item de saída cujo volume foi gravado com o tanque duplicado
 * (10.000 L em tanque de 5.000 L).
 */
export function alignSaidaItemVolumeToVasilhame(
  item,
  vasilhame,
  transbordos = []
) {
  if (!saidaItemEhTanque(item) || !vasilhame) return item;
  const tankVol = volumeTanqueParaSaida(vasilhame, transbordos);
  if (!(tankVol > 0)) return item;
  const asked = roundVolume(item.volume_solicitado || 0);
  if (!(asked > 0)) return item;
  const doubled =
    Math.abs(asked - 2 * tankVol) < 1 ||
    (Math.abs(asked - 10000) < 1 && Math.abs(tankVol - 5000) < 1);
  const exceeds = asked > tankVol + 1;
  if (!doubled && !exceeds) return item;

  const dens = parseDensidade(vasilhame.densidade);
  const massa =
    dens > 0
      ? roundMass(tankVol * dens)
      : roundMass(
          ((Number(item.peso_liquido) || 0) * tankVol) / (asked || tankVol)
        );
  const disp = roundVolume(item.volume_disponivel || 0);
  return {
    ...item,
    volume_solicitado: tankVol,
    volume_disponivel:
      Math.abs(disp - 2 * tankVol) < 1 ||
      Math.abs(disp - 10000) < 1 ||
      disp > tankVol + 1
        ? tankVol
        : disp > 0
          ? Math.min(disp, tankVol)
          : tankVol,
    peso_liquido: massa,
    quantidade_solicitada: massa,
    saldo_final: 0,
  };
}

/**
 * Alinha volumes de saídas pendentes ao volume real dos tanques.
 */
export async function healSaidaVolumesFromVasilhames({
  saidas = [],
  vasilhames = [],
  transbordos = [],
  entitiesApi,
} = {}) {
  const byId = new Map(
    (vasilhames || []).filter((v) => v?.id).map((v) => [String(v.id), v])
  );
  const byPlaca = new Map();
  for (const v of vasilhames || []) {
    const p = String(v.placa || "").trim().toUpperCase();
    if (!p) continue;
    const prev = byPlaca.get(p);
    if (!prev) {
      byPlaca.set(p, v);
      continue;
    }
    const prevPatio =
      (prev.status || "No Pátio") === "No Pátio" && !prev.data_saida;
    const nextPatio =
      (v.status || "No Pátio") === "No Pátio" && !v.data_saida;
    if (nextPatio && !prevPatio) byPlaca.set(p, v);
  }

  const updates = [];
  const nextSaidas = [];

  for (const saida of saidas || []) {
    let changed = false;
    const itens = (saida.itens || []).map((item) => {
      const v =
        (item.vasilhame_id ? byId.get(String(item.vasilhame_id)) : null) ||
        byPlaca.get(
          String(item.vasilhame_placa || "").trim().toUpperCase()
        );
      const aligned = alignSaidaItemVolumeToVasilhame(item, v, transbordos);
      if (aligned !== item) changed = true;
      return aligned;
    });
    if (!changed) {
      nextSaidas.push(saida);
      continue;
    }
    const quantidade_total = roundMass(
      itens.reduce(
        (s, it) =>
          s +
          (Number(it.peso_liquido) || Number(it.quantidade_solicitada) || 0),
        0
      )
    );
    updates.push({ id: saida.id, itens, quantidade_total });
    nextSaidas.push({ ...saida, itens, quantidade_total });
  }

  if (entitiesApi?.saidas?.bulkUpdate && updates.length > 0) {
    await entitiesApi.saidas.bulkUpdate(updates);
  }

  return { saidas: nextSaidas, updates };
}

export { placaKey };
