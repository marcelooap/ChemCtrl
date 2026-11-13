/**
 * Resolução operacional de densidade: entrada/lote prevalece sobre o
 * cadastro do produto (exceto densidade_tabelada).
 *
 * Corrige OPs e vasilhames gravados com dens do produto (ex.: 1,07)
 * quando a entrada do lote tem a dens correta (ex.: 0,7908).
 */

import {
  parseDensidade,
  roundMass,
  roundVolume,
} from "@transbordo/lib/format";
import { alignComposicaoKgToDensidade } from "@transbordo/lib/vasilhameComposicao";

function sameLote(a, b) {
  return String(a || "").trim() === String(b || "").trim();
}

/** Densidade efetiva de uma entrada / estoque (header ou lotes). */
export function densFromEntradaOrLotes(entrada) {
  if (!entrada) return 0;
  const header = parseDensidade(entrada.densidade);
  if (header > 0) return header;
  for (const lote of entrada.lotes || []) {
    const d = parseDensidade(lote?.densidade);
    if (d > 0) return d;
  }
  return 0;
}

/** Densidade do lote na entrada/estoque (prioriza o lote; cai no header). */
export function densFromEntradasByLote(lote, entradas = []) {
  const key = String(lote || "").trim();
  if (!key) return 0;
  for (const entrada of entradas || []) {
    const lotes = Array.isArray(entrada?.lotes) ? entrada.lotes : [];
    for (const row of lotes) {
      if (!sameLote(row?.lote, key)) continue;
      const d =
        parseDensidade(row?.densidade) || densFromEntradaOrLotes(entrada);
      if (d > 0) return d;
    }
    if (sameLote(entrada?.lote, key)) {
      const d = densFromEntradaOrLotes(entrada);
      if (d > 0) return d;
    }
  }
  return 0;
}

function lotesFromOrigens(origens = []) {
  const keys = [];
  for (const o of origens || []) {
    const header = String(o?.lote || "").trim();
    if (header) keys.push(header);
    for (const l of o?.lotes_retirados || []) {
      const k = String(l?.lote || "").trim();
      if (k) keys.push(k);
    }
  }
  return keys;
}

function findProduto(produtos = [], { produto_id, produto_codigo } = {}) {
  if (produto_id != null && produto_id !== "") {
    const byId = produtos.find((p) => String(p.id) === String(produto_id));
    if (byId) return byId;
  }
  if (produto_codigo) {
    return produtos.find(
      (p) =>
        p.codigo && String(p.codigo) === String(produto_codigo)
    );
  }
  return null;
}

/**
 * Densidade operacional para um OP de transbordo.
 * Ordem: produto tabelado → entrada(s) das origens → lote nas entradas → OP → produto.
 */
export function resolveDensidadeOperacional({
  densidade,
  produto = null,
  produtos = [],
  entradas = [],
  origens = [],
  lote = null,
} = {}) {
  const prod =
    produto ||
    findProduto(produtos, {
      produto_id: origens?.[0]?.produto_id,
      produto_codigo: null,
    });

  if (prod?.densidade_tabelada) {
    const d =
      parseDensidade(prod.densidade) || parseDensidade(densidade);
    if (d > 0) return d;
  }

  for (const o of origens || []) {
    if (!o?.entrada_id) continue;
    if (o.tipo_origem === "tanka") continue;
    const entrada = (entradas || []).find(
      (e) => String(e.id) === String(o.entrada_id)
    );
    const d = densFromEntradaOrLotes(entrada);
    if (d > 0) return d;
  }

  const loteKeys = [
    ...(lote ? [String(lote).trim()] : []),
    ...lotesFromOrigens(origens),
  ].filter(Boolean);

  for (const key of loteKeys) {
    const d = densFromEntradasByLote(key, entradas);
    if (d > 0) return d;
  }

  const fromOp = parseDensidade(densidade);
  if (fromOp > 0) return fromOp;

  return parseDensidade(prod?.densidade) || 0;
}

/**
 * Densidade operacional do vasilhame: entrada do lote > OP ligado > cadastro.
 */
export function resolveDensidadeVasilhame({
  vasilhame,
  produto = null,
  produtos = [],
  entradas = [],
  transbordos = [],
} = {}) {
  const prod =
    produto ||
    findProduto(produtos, {
      produto_id: vasilhame?.produto_id,
      produto_codigo: vasilhame?.produto_codigo,
    });

  if (prod?.densidade_tabelada) {
    const d =
      parseDensidade(prod.densidade) || parseDensidade(vasilhame?.densidade);
    if (d > 0) return d;
  }

  const loteKeys = [
    String(vasilhame?.lote || "").trim(),
    ...(vasilhame?.composicao || []).map((c) => String(c?.lote || "").trim()),
  ].filter(Boolean);

  for (const key of loteKeys) {
    const d = densFromEntradasByLote(key, entradas);
    if (d > 0) return d;
  }

  for (const t of transbordos || []) {
    const hitsDest = (t.destinos || []).some(
      (d) =>
        (vasilhame?.id && String(d.vasilhame_id) === String(vasilhame.id)) ||
        (vasilhame?.placa &&
          String(d.placa || "").trim().toUpperCase() ===
            String(vasilhame.placa || "").trim().toUpperCase())
    );
    if (!hitsDest) continue;
    const d = resolveDensidadeOperacional({
      densidade: t.densidade,
      produto: prod,
      produtos,
      entradas,
      origens: t.origens,
      lote: vasilhame?.lote,
    });
    if (d > 0) return d;
  }

  const fromVas = parseDensidade(vasilhame?.densidade);
  if (fromVas > 0) return fromVas;
  return parseDensidade(prod?.densidade) || 0;
}

function densChanged(a, b) {
  return Math.abs(parseDensidade(a) - parseDensidade(b)) > 1e-6;
}

/**
 * Recalcula massa do OP a partir da densidade resolvida.
 * Retorna patch parcial ou null se já estiver coerente.
 */
export function healTransbordoDensidadeMassaPatch(
  transbordo,
  { produtos = [], entradas = [] } = {}
) {
  if (!transbordo?.id) return null;
  const dens = resolveDensidadeOperacional({
    densidade: transbordo.densidade,
    produtos,
    produto: findProduto(produtos, {
      produto_id: transbordo.produto_id,
      produto_codigo: transbordo.produto_codigo,
    }),
    entradas,
    origens: transbordo.origens,
  });
  if (!(dens > 0)) return null;

  const densAtual = parseDensidade(transbordo.densidade);
  const vol = roundVolume(transbordo.volume_total || 0);
  const massaAtual = roundMass(transbordo.massa_total || 0);
  const massaAlvo = vol > 0 ? roundMass(vol * dens) : massaAtual;

  const origens = (transbordo.origens || []).map((o) => {
    const oVol = roundVolume(o.volume_retirado || 0);
    const massa =
      oVol > 0
        ? roundMass(oVol * dens)
        : roundMass(o.massa_retirada || 0);
    const lotes_retirados = Array.isArray(o.lotes_retirados)
      ? o.lotes_retirados.map((l) => {
          const lVol = roundVolume(l.volume_retirado || 0);
          return {
            ...l,
            massa_retirada:
              lVol > 0 ? roundMass(lVol * dens) : roundMass(l.massa_retirada || 0),
          };
        })
      : o.lotes_retirados;
    return { ...o, massa_retirada: massa, ...(lotes_retirados ? { lotes_retirados } : {}) };
  });

  const destinos = (transbordo.destinos || []).map((d) => {
    const dVol = roundVolume(d.volume_total || d.volume || 0);
    const peso =
      dVol > 0 ? roundMass(dVol * dens) : roundMass(d.peso_liquido || 0);
    return {
      ...d,
      peso_liquido: peso,
      peso_bruto: roundMass((Number(d.tara) || 0) + peso),
    };
  });

  const needsDens = densChanged(densAtual, dens) || !(densAtual > 0);
  const needsMassa =
    Math.abs(massaAtual - massaAlvo) > 0.001 ||
    !(massaAtual > 0) ||
    origens.some(
      (o, i) =>
        Math.abs(
          roundMass(o.massa_retirada || 0) -
            roundMass(transbordo.origens?.[i]?.massa_retirada || 0)
        ) > 0.001
    ) ||
    destinos.some(
      (d, i) =>
        Math.abs(
          roundMass(d.peso_liquido || 0) -
            roundMass(transbordo.destinos?.[i]?.peso_liquido || 0)
        ) > 0.001
    );

  if (!needsDens && !needsMassa) return null;

  return {
    densidade: String(dens),
    massa_total: massaAlvo,
    origens,
    destinos,
  };
}

/**
 * Alinha densidade + peso líquido do vasilhame à dens da entrada do lote.
 */
export function healVasilhameDensidadeMassaPatch(
  vasilhame,
  { produtos = [], entradas = [], transbordos = [] } = {}
) {
  if (!vasilhame?.id) return null;
  const tipo = vasilhame.tipo || "Vasilhame";
  if (tipo !== "Vasilhame" && tipo !== "Tankagem") return null;

  const dens = resolveDensidadeVasilhame({
    vasilhame,
    produtos,
    entradas,
    transbordos,
  });
  if (!(dens > 0)) return null;

  const volume = roundVolume(
    vasilhame.volume ||
      (vasilhame.composicao || []).reduce(
        (s, c) => s + (Number(c.quantidade_l) || 0),
        0
      )
  );
  if (!(volume > 0)) return null;

  const composicao = Array.isArray(vasilhame.composicao)
    ? vasilhame.composicao
    : [];
  const aligned =
    composicao.length > 0
      ? alignComposicaoKgToDensidade(composicao, dens, volume)
      : composicao;
  const pesoAlvo = roundMass(volume * dens);
  const pesoAtual = roundMass(vasilhame.peso_liquido || 0);
  const densAtual = parseDensidade(vasilhame.densidade);
  const tara = roundMass(vasilhame.tara || 0);

  const sameDens = !densChanged(densAtual, dens) && densAtual > 0;
  const sameKg = Math.abs(pesoAtual - pesoAlvo) < 0.001;
  const sameComp =
    composicao.length === 0 ||
    JSON.stringify(composicao.map((c) => [c.quantidade_l, c.quantidade_kg])) ===
      JSON.stringify(aligned.map((c) => [c.quantidade_l, c.quantidade_kg]));

  if (sameDens && sameKg && sameComp) return null;

  return {
    densidade: String(dens),
    ...(composicao.length > 0 ? { composicao: aligned } : {}),
    peso_liquido: pesoAlvo,
    peso_bruto: roundMass(tara + pesoAlvo),
  };
}
