/**
 * Utilitários de composição de lotes em vasilhames (fracionamento / top-up).
 */

import { roundVolume, roundMass } from "@chemflow/lib/format";

const TIPOS_NAO_VASILHAME = new Set([
  "Tankagem",
  "One Way (IBC)",
  "Bombona 200 L",
  "Tambor 200 L",
]);

/** Rótulo sintético — só quando há residual sem lote real atribuível. */
export const LOTE_APORTE_ANTERIOR = "Aporte anterior";

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

/**
 * Reconstrói composição a partir dos transbordos que enviaram volume a esta placa.
 * @param {{ alignToVolume?: boolean }} options — se false, não padra entries ao volume do tanque
 *   (útil ao corrigir volume inflado por "Aporte anterior" sintético).
 */
export function rebuildComposicaoFromTransbordos(
  vasilhame,
  transbordos = [],
  options = {}
) {
  const { alignToVolume = true } = options;
  if (!vasilhame?.placa) return seedComposicaoFromVasilhame(vasilhame);

  const placa = String(vasilhame.placa).trim().toUpperCase();
  const barril = String(vasilhame.barril || "").trim().toUpperCase();
  const entries = [];

  const sorted = [...(transbordos || [])].sort(
    (a, b) =>
      new Date(a.data || a.created_at || 0) -
      new Date(b.data || b.created_at || 0)
  );

  for (const t of sorted) {
    const dens =
      parseFloat(
        String(t.densidade || vasilhame.densidade || "0").replace(",", ".")
      ) || 0;
    (t.destinos || []).forEach((d, destinoIndex) => {
      if (d.tipo_embalagem && d.tipo_embalagem !== "Vasilhame") return;
      const dPlaca = String(d.placa || "").trim().toUpperCase();
      if (dPlaca !== placa) return;
      const dBarril = String(d.barril || "").trim().toUpperCase();
      if (barril && dBarril && barril !== dBarril) return;

      const volDest = roundVolume(d.volume_total || d.volume || 0);
      if (volDest <= 0) return;

      const origens = t.origens || [];
      const totalOrig = roundVolume(
        origens.reduce((s, o) => s + (o.volume_retirado || 0), 0)
      );

      if (origens.length === 0) {
        entries.push({
          lote: "",
          quantidade_l: volDest,
          quantidade_kg: dens > 0 ? roundMass(volDest * dens) : 0,
          transbordo_codigo: t.codigo_transbordo || null,
          data: t.data || null,
          destino_index: destinoIndex,
        });
        return;
      }

      let remaining = volDest;
      origens.forEach((o, oi) => {
        if (remaining <= 0) return;
        const oVol = roundVolume(o.volume_retirado || 0);
        const share =
          oi === origens.length - 1
            ? remaining
            : Math.min(
                remaining,
                totalOrig > 0
                  ? roundVolume((oVol / totalOrig) * volDest)
                  : oVol
              );
        if (share <= 0) return;
        entries.push({
          lote: o.lote || "",
          quantidade_l: share,
          quantidade_kg:
            dens > 0
              ? roundMass(share * dens)
              : roundMass(o.massa_retirada || 0),
          transbordo_codigo: t.codigo_transbordo || null,
          data: t.data || null,
          destino_index: destinoIndex,
        });
        remaining -= share;
      });
      if (remaining > 0 && entries.length > 0) {
        entries[entries.length - 1].quantidade_l = roundVolume(
          entries[entries.length - 1].quantidade_l + remaining
        );
      }
    });
  }

  if (entries.length === 0) {
    return seedComposicaoFromVasilhame(vasilhame);
  }

  const sum = roundVolume(entries.reduce((s, e) => s + e.quantidade_l, 0));
  const vol = roundVolume(vasilhame.volume || 0);
  if (alignToVolume && vol > 0 && sum !== vol && entries.length > 0) {
    const diff = vol - sum;
    entries[entries.length - 1].quantidade_l = Math.max(
      0,
      roundVolume(entries[entries.length - 1].quantidade_l + diff)
    );
  }

  return entries.filter((e) => e.quantidade_l > 0);
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

/** Mescla composição existente com novas entradas (mantém histórico). */
export function mergeComposicao(existing = [], incoming = [], meta = {}) {
  const base = Array.isArray(existing) ? [...existing] : [];
  const extras = (incoming || []).map((c) => ({
    lote: c.lote || "",
    origem_index: c.origem_index,
    quantidade_l: roundVolume(c.quantidade_l || 0),
    quantidade_kg: roundMass(c.quantidade_kg || 0),
    transbordo_codigo: meta.transbordo_codigo || c.transbordo_codigo || null,
    data: meta.data || c.data || null,
  }));
  return [...base, ...extras].filter((c) => (c.quantidade_l || 0) > 0);
}

/** Remove entradas de composição de um transbordo específico. */
export function removeComposicaoByTransbordo(composicao = [], codigo) {
  if (!codigo) return composicao || [];
  return (composicao || []).filter((c) => c.transbordo_codigo !== codigo);
}

/**
 * Localiza vasilhame fracionado No Pátio pela placa/barril.
 */
export function findFracionadoNoPatio(vasilhames = [], { placa, barril, id } = {}) {
  const noPatio = (vasilhames || []).filter(
    (v) =>
      (v.status || "No Pátio") === "No Pátio" &&
      v.fracionado === true &&
      !TIPOS_NAO_VASILHAME.has(v.tipo || "Vasilhame")
  );

  if (id) {
    const byId = noPatio.find((v) => v.id === id);
    if (byId) return byId;
  }

  const p = String(placa || "").trim();
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
 * Unifica vasilhames duplicados No Pátio (mesma placa+barril).
 */
export async function unifyDuplicateVasilhames(vasilhames, entitiesApi) {
  const isOperacional = (v) =>
    (v.origem === "transbordo" || v.origem === "manual" || v.fracionado === true) &&
    (v.status || "No Pátio") === "No Pátio" &&
    v.placa &&
    !TIPOS_NAO_VASILHAME.has(v.tipo);

  const noPatio = (vasilhames || []).filter(isOperacional);

  const groups = new Map();
  for (const v of noPatio) {
    const k = placaKey(v.placa, v.barril);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }

  const deletedIds = [];
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

    let composicao = seedComposicaoFromVasilhame(primary);
    let volume = roundVolume(primary.volume || 0);

    for (const o of others) {
      volume += roundVolume(o.volume || 0);
      composicao = mergeComposicao(composicao, seedComposicaoFromVasilhame(o));
    }

    volume = roundVolume(volume);
    // Se algum registro já estava completo, o unificado também deixa de ser fracionado
    const fracionado = group.every((v) => v.fracionado === true);
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

  return { kept, deletedIds };
}

export function normalizeVasilhameLote(v) {
  if (!v) return v;
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

  // Composição já bate com o volume e sem aporte sintético → não mexe
  // (protege tanques completados de rebuild agressivo por múltiplos transbordos)
  const composicaoCoerente =
    seeded.length > 0 && compVol === vol && !hasFake;

  // Rebuild só para: composição vazia/incompleta, aporte sintético, ou
  // único lote com vários transbordos (histórico faltando).
  // NÃO altera volume salvo ao limpar aporte sintético (e só para baixo).
  const needsRebuild =
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
      // Só sincroniza volume para baixo ao remover aporte sintético
      if (hasFake && rebuiltSum > 0 && rebuiltSum < vol) {
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

  // Tanque já recebeu mais de um aporte/lote → não é mais fracionado.
  // Só permanece fracionado se o último destino marcou explicitamente.
  const lotesFinais = new Set(
    composicao.map((c) => (c.lote || "").trim()).filter(isLoteReal)
  );
  const uniqueOps = new Set(
    composicao.map((c) => c.transbordo_codigo).filter(Boolean)
  );
  let fracionado = vasilhame.fracionado;

  if (lotesFinais.size > 1 || uniqueOps.size > 1 || transbordosPlaca.length > 1) {
    fracionado = false;
  } else if (transbordosPlaca.length > 0) {
    const lastT = [...transbordosPlaca].sort(
      (a, b) =>
        new Date(b.data || b.created_at || 0) -
        new Date(a.data || a.created_at || 0)
    )[0];
    const lastDest = (lastT?.destinos || []).find(
      (d) =>
        String(d.placa || "").trim().toUpperCase() ===
        String(vasilhame.placa || "").trim().toUpperCase()
    );
    fracionado = lastDest?.fracionado === true;
  }

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

export { placaKey };
