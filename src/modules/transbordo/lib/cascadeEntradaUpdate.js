import { entities } from "@transbordo/services/entities";
import { syncEstoqueSaldos } from "@transbordo/lib/estoqueSaldo";
import { getDominantLote } from "@transbordo/lib/vasilhameComposicao";
import { parseDensidade } from "@transbordo/lib/format";
import {
  computeTankaLotesDisponiveis,
  sortTransbordosChrono,
} from "@transbordo/lib/tankaVolume";
import { isLoteNaoInformado } from "@transbordo/lib/saidaOrigem";
import {
  calculateFIFOAllocation,
  expandOrigensForFifo,
} from "@transbordo/lib/fifo";

/**
 * Mantém a entrada como fonte mandatória de identidade (lote, NF, produto, etc.).
 * Atualiza estoque sem trocar IDs e propaga snapshots denormalizados
 * em transbordos, saídas, vasilhames e filtrações.
 */

function sameText(a, b) {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

function sortByCreated(rows = []) {
  return [...rows].sort((a, b) => {
    const da = new Date(a.created_at || a.created_date || 0).getTime();
    const db = new Date(b.created_at || b.created_date || 0).getTime();
    return da - db;
  });
}

function identitySnapshot(row = {}) {
  return {
    lote: row.lote || "",
    nota_fiscal: row.nota_fiscal || "",
    produto_id: row.produto_id || null,
    produto_nome: row.produto_nome || "",
    produto_codigo: row.produto_codigo || "",
    cliente_id: row.cliente_id || null,
    cliente_nome: row.cliente_nome || "",
    densidade: row.densidade ?? null,
    data_fabricacao: row.data_fabricacao || null,
    data_validade: row.data_validade || null,
  };
}

function identityChanged(before, after) {
  return (
    !sameText(before.lote, after.lote) ||
    !sameText(before.nota_fiscal, after.nota_fiscal) ||
    !sameText(before.produto_id, after.produto_id) ||
    !sameText(before.produto_nome, after.produto_nome) ||
    !sameText(before.produto_codigo, after.produto_codigo) ||
    !sameText(before.cliente_id, after.cliente_id) ||
    !sameText(before.cliente_nome, after.cliente_nome) ||
    !sameText(before.densidade, after.densidade) ||
    !sameText(before.data_fabricacao, after.data_fabricacao) ||
    !sameText(before.data_validade, after.data_validade)
  );
}

function isEstoqueReferenced(estoqueId, { transbordos, saidas }) {
  const inTransbordo = (transbordos || []).some((t) =>
    (t.origens || []).some((o) => o.entrada_id === estoqueId)
  );
  if (inTransbordo) return true;
  return (saidas || []).some((s) =>
    (s.itens || []).some(
      (item) => item.tipo === "embalado" && item.entrada_id === estoqueId
    )
  );
}

/**
 * Associa lotes novos aos registros de estoque existentes (por índice estável).
 * Lotes extras → create. Estoque sobrando → delete só se não houver vínculo.
 */
export function planEstoqueSync(existingEstoque = [], newRecords = []) {
  const existing = sortByCreated(existingEstoque);
  const updates = [];
  const creates = [];
  const deletes = [];
  const pairs = [];

  const n = Math.min(existing.length, newRecords.length);
  for (let i = 0; i < n; i++) {
    const before = existing[i];
    const afterPayload = newRecords[i];
    updates.push({ id: before.id, ...afterPayload });
    pairs.push({
      estoqueId: before.id,
      before: identitySnapshot(before),
      after: identitySnapshot(afterPayload),
    });
  }

  for (let i = n; i < newRecords.length; i++) {
    creates.push(newRecords[i]);
  }

  for (let i = n; i < existing.length; i++) {
    deletes.push(existing[i]);
  }

  return { updates, creates, deletes, pairs };
}

function patchOrigem(origem, pair) {
  if (origem?.entrada_id !== pair.estoqueId) return { origem, changed: false };

  let entrada_codigo = origem.entrada_codigo || "";
  const oldLote = pair.before.lote || "";
  const newLote = pair.after.lote || "";
  if (oldLote && newLote && !sameText(oldLote, newLote) && entrada_codigo) {
    entrada_codigo = String(entrada_codigo).replace(
      new RegExp(
        `Lote\\s+${oldLote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        "i"
      ),
      `Lote ${newLote}`
    );
  }

  const next = {
    ...origem,
    lote: newLote || origem.lote,
    entrada_codigo,
  };
  return {
    origem: next,
    changed:
      identityChanged(pair.before, pair.after) ||
      !sameText(origem.lote, next.lote) ||
      !sameText(origem.entrada_codigo, next.entrada_codigo),
  };
}

function patchSaidaItem(item, pair) {
  if (item?.tipo !== "embalado" || item.entrada_id !== pair.estoqueId) {
    return { item, changed: false };
  }
  const next = {
    ...item,
    lote: pair.after.lote,
    produto_id: pair.after.produto_id ?? item.produto_id,
    produto_nome: pair.after.produto_nome || item.produto_nome,
    produto_codigo: pair.after.produto_codigo || item.produto_codigo,
  };
  const changed =
    !sameText(item.lote, next.lote) ||
    !sameText(item.produto_id, next.produto_id) ||
    !sameText(item.produto_nome, next.produto_nome) ||
    !sameText(item.produto_codigo, next.produto_codigo);
  return { item: next, changed };
}

function shouldPatchComposicaoEntry(entry, pair, ctx) {
  if (!sameText(entry?.lote, pair.before.lote)) return false;
  if (!pair.before.lote && !pair.after.lote) return false;
  if (entry?.transbordo_codigo && ctx.codigos.has(entry.transbordo_codigo)) {
    return true;
  }
  if (ctx.vasilhameTransbordoId && ctx.transbordoIds.has(ctx.vasilhameTransbordoId)) {
    return true;
  }
  return false;
}

function patchComposicao(composicao, pair, ctx) {
  let changed = false;
  const next = (composicao || []).map((c) => {
    if (!shouldPatchComposicaoEntry(c, pair, ctx)) return c;
    changed = true;
    return { ...c, lote: pair.after.lote };
  });
  return { composicao: next, changed };
}

function normId(value) {
  if (value == null || value === "") return "";
  return String(value);
}

function normCode(value) {
  return String(value || "").trim();
}

function placaBarrilKey(placa, barril) {
  return `${normCode(placa).toUpperCase()}||${normCode(barril).toUpperCase()}`;
}

function indexEstoqueRows(rows = []) {
  const byId = new Map();
  const byEntradaId = new Map();
  const list = [];
  for (const row of rows || []) {
    if (!row?.id) continue;
    list.push(row);
    byId.set(String(row.id), row);
    const entradaId = normId(row.entrada_id);
    if (!entradaId) continue;
    if (!byEntradaId.has(entradaId)) byEntradaId.set(entradaId, []);
    byEntradaId.get(entradaId).push(row);
  }
  return { byId, byEntradaId, list };
}

function codigoApontaEntrada(origemCodigo, entradaCodigo) {
  const code = normCode(entradaCodigo);
  const text = normCode(origemCodigo);
  if (!code || !text) return false;
  if (text === code) return true;
  return (
    text.startsWith(`${code} `) ||
    text.startsWith(`${code}—`) ||
    text.startsWith(`${code} -`) ||
    text.startsWith(`${code}–`)
  );
}

function resolveEstoqueForOrigem(origem, index) {
  if (!origem || !index) return null;
  const directId = normId(origem.estoque_id || origem.entrada_id);
  if (directId && index.byId.has(directId)) return index.byId.get(directId);

  if (directId && index.byEntradaId.has(directId)) {
    const group = index.byEntradaId.get(directId);
    if (group.length === 1) return group[0];
    const byLote = group.find((row) => sameText(row.lote, origem.lote));
    if (byLote) return byLote;
  }

  const matches = index.list.filter((row) =>
    codigoApontaEntrada(origem.entrada_codigo, row.entrada_codigo)
  );
  if (matches.length === 1) return matches[0];
  return matches.find((row) => sameText(row.lote, origem.lote)) || null;
}

function replaceLoteInCodigo(entradaCodigo, oldLote, newLote) {
  const codigo = String(entradaCodigo || "");
  const from = normCode(oldLote);
  const to = normCode(newLote);
  if (!codigo || !from || !to || sameText(from, to)) return codigo;
  return codigo.replace(
    new RegExp(`Lote\\s+${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"),
    `Lote ${to}`
  );
}

function collectLotes(row) {
  const lotes = new Set();
  const header = normCode(row?.lote);
  if (header) lotes.add(header);
  for (const entry of row?.composicao || []) {
    const lote = normCode(entry?.lote);
    if (lote) lotes.add(lote);
  }
  return lotes;
}

function composicaoManual(row) {
  return (row?.composicao || []).some((entry) => entry?.lote_manual);
}

function dropLoteManual(entry, lote) {
  const next = { ...entry, lote };
  delete next.lote_manual;
  return next;
}

function vasilhameBelongsToTransbordo(vasilhame, transbordo) {
  if (!vasilhame || !transbordo) return false;
  if (
    vasilhame.transbordo_id &&
    transbordo.id &&
    String(vasilhame.transbordo_id) === String(transbordo.id)
  ) {
    return true;
  }
  const code = normCode(transbordo.codigo_transbordo);
  if (code) {
    if (normCode(vasilhame.codigo) === code || normCode(vasilhame.numero_op) === code) {
      return true;
    }
    if (
      (vasilhame.composicao || []).some(
        (entry) => normCode(entry?.transbordo_codigo) === code
      )
    ) {
      return true;
    }
  }
  const key = placaBarrilKey(vasilhame.placa, vasilhame.barril);
  if (key === "||") return false;
  return (transbordo.destinos || []).some(
    (destino) =>
      placaBarrilKey(destino.placa || destino.tanka_codigo, destino.barril) === key
  );
}

function opCodesOf(vasilhame) {
  const codes = new Set();
  const codigo = normCode(vasilhame?.codigo);
  const numero = normCode(vasilhame?.numero_op);
  if (codigo) codes.add(codigo);
  if (numero) codes.add(numero);
  for (const entry of vasilhame?.composicao || []) {
    const code = normCode(entry?.transbordo_codigo);
    if (code && code.toLowerCase() !== "manual") codes.add(code);
  }
  return codes;
}

function entryBelongsToOp(entry, vasilhame, code) {
  const entryCode = normCode(entry?.transbordo_codigo);
  if (entryCode && code) return entryCode === code;
  if (entryCode) return false;
  const codes = opCodesOf(vasilhame);
  return !code || codes.size <= 1 || codes.has(code);
}

function expectedLotesDoTransbordo(transbordo, index) {
  const dens = parseDensidade(transbordo?.densidade);
  return expandOrigensForFifo(transbordo?.origens || [], dens).map((origem) => {
    const estoque = resolveEstoqueForOrigem(origem, index);
    return {
      origem,
      estoque,
      lote: normCode(estoque?.lote || origem?.lote),
    };
  });
}

function vasilhameUsaEstoqueForcado(vasilhame, transbordos, index, forceIds) {
  if (!forceIds || forceIds.size === 0) return false;
  for (const entry of vasilhame?.composicao || []) {
    const estoque = index.byId.get(normId(entry?.estoque_id || entry?.entrada_id));
    if (estoque && forceIds.has(String(estoque.id))) return true;
  }
  return (transbordos || []).some((transbordo) => {
    if (!vasilhameBelongsToTransbordo(vasilhame, transbordo)) return false;
    return expectedLotesDoTransbordo(transbordo, index).some(
      (item) => item.estoque && forceIds.has(String(item.estoque.id))
    );
  });
}

function patchTransbordoOrigens(transbordo, index) {
  let changed = false;
  const origens = (transbordo?.origens || []).map((origem) => {
    const estoque = resolveEstoqueForOrigem(origem, index);
    const nextLote = normCode(estoque?.lote);
    if (!estoque || !nextLote) return origem;

    let next = origem;
    if (!sameText(origem.lote, nextLote)) {
      changed = true;
      next = {
        ...origem,
        lote: nextLote,
        entrada_codigo: replaceLoteInCodigo(
          origem.entrada_codigo,
          origem.lote,
          nextLote
        ),
      };
    }

    if (Array.isArray(origem.lotes_retirados) && origem.lotes_retirados.length > 0) {
      let lotesChanged = false;
      const lotes_retirados = origem.lotes_retirados.map((lote) => {
        if (sameText(lote?.lote, nextLote)) return lote;
        lotesChanged = true;
        return { ...lote, lote: nextLote };
      });
      if (lotesChanged) {
        changed = true;
        next = { ...next, lote: nextLote, lotes_retirados };
      }
    }
    return next;
  });
  return changed ? { id: transbordo.id, origens } : null;
}

/**
 * Origem "tanka": o lote é uma cópia do que a tanka continha no momento do OP
 * (vindo de OPs anteriores, que por sua vez apontam para a entrada).
 * Realinha o snapshot ao lote atual da tanka quando ele foi renomeado ou
 * estava "Não informado".
 */
function patchTransbordoOrigensTanka(transbordo, anteriores) {
  let changed = false;

  const origens = (transbordo?.origens || []).map((origem) => {
    if (origem?.tipo_origem !== "tanka" || !origem.entrada_id) return origem;

    // Só realinha quando a tanka continha um único lote (sem ambiguidade).
    const lotesDaTanka = computeTankaLotesDisponiveis({
      isotanqueId: origem.entrada_id,
      tankaCodigo: origem.tanka_codigo || "",
      transbordos: anteriores,
    }).map((item) => normCode(item.lote));
    if (lotesDaTanka.length !== 1 || isLoteNaoInformado(lotesDaTanka[0])) {
      return origem;
    }

    const lotePadrao = lotesDaTanka[0];
    const resolver = (lote) =>
      sameText(lote, lotePadrao) ? lote : lotePadrao;

    let next = origem;
    if (!sameText(origem.lote, lotePadrao)) {
      next = { ...next, lote: lotePadrao };
      changed = true;
    }
    if (Array.isArray(origem.lotes_retirados) && origem.lotes_retirados.length > 0) {
      const lotes_retirados = origem.lotes_retirados.map((item) => {
        const lote = resolver(item?.lote);
        return sameText(lote, item?.lote) ? item : { ...item, lote };
      });
      if (lotes_retirados.some((item, i) => item !== origem.lotes_retirados[i])) {
        next = { ...next, lotes_retirados };
        changed = true;
      }
    }
    return next;
  });

  return changed ? { id: transbordo.id, origens } : null;
}

function patchVasilhameLote(vasilhame, transbordos, index, forceIds) {
  const manual = composicaoManual(vasilhame);
  const forced = vasilhameUsaEstoqueForcado(
    vasilhame,
    transbordos,
    index,
    forceIds
  );
  if (manual && !forced) return null;

  const beforeLotes = collectLotes(vasilhame);
  const replacements = new Map();
  let changed = false;
  let headerLote = normCode(vasilhame.lote);
  let composicao = (vasilhame.composicao || []).map((entry) => ({ ...entry }));

  const note = (from, to) => {
    const oldLote = normCode(from);
    const newLote = normCode(to);
    if (!oldLote || !newLote || sameText(oldLote, newLote)) return;
    replacements.set(oldLote, newLote);
  };

  composicao = composicao.map((entry) => {
    const estoque = resolveEstoqueForOrigem(entry, index);
    if (!estoque) return entry;
    const nextLote = normCode(estoque.lote);
    if (!nextLote || sameText(entry.lote, nextLote)) {
      if (forced && entry.lote_manual) {
        changed = true;
        return dropLoteManual(entry, normCode(entry.lote));
      }
      return entry;
    }
    note(entry.lote, nextLote);
    changed = true;
    return dropLoteManual(entry, nextLote);
  });

  for (const transbordo of transbordos || []) {
    if (!vasilhameBelongsToTransbordo(vasilhame, transbordo)) continue;
    const expected = expectedLotesDoTransbordo(transbordo, index);
    const linked = expected.filter(
      (item) =>
        item.lote &&
        (item.estoque ||
          (item.origem?.tipo_origem === "tanka" && !isLoteNaoInformado(item.lote)))
    );
    if (linked.length === 0) continue;

    const unique = [...new Set(expected.map((item) => item.lote).filter(Boolean))];
    const code = normCode(transbordo.codigo_transbordo);

    if (unique.length === 1) {
      const nextLote = unique[0];
      const singleOp = opCodesOf(vasilhame).size <= 1;
      const stored = new Set();
      if (singleOp && normCode(vasilhame.lote)) stored.add(normCode(vasilhame.lote));
      for (const entry of composicao) {
        if (!singleOp && !entryBelongsToOp(entry, vasilhame, code)) continue;
        const lote = normCode(entry.lote);
        if (lote) stored.add(lote);
      }
      if (stored.size > 1) continue;
      const only = [...stored][0] || "";
      if (sameText(only, nextLote)) {
        if (forced && composicao.some((entry) => entry.lote_manual)) {
          composicao = composicao.map((entry) =>
            entry.lote_manual ? dropLoteManual(entry, normCode(entry.lote)) : entry
          );
          changed = true;
        }
        continue;
      }
      note(only || vasilhame.lote, nextLote);
      if (singleOp) headerLote = nextLote;
      composicao = composicao.map((entry) => {
        if (!singleOp && !entryBelongsToOp(entry, vasilhame, code)) return entry;
        return dropLoteManual(entry, nextLote);
      });
      changed = true;
      continue;
    }

    for (const item of linked) {
      const oldLote = normCode(item.origem?.lote);
      const nextLote = item.lote;
      if (!oldLote || sameText(oldLote, nextLote)) continue;
      composicao = composicao.map((entry) => {
        if (!entryBelongsToOp(entry, vasilhame, code)) return entry;
        if (!sameText(entry.lote, oldLote)) return entry;
        note(oldLote, nextLote);
        changed = true;
        return dropLoteManual(entry, nextLote);
      });
    }
  }

  const lote = getDominantLote(composicao) || headerLote;
  if (!sameText(lote, vasilhame.lote)) changed = true;
  if (!changed) return null;

  return {
    id: vasilhame.id,
    composicao,
    lote,
    replacements,
    beforeLotes,
  };
}

function isSaidaVasilhameItem(item) {
  if (!item?.vasilhame_id) return false;
  return item.tipo !== "embalado" && item.tipo !== "ind_retorno_mp";
}

function patchSaidasLote(saidas, index, vasilhamePatches, vasilhamesAtuais = []) {
  const patchById = new Map(vasilhamePatches.map((patch) => [String(patch.id), patch]));
  const vasilhameById = new Map(
    (vasilhamesAtuais || []).map((vasilhame) => [String(vasilhame.id), vasilhame])
  );
  const updates = [];

  for (const saida of saidas || []) {
    let changed = false;
    const itens = (saida.itens || []).map((item) => {
      if (item?.tipo === "embalado") {
        const estoque = index.byId.get(normId(item.entrada_id));
        const nextLote = normCode(estoque?.lote);
        if (!estoque || !nextLote || sameText(item.lote, nextLote)) return item;
        changed = true;
        return { ...item, lote: nextLote };
      }

      if (!isSaidaVasilhameItem(item)) return item;
      const current = normCode(item.lote);
      const patch = patchById.get(String(item.vasilhame_id));
      if (!patch) {
        // Vasilhame já alinhado antes: só completa lote ausente/"Não informado".
        const atual = normCode(vasilhameById.get(String(item.vasilhame_id))?.lote);
        if (!isLoteNaoInformado(current) || isLoteNaoInformado(atual)) return item;
        changed = true;
        return { ...item, lote: atual };
      }
      const nextLote =
        patch.replacements.get(current) ||
        ((patch.beforeLotes.size <= 1 || isLoteNaoInformado(current)) &&
        (!current || isLoteNaoInformado(current) || patch.beforeLotes.has(current))
          ? patch.lote
          : "");
      if (isLoteNaoInformado(nextLote)) return item;
      if (!nextLote || sameText(current, nextLote)) return item;
      changed = true;
      return { ...item, lote: nextLote };
    });
    if (changed) updates.push({ id: saida.id, itens });
  }

  return updates;
}

function mergeById(rows, updates) {
  if (!updates?.length) return rows || [];
  const byId = new Map(updates.map((row) => [String(row.id), row]));
  return (rows || []).map((row) =>
    byId.has(String(row.id)) ? { ...row, ...byId.get(String(row.id)) } : row
  );
}

/**
 * Alinha lote de transbordo, vasilhame, filtração e saída ao lote atual do estoque
 * da entrada. A entrada é a fonte do lote; a saída de tanque guarda só uma cópia.
 *
 * `forceEstoqueIds` sobrescreve ajuste manual feito no vasilhame.
 */
export function planLinkedLoteSync({
  estoqueRows = [],
  transbordos = [],
  vasilhames = [],
  saidas = [],
  filtracoes = [],
  forceEstoqueIds = [],
} = {}) {
  const index = indexEstoqueRows(estoqueRows);
  const forceIds = new Set((forceEstoqueIds || []).filter(Boolean).map(String));

  const updatesById = new Map();
  const working = new Map();
  for (const transbordo of transbordos || []) {
    const patch = patchTransbordoOrigens(transbordo, index);
    if (patch) updatesById.set(String(transbordo.id), patch);
    working.set(String(transbordo.id), patch ? { ...transbordo, ...patch } : transbordo);
  }

  // Origens "tanka" dependem dos OPs anteriores já realinhados (ordem cronológica).
  const ordered = sortTransbordosChrono([...working.values()]);
  ordered.forEach((transbordo, i) => {
    const key = String(transbordo.id);
    const current = working.get(key);
    const anteriores = ordered.slice(0, i).map((prev) => working.get(String(prev.id)));
    const patch = patchTransbordoOrigensTanka(current, anteriores);
    if (!patch) return;
    working.set(key, { ...current, ...patch });
    updatesById.set(key, patch);
  });

  const transbordoUpdates = [...updatesById.values()];
  const transbordosNext = (transbordos || []).map(
    (transbordo) => working.get(String(transbordo.id)) || transbordo
  );

  const vasilhamePatches = [];
  for (const vasilhame of vasilhames || []) {
    const patch = patchVasilhameLote(vasilhame, transbordosNext, index, forceIds);
    if (patch) vasilhamePatches.push(patch);
  }
  const vasilhameUpdates = vasilhamePatches.map(
    ({ replacements, beforeLotes, ...row }) => row
  );

  const saidaUpdates = patchSaidasLote(
    saidas,
    index,
    vasilhamePatches,
    mergeById(vasilhames, vasilhameUpdates)
  );

  const patchById = new Map(vasilhamePatches.map((patch) => [String(patch.id), patch]));
  const filtracaoUpdates = [];
  for (const filtracao of filtracoes || []) {
    const patch = patchById.get(String(filtracao.vasilhame_id));
    if (!patch) continue;
    let changed = !sameText(filtracao.lote, patch.lote);
    const composicao = (filtracao.composicao || []).map((entry) => {
      const nextLote = patch.replacements.get(normCode(entry?.lote));
      if (!nextLote || sameText(entry?.lote, nextLote)) return entry;
      changed = true;
      return { ...entry, lote: nextLote };
    });
    const lote = getDominantLote(composicao) || patch.lote || filtracao.lote || "";
    if (!sameText(lote, filtracao.lote)) changed = true;
    if (!changed) continue;
    filtracaoUpdates.push({ id: filtracao.id, composicao, lote });
  }

  return {
    transbordoUpdates,
    vasilhameUpdates,
    saidaUpdates,
    filtracaoUpdates,
  };
}

/** Copia o lote editado no vasilhame para as saídas já registradas desse tanque. */
export async function syncSaidaLoteDoVasilhame(vasilhameId, oldLote, newLote) {
  if (!vasilhameId || sameText(oldLote, newLote)) return;
  const saidas = await entities.saidas.list();
  const updates = [];
  for (const saida of saidas || []) {
    let changed = false;
    const itens = (saida.itens || []).map((item) => {
      if (String(item?.vasilhame_id || "") !== String(vasilhameId)) return item;
      if (!isSaidaVasilhameItem(item)) return item;
      if (normCode(item.lote) && !sameText(item.lote, oldLote)) return item;
      changed = true;
      return { ...item, lote: normCode(newLote) };
    });
    if (changed) updates.push({ id: saida.id, itens });
  }
  if (updates.length > 0) await entities.saidas.bulkUpdate(updates);
}

export async function healLinkedLotes({
  estoqueRows,
  transbordos,
  vasilhames,
  saidas,
  filtracoes,
  forceEstoqueIds = [],
} = {}) {
  const [estoque, transbordoRows, vasilhameRows, saidaRows, filtracaoRows] =
    await Promise.all([
      estoqueRows ? Promise.resolve(estoqueRows) : entities.estoque.list(),
      transbordos ? Promise.resolve(transbordos) : entities.transbordos.list(),
      vasilhames ? Promise.resolve(vasilhames) : entities.vasilhames.list(),
      saidas ? Promise.resolve(saidas) : entities.saidas.list(),
      filtracoes ? Promise.resolve(filtracoes) : entities.filtracoes.list(),
    ]);

  const plan = planLinkedLoteSync({
    estoqueRows: estoque,
    transbordos: transbordoRows,
    vasilhames: vasilhameRows,
    saidas: saidaRows,
    filtracoes: filtracaoRows,
    forceEstoqueIds,
  });

  await Promise.all([
    entities.transbordos.bulkUpdate(plan.transbordoUpdates),
    entities.vasilhames.bulkUpdate(plan.vasilhameUpdates),
    entities.saidas.bulkUpdate(plan.saidaUpdates),
  ]);
  try {
    await entities.filtracoes.bulkUpdate(plan.filtracaoUpdates);
  } catch (err) {
    console.error("[Transbordo] Falha ao alinhar lote das filtrações:", err);
  }

  return {
    ...plan,
    transbordos: mergeById(transbordoRows, plan.transbordoUpdates),
    vasilhames: mergeById(vasilhameRows, plan.vasilhameUpdates),
    saidas: mergeById(saidaRows, plan.saidaUpdates),
  };
}

/**
 * Propaga alterações de identidade a partir dos pares estoque before/after.
 */
export async function cascadeEntradaIdentity(pairs = []) {
  const changedPairs = pairs.filter((p) => identityChanged(p.before, p.after));
  if (changedPairs.length === 0) {
    return { transbordos: 0, saidas: 0, vasilhames: 0, filtracoes: 0 };
  }

  const estoqueIds = new Set(changedPairs.map((p) => p.estoqueId));
  const pairByEstoqueId = new Map(changedPairs.map((p) => [p.estoqueId, p]));

  const [transbordos, saidas, vasilhames, filtracoes] = await Promise.all([
    entities.transbordos.list(),
    entities.saidas.list(),
    entities.vasilhames.list(),
    entities.filtracoes.list(),
  ]);

  const affectedTransbordoIds = new Set();
  const affectedCodigos = new Set();

  for (const t of transbordos) {
    const linked = (t.origens || []).some((o) => estoqueIds.has(o.entrada_id));
    if (!linked) continue;
    affectedTransbordoIds.add(t.id);
    if (t.codigo_transbordo) affectedCodigos.add(t.codigo_transbordo);
    if (t.codigo) affectedCodigos.add(t.codigo);
    if (t.numero_op) affectedCodigos.add(t.numero_op);
  }

  const transbordoUpdates = [];

  for (const t of transbordos) {
    let linked = false;
    let produtoPatch = null;
    const nextOrigens = (t.origens || []).map((o) => {
      const pair = pairByEstoqueId.get(o.entrada_id);
      if (!pair) return o;
      linked = true;
      produtoPatch = {
        produto_id: pair.after.produto_id ?? t.produto_id,
        produto_nome: pair.after.produto_nome || t.produto_nome,
        produto_codigo: pair.after.produto_codigo || t.produto_codigo,
        cliente_id: pair.after.cliente_id ?? t.cliente_id,
        cliente_nome: pair.after.cliente_nome || t.cliente_nome,
        densidade:
          pair.after.densidade != null && pair.after.densidade !== ""
            ? pair.after.densidade
            : t.densidade,
      };
      const { origem } = patchOrigem(o, pair);
      return origem;
    });

    if (linked) {
      transbordoUpdates.push({
        id: t.id,
        origens: nextOrigens,
        ...(produtoPatch || {}),
      });
    }
  }

  const saidaUpdates = [];
  for (const s of saidas) {
    let changed = false;
    const nextItens = (s.itens || []).map((item) => {
      const pair = pairByEstoqueId.get(item.entrada_id);
      if (!pair) return item;
      const patched = patchSaidaItem(item, pair);
      if (patched.changed) changed = true;
      return patched.item;
    });
    if (changed) {
      saidaUpdates.push({ id: s.id, itens: nextItens });
    }
  }

  const vasilhameUpdates = [];
  for (const v of vasilhames) {
    let anyChange = false;
    let composicaoPatched = false;
    let composicao = v.composicao || [];

    for (const pair of changedPairs) {
      const ctx = {
        codigos: affectedCodigos,
        transbordoIds: affectedTransbordoIds,
        vasilhameTransbordoId: v.transbordo_id,
        vasilhameLote: v.lote,
        vasilhameProdutoId: v.produto_id,
        vasilhameProdutoCodigo: v.produto_codigo,
      };
      const patched = patchComposicao(composicao, pair, ctx);
      if (patched.changed) {
        composicao = patched.composicao;
        composicaoPatched = true;
        anyChange = true;
      }

      // Cabeçalho do vasilhame quando o lote dominante era o antigo
      if (
        sameText(v.lote, pair.before.lote) &&
        affectedTransbordoIds.has(v.transbordo_id)
      ) {
        anyChange = true;
      }
    }

    if (!anyChange) continue;

    const dominant = getDominantLote(composicao);
    const primaryPair =
      changedPairs.find((p) => sameText(v.lote, p.before.lote)) ||
      changedPairs[0];
    const nextLote = composicaoPatched
      ? dominant || primaryPair?.after.lote || v.lote || ""
      : primaryPair?.after.lote || v.lote || "";

    vasilhameUpdates.push({
      id: v.id,
      composicao,
      lote: nextLote,
      produto_id: primaryPair?.after.produto_id ?? v.produto_id,
      produto_nome: primaryPair?.after.produto_nome || v.produto_nome,
      produto_codigo: primaryPair?.after.produto_codigo || v.produto_codigo,
      cliente_id: primaryPair?.after.cliente_id ?? v.cliente_id,
      cliente_nome: primaryPair?.after.cliente_nome || v.cliente_nome,
      densidade: primaryPair?.after.densidade ?? v.densidade,
    });
  }

  const filtracaoUpdates = [];
  for (const f of filtracoes) {
    let anyChange = false;
    let composicao = f.composicao || [];

    for (const pair of changedPairs) {
      const ctx = {
        codigos: affectedCodigos,
        transbordoIds: affectedTransbordoIds,
        vasilhameTransbordoId: f.transbordo_id,
        vasilhameLote: f.lote,
        vasilhameProdutoId: f.produto_id,
        vasilhameProdutoCodigo: f.produto_codigo,
      };
      const patched = patchComposicao(composicao, pair, ctx);
      if (patched.changed) {
        composicao = patched.composicao;
        anyChange = true;
      }
      if (
        sameText(f.lote, pair.before.lote) &&
        affectedTransbordoIds.has(f.transbordo_id)
      ) {
        anyChange = true;
      }
    }

    if (!anyChange) continue;

    const dominant = getDominantLote(composicao);
    const primaryPair =
      changedPairs.find(
        (p) =>
          sameText(f.lote, p.before.lote) ||
          sameText(f.produto_id, p.before.produto_id)
      ) || changedPairs[0];

    filtracaoUpdates.push({
      id: f.id,
      composicao,
      lote: dominant || primaryPair?.after.lote || f.lote || "",
      produto_id: primaryPair?.after.produto_id ?? f.produto_id,
      produto_nome: primaryPair?.after.produto_nome || f.produto_nome,
      produto_codigo: primaryPair?.after.produto_codigo || f.produto_codigo,
      cliente_id: primaryPair?.after.cliente_id ?? f.cliente_id,
      cliente_nome: primaryPair?.after.cliente_nome || f.cliente_nome,
    });
  }

  await Promise.all([
    entities.transbordos.bulkUpdate(transbordoUpdates),
    entities.saidas.bulkUpdate(saidaUpdates),
    entities.vasilhames.bulkUpdate(vasilhameUpdates),
    entities.filtracoes.bulkUpdate(filtracaoUpdates),
  ]);

  return {
    transbordos: transbordoUpdates.length,
    saidas: saidaUpdates.length,
    vasilhames: vasilhameUpdates.length,
    filtracoes: filtracaoUpdates.length,
  };
}

/**
 * Persiste estoque da entrada preservando IDs e cascateia identidade.
 * @returns {{ savedEstoques: Array, cascade: object }}
 */
export async function syncEntradaEstoqueCascade({
  entradaId,
  estoqueRecords = [],
}) {
  const [existingEstoqueRaw, allTransbordos, allSaidas] = await Promise.all([
    entities.estoque.filter({ entrada_id: entradaId }),
    entities.transbordos.list(),
    entities.saidas.list(),
  ]);

  // Estoque gerado por transbordo (IBC/Tambor/Bombona) não participa do sync da entrada
  const existingEstoque = (existingEstoqueRaw || []).filter(
    (e) => !String(e?.grupo_entrada || "").startsWith("TB")
  );

  const plan = planEstoqueSync(existingEstoque, estoqueRecords);

  for (const row of plan.deletes) {
    if (
      isEstoqueReferenced(row.id, {
        transbordos: allTransbordos,
        saidas: allSaidas,
      })
    ) {
      throw new Error(
        `Não é possível remover o lote "${row.lote || row.id}" desta entrada porque já existem transbordos ou saídas vinculados. Remova esses movimentos antes.`
      );
    }
  }

  const updated =
    plan.updates.length > 0
      ? await entities.estoque.bulkUpdate(plan.updates)
      : [];
  const created =
    plan.creates.length > 0
      ? await entities.estoque.bulkCreate(plan.creates)
      : [];

  for (const row of plan.deletes) {
    await entities.estoque.delete(row.id);
  }

  // Garante IDs mesmo se o select do update retornar null (RLS)
  const savedEstoques = [
    ...plan.updates.map((u, i) => {
      const row = updated[i];
      return row?.id ? row : { ...u, id: u.id };
    }),
    ...(created || []),
  ];
  const cascade = await cascadeEntradaIdentity(plan.pairs);
  const forceEstoqueIds = plan.pairs
    .filter((pair) => !sameText(pair.before?.lote, pair.after?.lote))
    .map((pair) => pair.estoqueId);
  await healLinkedLotes({
    estoqueRows: savedEstoques,
    forceEstoqueIds,
  });

  const estoqueIds = savedEstoques.map((e) => e.id).filter(Boolean);
  if (estoqueIds.length > 0) {
    await syncEstoqueSaldos(estoqueIds);
  }

  return { savedEstoques, cascade };
}
