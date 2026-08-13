/**
 * Cálculo de saldo de tankagem a partir do histórico de transbordos
 * e sincronização do registro em vasilhames (volume + composição por lote).
 */

import { roundVolume, roundMass, parseDensidade } from "@transbordo/lib/format";
import { calculateFIFOAllocation, expandOrigensForFifo } from "@transbordo/lib/fifo";
import { getDominantLote } from "@transbordo/lib/vasilhameComposicao";

function normPlaca(v) {
  return String(v || "")
    .trim()
    .toUpperCase();
}

function transbordoTimestamp(t) {
  const raw = t?.created_at || t?.created_date || t?.data;
  const ms = new Date(raw || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function transbordoSeq(t) {
  const code = String(t?.codigo_transbordo || t?.codigo || "");
  const m = code.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

/** Ordem cronológica real (created_at). `data` sozinha empata OPs do mesmo dia. */
function sortTransbordosChrono(transbordos = []) {
  return [...(transbordos || [])].sort((a, b) => {
    const dt = transbordoTimestamp(a) - transbordoTimestamp(b);
    if (dt !== 0) return dt;
    return transbordoSeq(a) - transbordoSeq(b);
  });
}

/** True se destino/origem se refere à tanka (por id ou código). */
export function matchesTanka(ref, isotanqueId, tankaCodigo) {
  if (!ref) return false;
  if (isotanqueId && (ref.tanka_id === isotanqueId || ref.entrada_id === isotanqueId)) {
    return true;
  }
  const codigo = normPlaca(tankaCodigo);
  if (!codigo) return false;
  return (
    normPlaca(ref.tanka_codigo) === codigo ||
    normPlaca(ref.entrada_codigo) === codigo
  );
}

function addLote(map, lote, volume) {
  const vol = roundVolume(volume);
  if (vol <= 0) return;
  const key = (lote || "").trim() || "—";
  map.set(key, roundVolume((map.get(key) || 0) + vol));
}

function subtractLote(map, lote, volume) {
  const vol = roundVolume(volume);
  if (vol <= 0) return;
  const key = (lote || "").trim() || "—";
  if (map.has(key)) {
    map.set(key, roundVolume((map.get(key) || 0) - vol));
    return;
  }
  // Lote não encontrado → baixa FIFO nos lotes existentes
  subtractFifo(map, vol);
}

function subtractFifo(map, volume) {
  let remaining = roundVolume(volume);
  if (remaining <= 0) return;
  for (const [key, qty] of map) {
    if (remaining <= 0) break;
    const take = Math.min(roundVolume(qty), remaining);
    map.set(key, roundVolume(qty - take));
    remaining -= take;
  }
}

function applyOrigemSaida(map, o) {
  const lotes = (o.lotes_retirados || []).filter(
    (l) => roundVolume(l.volume_retirado || 0) > 0
  );
  let subtracted = 0;
  if (lotes.length > 0) {
    for (const l of lotes) {
      const vol = roundVolume(l.volume_retirado);
      subtractLote(map, l.lote, vol);
      subtracted += vol;
    }
  }
  const volTotal = roundVolume(o.volume_retirado || 0);
  const leftover = volTotal - subtracted;
  if (leftover <= 0) return;
  if (lotes.length === 0 && (o.lote || "").trim()) {
    subtractLote(map, o.lote, leftover);
    return;
  }
  subtractFifo(map, leftover);
}

function applyTankaFillFromTransbordo(map, t, isotanqueId, tankaCodigo) {
  const destinos = t.destinos || [];
  const indices = [];
  destinos.forEach((d, i) => {
    if (
      d.tipo_embalagem === "Tankagem" &&
      matchesTanka(d, isotanqueId, tankaCodigo)
    ) {
      indices.push(i);
    }
  });
  if (indices.length === 0) return;

  const dens = parseDensidade(t.densidade);
  const origensFifo = expandOrigensForFifo(t.origens || [], dens);
  const { destinoCompositions } = calculateFIFOAllocation(
    origensFifo,
    destinos,
    dens
  );

  for (const i of indices) {
    const comp = destinoCompositions[i] || [];
    if (comp.length > 0) {
      for (const c of comp) {
        addLote(map, c.lote, c.quantidade_l);
      }
    } else {
      // Fallback: rateia o volume do destino pelas origens do OP
      const d = destinos[i];
      const volDest = roundVolume(d.volume_total || d.volume || 0);
      const origens = origensFifo;
      const totalOrig = roundVolume(
        origens.reduce((s, o) => s + (o.volume_retirado || 0), 0)
      );
      if (origens.length === 0 || totalOrig <= 0) {
        addLote(map, "", volDest);
        continue;
      }
      let remaining = volDest;
      origens.forEach((o, oi) => {
        if (remaining <= 0) return;
        const oVol = roundVolume(o.volume_retirado || 0);
        const share =
          oi === origens.length - 1
            ? remaining
            : Math.min(remaining, roundVolume((oVol / totalOrig) * volDest));
        addLote(map, o.lote, share);
        remaining -= share;
      });
    }
  }
}

/**
 * Volume líquido da tanka: Σ destinos Tankagem − Σ origens tipo tanka.
 */
export function computeTankaSaldo({
  isotanqueId,
  tankaCodigo = "",
  transbordos = [],
  excludeTransbordoId = null,
  extraOrigens = [],
  extraDestinos = [],
}) {
  let entrada = 0;
  let saida = 0;

  for (const t of transbordos) {
    if (excludeTransbordoId && t.id === excludeTransbordoId) continue;

    for (const d of t.destinos || []) {
      if (
        d.tipo_embalagem === "Tankagem" &&
        matchesTanka(d, isotanqueId, tankaCodigo)
      ) {
        entrada += roundVolume(d.volume_total || d.volume || 0);
      }
    }
    for (const o of t.origens || []) {
      if (
        o.tipo_origem === "tanka" &&
        matchesTanka(o, isotanqueId, tankaCodigo)
      ) {
        saida += roundVolume(o.volume_retirado || 0);
      }
    }
  }

  for (const d of extraDestinos) {
    if (
      d.tipo_embalagem === "Tankagem" &&
      matchesTanka(d, isotanqueId, tankaCodigo)
    ) {
      entrada += roundVolume(d.volume_total || d.volume || 0);
    }
  }
  for (const o of extraOrigens) {
    if (
      o.tipo_origem === "tanka" &&
      matchesTanka(o, isotanqueId, tankaCodigo)
    ) {
      saida += roundVolume(o.volume_retirado || 0);
    }
  }

  return roundVolume(entrada - saida);
}

/**
 * Saldo por lote na tanka (ordem cronológica de entrada — FIFO).
 * @returns {{ lote: string, quantidade_l: number }[]}
 */
export function computeTankaLotesDisponiveis({
  isotanqueId,
  tankaCodigo = "",
  transbordos = [],
  excludeTransbordoId = null,
  extraOrigens = [],
  extraDestinos = [],
}) {
  const map = new Map();

  const sorted = sortTransbordosChrono(transbordos);

  for (const t of sorted) {
    if (excludeTransbordoId && t.id === excludeTransbordoId) continue;
    applyTankaFillFromTransbordo(map, t, isotanqueId, tankaCodigo);
    for (const o of t.origens || []) {
      if (
        o.tipo_origem === "tanka" &&
        matchesTanka(o, isotanqueId, tankaCodigo)
      ) {
        applyOrigemSaida(map, o);
      }
    }
  }

  if (extraDestinos.length > 0) {
    applyTankaFillFromTransbordo(
      map,
      { origens: extraOrigens, destinos: extraDestinos, densidade: 0 },
      isotanqueId,
      tankaCodigo
    );
  }
  for (const o of extraOrigens) {
    if (
      o.tipo_origem === "tanka" &&
      matchesTanka(o, isotanqueId, tankaCodigo)
    ) {
      applyOrigemSaida(map, o);
    }
  }

  return [...map.entries()]
    .map(([key, quantidade_l]) => ({
      lote: key === "—" ? "" : key,
      quantidade_l: roundVolume(quantidade_l),
    }))
    .filter((r) => r.quantidade_l > 0);
}

/**
 * Metadados de envase por lote (primeira data + operadores do OP de entrada).
 */
function collectLoteEnvaseMeta(transbordos, isotanqueId, tankaCodigo) {
  const meta = new Map();
  const sorted = sortTransbordosChrono(transbordos);

  for (const t of sorted) {
    const destinos = t.destinos || [];
    const indices = [];
    destinos.forEach((d, i) => {
      if (
        d.tipo_embalagem === "Tankagem" &&
        matchesTanka(d, isotanqueId, tankaCodigo)
      ) {
        indices.push(i);
      }
    });
    if (indices.length === 0) continue;

    const dens = parseDensidade(t.densidade);
    const origensFifo = expandOrigensForFifo(t.origens || [], dens);
    const { destinoCompositions } = calculateFIFOAllocation(
      origensFifo,
      destinos,
      dens
    );
    const operadores = (t.operadores || []).filter(Boolean);
    const dataEnvase = t.data || null;

    for (const i of indices) {
      const comp = destinoCompositions[i] || [];
      const lotes =
        comp.length > 0
          ? comp.map((c) => (c.lote || "").trim() || "—")
          : (t.origens || [])
              .map((o) => (o.lote || "").trim() || "—")
              .filter(Boolean);
      const keys = lotes.length > 0 ? lotes : ["—"];
      for (const key of keys) {
        if (meta.has(key)) continue;
        meta.set(key, {
          data_envase: dataEnvase,
          operadores,
          transbordo_codigo: t.codigo_transbordo || "",
        });
      }
    }
  }
  return meta;
}

/**
 * Detalhe completo da tanka para visualização (lotes, massa, envase, OP).
 */
export function buildTankaDetalhe({ isotanque, transbordos = [] }) {
  if (!isotanque) return null;

  const isotanqueId = isotanque.id;
  const tankaCodigo = isotanque.tanka || isotanque.codigo_itku || "";

  const fillings = [...(transbordos || [])]
    .filter((t) =>
      (t.destinos || []).some(
        (d) =>
          d.tipo_embalagem === "Tankagem" &&
          matchesTanka(d, isotanqueId, tankaCodigo)
      )
    )
    .sort((a, b) => {
      const dt = transbordoTimestamp(b) - transbordoTimestamp(a);
      if (dt !== 0) return dt;
      return transbordoSeq(b) - transbordoSeq(a);
    });

  const latest = fillings[0];
  const dens =
    parseDensidade(latest?.densidade) ||
    parseDensidade(isotanque.densidade) ||
    0;

  const volumeAtual = computeTankaSaldo({
    isotanqueId,
    tankaCodigo,
    transbordos,
  });

  const lotesSaldo = computeTankaLotesDisponiveis({
    isotanqueId,
    tankaCodigo,
    transbordos,
  });

  const loteMeta = collectLoteEnvaseMeta(transbordos, isotanqueId, tankaCodigo);

  const lotes = lotesSaldo
    .map((l) => {
      const key = (l.lote || "").trim() || "—";
      const meta = loteMeta.get(key) || loteMeta.get("—") || {};
      const volume = roundVolume(l.quantidade_l || 0);
      return {
        lote: l.lote || "—",
        volume,
        massa: dens > 0 ? roundMass(volume * dens) : 0,
        data_envase: meta.data_envase || null,
        operadores: meta.operadores || [],
        transbordo_codigo: meta.transbordo_codigo || "",
      };
    })
    .sort((a, b) => b.volume - a.volume);

  const historico = fillings.map((t) => {
    const destinosMatch = (t.destinos || []).filter(
      (d) =>
        d.tipo_embalagem === "Tankagem" &&
        matchesTanka(d, isotanqueId, tankaCodigo)
    );
    const volume = destinosMatch.reduce(
      (s, d) => s + roundVolume(d.volume_total || d.volume || 0),
      0
    );
    return {
      codigo: t.codigo_transbordo || "",
      data: t.data || null,
      produto_nome: t.produto_nome || "",
      cliente_nome: t.cliente_nome || "",
      volume,
      massa: dens > 0 ? roundMass(volume * dens) : roundMass(t.massa_total || 0),
      operadores: t.operadores || [],
      lotes: (t.origens || [])
        .map((o) => o.lote)
        .filter(Boolean)
        .join(", "),
    };
  });

  return {
    id: isotanqueId,
    tanka: tankaCodigo,
    codigo_itku: isotanque.codigo_itku || "",
    produto_nome:
      isotanque.produto_nome || latest?.produto_nome || "",
    produto_codigo:
      isotanque.produto_codigo || latest?.produto_codigo || "",
    cliente_nome: isotanque.cliente_nome || latest?.cliente_nome || "",
    densidade: dens || latest?.densidade || isotanque.densidade || "",
    capacidade: roundVolume(isotanque.capacidade || 0),
    volume_atual: volumeAtual,
    massa_atual: dens > 0 ? roundMass(volumeAtual * dens) : 0,
    lotes,
    historico,
  };
}

function findTankaVasilhameMatches(list, placas) {
  return (list || []).filter((v) => {
    if (v.tipo !== "Tankagem") return false;
    if (!placas.has(normPlaca(v.placa))) return false;
    const status = v.status || (v.data_saida ? "Expedido" : "No Pátio");
    return status === "No Pátio" || roundVolume(v.volume || 0) > 0;
  });
}

/**
 * Após origem tankagem: atualiza volume + composição nos vasilhames Tankagem.
 * Zera e expede quando o saldo chega a 0; baixa parcial mantém No Pátio.
 */
export async function syncTankaVasilhamesAfterOrigem({
  origens = [],
  destinos = [],
  dataSaida,
  isotanques = [],
  transbordos = [],
  editingTransbordoId = null,
  entities,
  vasilhamesList = null,
}) {
  const tankaOrigens = origens.filter(
    (o) => o.tipo_origem === "tanka" && o.entrada_id
  );
  if (tankaOrigens.length === 0 || !entities?.vasilhames) return;

  const seen = new Set();
  const list = vasilhamesList || (await entities.vasilhames.list());

  for (const o of tankaOrigens) {
    if (seen.has(o.entrada_id)) continue;
    seen.add(o.entrada_id);

    const iso = isotanques.find((i) => i.id === o.entrada_id);
    const tankaCodigo = iso?.tanka || o.entrada_codigo || "";
    const dens =
      parseDensidade(iso?.densidade || o.densidade) ||
      parseFloat(String(iso?.densidade || o.densidade || "0").replace(",", ".")) ||
      0;

    const remaining = computeTankaSaldo({
      isotanqueId: o.entrada_id,
      tankaCodigo,
      transbordos,
      excludeTransbordoId: editingTransbordoId,
      extraOrigens: origens,
      extraDestinos: destinos,
    });

    const lotesRestantes = computeTankaLotesDisponiveis({
      isotanqueId: o.entrada_id,
      tankaCodigo,
      transbordos,
      excludeTransbordoId: editingTransbordoId,
      extraOrigens: origens,
      extraDestinos: destinos,
    });

    const placas = new Set(
      [tankaCodigo, iso?.tanka, iso?.codigo_itku, o.entrada_codigo]
        .filter(Boolean)
        .map(normPlaca)
    );

    const matches = findTankaVasilhameMatches(list, placas);
    if (matches.length === 0) continue;

    const sorted = [...matches].sort((a, b) => {
      const da = new Date(a.created_at || a.created_date || 0).getTime();
      const db = new Date(b.created_at || b.created_date || 0).getTime();
      return da - db;
    });
    const primary = sorted[0];
    const others = sorted.slice(1);

    const composicao = lotesRestantes.map((l) => ({
      lote: l.lote,
      quantidade_l: l.quantidade_l,
      quantidade_kg: dens > 0 ? roundMass(l.quantidade_l * dens) : 0,
    }));
    const lote = getDominantLote(composicao) || lotesRestantes[0]?.lote || "";
    const peso =
      dens > 0
        ? roundMass(remaining * dens)
        : roundMass(
            composicao.reduce((s, c) => s + (c.quantidade_kg || 0), 0)
          );

    if (remaining <= 0) {
      for (const v of matches) {
        const patch = {
          volume: 0,
          peso_liquido: 0,
          peso_bruto: roundMass(v.tara || 0),
          composicao: [],
          lote: v.lote || lote || "",
          data_saida: dataSaida || null,
          status: "Expedido",
        };
        await entities.vasilhames.update(v.id, patch);
        Object.assign(v, patch);
      }
      continue;
    }

    const primaryPatch = {
      volume: remaining,
      peso_liquido: peso,
      peso_bruto: roundMass((primary.tara || 0) + peso),
      composicao,
      lote,
      status: "No Pátio",
      data_saida: null,
    };
    await entities.vasilhames.update(primary.id, primaryPatch);
    Object.assign(primary, primaryPatch);

    // Consolida duplicatas: saldo fica só no registro principal
    for (const v of others) {
      const patch = {
        volume: 0,
        peso_liquido: 0,
        peso_bruto: roundMass(v.tara || 0),
        composicao: [],
        status: "Expedido",
        data_saida: dataSaida || null,
      };
      await entities.vasilhames.update(v.id, patch);
      Object.assign(v, patch);
    }
  }
}

/** @deprecated use syncTankaVasilhamesAfterOrigem */
export async function syncEmptyTankaVasilhames(opts) {
  return syncTankaVasilhamesAfterOrigem(opts);
}

/**
 * Após excluir (ou excluir logicamente) um transbordo, recalcula o volume
 * das tankas usadas como origem e restaura o registro em vasilhames.
 */
export async function restoreTankaVasilhamesAfterExclude({
  origens = [],
  excludeTransbordoId,
  isotanques = [],
  transbordos = [],
  entities,
  vasilhamesList = null,
}) {
  const tankaOrigens = origens.filter(
    (o) => o.tipo_origem === "tanka" && o.entrada_id
  );
  if (tankaOrigens.length === 0 || !entities?.vasilhames) return;

  const seen = new Set();
  const list = vasilhamesList || (await entities.vasilhames.list());

  for (const o of tankaOrigens) {
    if (seen.has(o.entrada_id)) continue;
    seen.add(o.entrada_id);

    const iso = isotanques.find((i) => i.id === o.entrada_id);
    const tankaCodigo = iso?.tanka || o.entrada_codigo || "";

    const remaining = computeTankaSaldo({
      isotanqueId: o.entrada_id,
      tankaCodigo,
      transbordos,
      excludeTransbordoId,
    });

    const lotesRestantes = computeTankaLotesDisponiveis({
      isotanqueId: o.entrada_id,
      tankaCodigo,
      transbordos,
      excludeTransbordoId,
    });

    const placas = new Set(
      [tankaCodigo, iso?.tanka, iso?.codigo_itku, o.entrada_codigo]
        .filter(Boolean)
        .map(normPlaca)
    );

    const matches = (list || []).filter((v) => {
      if (v.tipo !== "Tankagem") return false;
      return placas.has(normPlaca(v.placa));
    });

    const dens =
      parseDensidade(iso?.densidade || o.densidade) ||
      parseFloat(String(iso?.densidade || o.densidade || "0").replace(",", ".")) ||
      0;

    if (matches.length === 0) continue;

    const sorted = [...matches].sort((a, b) => {
      const da = new Date(a.created_at || a.created_date || 0).getTime();
      const db = new Date(b.created_at || b.created_date || 0).getTime();
      return da - db;
    });
    const primary = sorted[0];
    const others = sorted.slice(1);

    const composicao = lotesRestantes.map((l) => ({
      lote: l.lote,
      quantidade_l: l.quantidade_l,
      quantidade_kg: dens > 0 ? roundMass(l.quantidade_l * dens) : 0,
    }));
    const lote = getDominantLote(composicao) || lotesRestantes[0]?.lote || primary.lote || "";
    const peso =
      dens > 0 ? roundMass(remaining * dens) : roundMass(primary.peso_liquido || 0);

    const primaryPatch = {
      volume: Math.max(0, remaining),
      peso_liquido: remaining > 0 ? peso : 0,
      peso_bruto: roundMass((primary.tara || 0) + (remaining > 0 ? peso : 0)),
      composicao: remaining > 0 ? composicao : [],
      lote,
    };
    if (remaining > 0) {
      primaryPatch.status = "No Pátio";
      primaryPatch.data_saida = null;
    } else {
      primaryPatch.status = "Expedido";
    }
    await entities.vasilhames.update(primary.id, primaryPatch);
    Object.assign(primary, primaryPatch);

    for (const v of others) {
      const patch = {
        volume: 0,
        peso_liquido: 0,
        peso_bruto: roundMass(v.tara || 0),
        composicao: [],
        status: "Expedido",
      };
      await entities.vasilhames.update(v.id, patch);
      Object.assign(v, patch);
    }
  }
}
