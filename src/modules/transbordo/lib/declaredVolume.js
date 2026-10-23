import { roundQuantidade } from "@transbordo/lib/format";
import { entities } from "@transbordo/services/entities";

const GAL_TO_L = 3.78541;

function normLote(value) {
  return String(value || "").trim().toLowerCase();
}

function isLiterUnit(unidade) {
  const u = String(unidade || "").trim().toLowerCase();
  return u === "l" || u === "lt" || u === "litro" || u === "litros";
}

function isGallonUnit(unidade) {
  const u = String(unidade || "").trim().toLowerCase();
  return (
    u === "gal" ||
    u === "gallon" ||
    u === "gallons" ||
    u === "galão" ||
    u === "galoes" ||
    u === "galões"
  );
}

function hasFraction(n) {
  return Math.abs(n - Math.trunc(n)) > 1e-9;
}

/** Litros declarados no lote, quando a entrada foi em volume e tem fração. */
function declaredLiters(lote, row) {
  const um = lote?.unidade_medida || row?.unidade_medida;
  const qtd = roundQuantidade(
    lote?.quantidade ?? row?.saldo_inicial ?? row?.quantidade
  );
  if (!(qtd > 0) || !hasFraction(qtd)) return 0;
  if (isLiterUnit(um)) return qtd;
  if (isGallonUnit(um)) return roundQuantidade(qtd * GAL_TO_L);
  return 0;
}

function indexDeclaredVolumes(map, row) {
  if (!row) return;
  const lotes =
    Array.isArray(row.lotes) && row.lotes.length > 0 ? row.lotes : [row];
  const found = [];
  for (const lote of lotes) {
    const declared = declaredLiters(lote, row);
    if (!(declared > 0)) continue;
    found.push({
      lote: normLote(lote?.lote || row.lote),
      declared,
    });
  }
  if (found.length === 1 && row.id) map.set(String(row.id), found[0].declared);
  for (const item of found) {
    if (row.id && item.lote) map.set(`${row.id}|${item.lote}`, item.declared);
    if (row.entrada_id && item.lote) {
      map.set(`${row.entrada_id}|${item.lote}`, item.declared);
    }
  }
}

function lookupDeclared(map, id, lote) {
  if (id == null || id === "") return 0;
  const byLote = lote ? map.get(`${id}|${normLote(lote)}`) : 0;
  if (byLote > 0) return byLote;
  return map.get(String(id)) || 0;
}

/**
 * Se o volume gravado é o inteiro de uma quantidade com casa decimal,
 * devolve a quantidade original.
 */
export function restoreDeclaredVolume(stored, declared) {
  const s = roundQuantidade(stored);
  const d = roundQuantidade(declared);
  if (!(d > 0) || !(s > 0) || !hasFraction(d)) return s;
  if (Math.abs(s - d) < 0.0005) return d;
  if (Math.abs(s - Math.round(d)) < 0.0005) return d;
  return s;
}

function replaceExact(value, replacements) {
  const n = roundQuantidade(value);
  const hit = replacements.find((r) => Math.abs(n - r.from) < 0.0005);
  if (!hit) return n;
  return hit.to;
}

/**
 * Reaplica a casa decimal da entrada em transbordos e vasilhames que foram
 * gravados com Math.round (ex.: 19.848,5 → 19.849).
 * Não altera retiradas parciais.
 */
export function applyDeclaredVolumeDecimals({
  estoque = [],
  entradas = [],
  transbordos = [],
  vasilhames = [],
} = {}) {
  const declaredByKey = new Map();
  for (const row of estoque) indexDeclaredVolumes(declaredByKey, row);
  for (const row of entradas) indexDeclaredVolumes(declaredByKey, row);
  // Origem do transbordo aponta para o estoque. Se o lote do estoque já
  // foi gravado inteiro, a fração ainda está na entrada.
  for (const row of estoque) {
    if (!row?.id || declaredByKey.has(String(row.id))) continue;
    const lote =
      (Array.isArray(row.lotes) && row.lotes[0]?.lote) || row.lote;
    const fromEntrada = lookupDeclared(declaredByKey, row.entrada_id, lote);
    if (fromEntrada > 0) declaredByKey.set(String(row.id), fromEntrada);
  }

  const replacements = [];
  const changedTransbordoIds = new Set();
  const transbordoPatches = [];

  const nextTransbordos = (transbordos || []).map((t) => {
    let changed = false;
    const localReplacements = [];
    const origens = (t.origens || []).map((o) => {
      const declared = lookupDeclared(declaredByKey, o.entrada_id, o.lote);
      if (!(declared > 0)) return o;
      const volume = restoreDeclaredVolume(o.volume_retirado, declared);
      const saldo = restoreDeclaredVolume(o.saldo_disponivel, declared);
      let lotesChanged = false;
      const lotesRet = Array.isArray(o.lotes_retirados)
        ? o.lotes_retirados.map((l) => {
            const declaredLote =
              lookupDeclared(declaredByKey, o.entrada_id, l.lote) || declared;
            const vol = restoreDeclaredVolume(l.volume_retirado, declaredLote);
            const saldoLote = restoreDeclaredVolume(l.saldo_disponivel, declaredLote);
            if (
              Math.abs(vol - roundQuantidade(l.volume_retirado)) < 0.0005 &&
              Math.abs(saldoLote - roundQuantidade(l.saldo_disponivel)) < 0.0005
            ) {
              return l;
            }
            lotesChanged = true;
            return { ...l, volume_retirado: vol, saldo_disponivel: saldoLote };
          })
        : o.lotes_retirados;
      const oldVol = roundQuantidade(o.volume_retirado);
      if (
        Math.abs(volume - oldVol) < 0.0005 &&
        Math.abs(saldo - roundQuantidade(o.saldo_disponivel)) < 0.0005 &&
        !lotesChanged
      ) {
        return o;
      }
      changed = true;
      if (Math.abs(volume - oldVol) >= 0.0005) {
        localReplacements.push({
          from: oldVol,
          to: volume,
          lote: normLote(o.lote),
          transbordoId: t.id,
        });
      }
      return {
        ...o,
        volume_retirado: volume,
        saldo_disponivel: Math.abs(saldo - roundQuantidade(o.saldo_disponivel)) >= 0.0005
          ? saldo
          : o.saldo_disponivel,
        ...(lotesRet !== o.lotes_retirados ? { lotes_retirados: lotesRet } : {}),
      };
    });

    if (!changed) return t;

    let destinos = (t.destinos || []).map((d) => {
      const volume = replaceExact(d.volume, localReplacements);
      const volumeTotal = replaceExact(d.volume_total || d.volume, localReplacements);
      if (
        Math.abs(volume - roundQuantidade(d.volume)) < 0.0005 &&
        Math.abs(volumeTotal - roundQuantidade(d.volume_total || d.volume)) < 0.0005
      ) {
        return d;
      }
      return { ...d, volume, volume_total: volumeTotal };
    });

    const volumeTotal = roundQuantidade(
      origens.reduce((s, o) => s + (Number(o.volume_retirado) || 0), 0)
    );
    const oldSum = roundQuantidade(
      (t.origens || []).reduce((s, o) => s + (Number(o.volume_retirado) || 0), 0)
    );
    const destSum = roundQuantidade(
      destinos.reduce((s, d) => s + (Number(d.volume_total || d.volume) || 0), 0)
    );
    if (
      destinos.length > 0 &&
      Math.abs(destSum - volumeTotal) >= 0.0005 &&
      Math.abs(destSum - oldSum) < 0.0005
    ) {
      const delta = roundQuantidade(volumeTotal - destSum);
      const last = destinos[destinos.length - 1];
      const prev = roundQuantidade(last.volume_total || last.volume);
      const nextTotal = roundQuantidade(prev + delta);
      destinos = destinos.slice(0, -1).concat({
        ...last,
        volume: roundQuantidade((Number(last.volume) || prev) + delta),
        volume_total: nextTotal,
      });
      localReplacements.push({
        from: prev,
        to: nextTotal,
        lote: normLote(last.lote || t.origens?.[0]?.lote),
        transbordoId: t.id,
      });
    }
    changedTransbordoIds.add(t.id);
    replacements.push(...localReplacements);
    const next = { ...t, origens, destinos, volume_total: volumeTotal };
    transbordoPatches.push({
      id: t.id,
      origens,
      destinos,
      volume_total: volumeTotal,
    });
    return next;
  });

  const vasilhamePatches = [];
  const nextVasilhames = (vasilhames || []).map((v) => {
    const loteV = normLote(v.lote);
    const applicable = replacements.filter((r) => {
      if (v.transbordo_id && r.transbordoId === v.transbordo_id) return true;
      return (
        !!r.lote &&
        r.lote === loteV &&
        Math.abs(roundQuantidade(v.volume) - r.from) < 0.0005
      );
    });
    if (applicable.length === 0) return v;

    let compChanged = false;
    const composicao = Array.isArray(v.composicao)
      ? v.composicao.map((c) => {
          const hit = applicable.find(
            (r) =>
              Math.abs(roundQuantidade(c.quantidade_l) - r.from) < 0.0005 &&
              (!r.lote || !normLote(c.lote) || r.lote === normLote(c.lote))
          );
          if (!hit) return c;
          compChanged = true;
          return { ...c, quantidade_l: hit.to };
        })
      : v.composicao;

    const volumeFromComp =
      compChanged && Array.isArray(composicao)
        ? roundQuantidade(composicao.reduce((s, c) => s + (Number(c.quantidade_l) || 0), 0))
        : null;
    const volume = volumeFromComp != null
      ? volumeFromComp
      : replaceExact(v.volume, applicable);
    if (
      !compChanged &&
      Math.abs(volume - roundQuantidade(v.volume)) < 0.0005
    ) {
      return v;
    }
    const next = {
      ...v,
      volume,
      ...(compChanged ? { composicao } : {}),
    };
    vasilhamePatches.push({
      id: v.id,
      volume,
      ...(compChanged ? { composicao } : {}),
    });
    return next;
  });

  const estoquePatches = [];
  const nextEstoque = (estoque || []).map((row) => {
    const declared = row?.id ? declaredByKey.get(String(row.id)) || 0 : 0;
    if (!(declared > 0)) return row;
    const stored = roundQuantidade(row.saldo_inicial ?? row.quantidade);
    const quantidade = restoreDeclaredVolume(stored, declared);
    let lotes = row.lotes;
    let lotesChanged = false;
    if (Array.isArray(row.lotes) && row.lotes[0]) {
      const loteQtd = restoreDeclaredVolume(row.lotes[0].quantidade, declared);
      if (Math.abs(loteQtd - roundQuantidade(row.lotes[0].quantidade)) >= 0.0005) {
        lotes = [{ ...row.lotes[0], quantidade: loteQtd }, ...row.lotes.slice(1)];
        lotesChanged = true;
      }
    }
    if (Math.abs(quantidade - stored) < 0.0005 && !lotesChanged) return row;
    const saldo = roundQuantidade(row.saldo_final ?? row.saldo_atual);
    const patch = { id: row.id };
    const next = { ...row };
    if (Math.abs(quantidade - stored) >= 0.0005) {
      patch.saldo_inicial = quantidade;
      next.saldo_inicial = quantidade;
      next.quantidade = quantidade;
    }
    if (lotesChanged) {
      patch.lotes = lotes;
      next.lotes = lotes;
    }
    if (Math.abs(saldo - stored) < 0.0005 && patch.saldo_inicial != null) {
      patch.saldo_final = quantidade;
      next.saldo_final = quantidade;
      next.saldo_atual = quantidade;
    }
    estoquePatches.push(patch);
    return next;
  });

  return {
    estoque: nextEstoque,
    transbordos: nextTransbordos,
    vasilhames: nextVasilhames,
    transbordoPatches,
    vasilhamePatches,
    estoquePatches,
    dirty:
      transbordoPatches.length > 0 ||
      vasilhamePatches.length > 0 ||
      estoquePatches.length > 0,
  };
}

let persistTask = null;

/** Grava a correção uma vez. Chamadas seguintes aguardam a mesma escrita. */
export function persistDeclaredVolumeDecimals(result) {
  if (!result?.dirty) return Promise.resolve();
  if (persistTask) return persistTask;
  persistTask = (async () => {
    try {
      await Promise.all([
        entities.transbordos.bulkUpdate(result.transbordoPatches),
        entities.vasilhames.bulkUpdate(result.vasilhamePatches),
        entities.estoque.bulkUpdate(result.estoquePatches),
      ]);
    } catch (err) {
      console.warn(
        "[ChemFlow] Não foi possível gravar as casas decimais do volume:",
        err
      );
    } finally {
      persistTask = null;
    }
  })();
  return persistTask;
}
