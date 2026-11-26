import { entities } from "@transbordo/services/entities";
import { syncEstoqueSaldos } from "@transbordo/lib/estoqueSaldo";
import {
  alignSaidaItemVolumeToVasilhame,
  getDominantLote,
  loteExibidoDoVasilhame,
  refreshSaidaItemMassaFromVasilhame,
  sameTanqueIdentity,
} from "@transbordo/lib/vasilhameComposicao";
import { parseDensidade } from "@transbordo/lib/format";
import {
  computeTankaLotesDisponiveis,
  sortTransbordosChrono,
} from "@transbordo/lib/tankaVolume";
import {
  calcSaidaQuantidadeTotal,
  isLoteNaoInformado,
} from "@transbordo/lib/saidaOrigem";
import {
  calculateFIFOAllocation,
  expandOrigensForFifo,
} from "@transbordo/lib/fifo";
import {
  parseStoredChecklist,
  patchChecklistItemFromSaidaLinha,
} from "@painel/lib/carregamentoChecklistConfig";
import { resolveVasilhameDaSaida } from "@transbordo/lib/vasilhameSaidaLink";

/**
 * Mantém a entrada como fonte mandatória de identidade (lote, NF, produto, etc.).
 * Atualiza estoque sem trocar IDs e propaga snapshots denormalizados
 * em transbordos, saídas, vasilhames, filtrações e validações (ordem operacional).
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

/** Substitui token de lote em rótulos compostos ("A / B"). */
function replaceLoteToken(label, oldLote, newLote) {
  const raw = String(label || "");
  const from = normCode(oldLote);
  const to = normCode(newLote);
  if (!raw || !from || !to || sameText(from, to)) return raw;
  if (sameText(raw, from)) return to;
  const parts = raw.split(/\s*\/\s*/).map((p) => p.trim());
  let changed = false;
  const next = parts.map((part) => {
    if (!sameText(part, from)) return part;
    changed = true;
    return to;
  });
  return changed ? next.filter(Boolean).join(" / ") : raw;
}

function patchLoteItemList(items, pair) {
  if (!Array.isArray(items) || items.length === 0) {
    return { items, changed: false };
  }
  let changed = false;
  const next = items.map((item) => {
    if (!sameText(item?.lote, pair.before.lote)) return item;
    changed = true;
    return { ...item, lote: pair.after.lote || item.lote };
  });
  return { items: next, changed };
}

function validacaoProdutoMatches(validacao, pair) {
  const vId = validacao?.produto_id;
  const beforeId = pair.before?.produto_id;
  const afterId = pair.after?.produto_id;
  if (vId && (beforeId || afterId)) {
    return sameText(vId, beforeId) || sameText(vId, afterId);
  }
  const vCode = validacao?.produto_codigo;
  const beforeCode = pair.before?.produto_codigo;
  const afterCode = pair.after?.produto_codigo;
  if (vCode && (beforeCode || afterCode)) {
    return sameText(vCode, beforeCode) || sameText(vCode, afterCode);
  }
  return true;
}

function origemMatchesIdentityPair(origem, pair) {
  if (!origem) return false;
  if (
    pair.estoqueId != null &&
    normId(origem.entrada_id) &&
    normId(origem.entrada_id) === normId(pair.estoqueId)
  ) {
    return true;
  }
  if (!pair.before?.lote) return false;
  if (sameText(origem.lote, pair.before.lote)) return true;
  const label = String(origem.lote || "");
  if (
    label.includes("/") &&
    label
      .split(/\s*\/\s*/)
      .map((p) => p.trim())
      .some((part) => sameText(part, pair.before.lote))
  ) {
    return true;
  }
  if (
    (origem.lotes_retirados || []).some((l) =>
      sameText(l?.lote, pair.before.lote)
    )
  ) {
    return true;
  }
  if (
    (origem.lotes_disponiveis || []).some((l) =>
      sameText(l?.lote, pair.before.lote)
    )
  ) {
    return true;
  }
  return false;
}

function patchValidacaoOrigem(origem, pair) {
  if (!origemMatchesIdentityPair(origem, pair)) {
    return { origem, changed: false };
  }

  let next = { ...origem };
  let changed = false;

  if (
    pair.estoqueId != null &&
    normId(origem.entrada_id) === normId(pair.estoqueId)
  ) {
    const patched = patchOrigem(origem, pair);
    next = patched.origem;
    changed = patched.changed;
  } else if (pair.before?.lote) {
    const nextLote = replaceLoteToken(
      origem.lote,
      pair.before.lote,
      pair.after.lote
    );
    const nextCodigo = replaceLoteInCodigo(
      origem.entrada_codigo,
      pair.before.lote,
      pair.after.lote
    );
    if (!sameText(nextLote, origem.lote) || !sameText(nextCodigo, origem.entrada_codigo)) {
      next = {
        ...next,
        lote: nextLote || next.lote,
        entrada_codigo: nextCodigo,
      };
      changed = true;
    }
  }

  const retirados = patchLoteItemList(next.lotes_retirados, pair);
  if (retirados.changed) {
    next = { ...next, lotes_retirados: retirados.items };
    changed = true;
  }
  const disponiveis = patchLoteItemList(next.lotes_disponiveis, pair);
  if (disponiveis.changed) {
    next = { ...next, lotes_disponiveis: disponiveis.items };
    changed = true;
  }

  return { origem: next, changed };
}

function patchGranelPayloadIdentity(payload, pair) {
  if (!payload || typeof payload !== "object") {
    return { payload, changed: false };
  }
  let next = payload;
  let changed = false;

  if (sameText(payload.lote, pair.before.lote)) {
    next = { ...next, lote: pair.after.lote || payload.lote };
    changed = true;
  } else if (payload.lote && pair.before?.lote) {
    const replaced = replaceLoteToken(
      payload.lote,
      pair.before.lote,
      pair.after.lote
    );
    if (!sameText(replaced, payload.lote)) {
      next = { ...next, lote: replaced };
      changed = true;
    }
  }

  if (Array.isArray(payload.lotes) && payload.lotes.length > 0) {
    let lotesChanged = false;
    const lotes = payload.lotes.map((lote) => {
      if (!sameText(lote?.lote, pair.before.lote)) return lote;
      lotesChanged = true;
      return {
        ...lote,
        lote: pair.after.lote || lote.lote,
        nota_fiscal: pair.after.nota_fiscal || lote.nota_fiscal,
        produto_id: pair.after.produto_id ?? lote.produto_id,
        produto_nome: pair.after.produto_nome || lote.produto_nome,
        produto_codigo: pair.after.produto_codigo || lote.produto_codigo,
        cliente_id: pair.after.cliente_id ?? lote.cliente_id,
        cliente_nome: pair.after.cliente_nome || lote.cliente_nome,
        densidade: pair.after.densidade ?? lote.densidade,
        data_fabricacao: pair.after.data_fabricacao || lote.data_fabricacao,
        data_validade: pair.after.data_validade || lote.data_validade,
      };
    });
    if (lotesChanged) {
      next = { ...next, lotes };
      changed = true;
    }
  }

  return { payload: next, changed };
}

/** Espelha lotesLabelFromOrigens — evita acoplar cascade ↔ validacaoTransbordo. */
function lotesLabelFromValidacaoOrigens(origens = []) {
  const names = [];
  for (const o of origens || []) {
    const retirados = (o.lotes_retirados || [])
      .filter((l) => Number(l.volume_retirado) > 0)
      .map((l) => String(l.lote || "").trim())
      .filter(Boolean);
    if (retirados.length > 0) {
      for (const n of retirados) {
        if (!names.includes(n)) names.push(n);
      }
      continue;
    }
    const lote = String(o.lote || "").trim();
    if (!lote) continue;
    for (const part of lote.split(/\s*\/\s*/)) {
      const p = part.trim();
      if (p && !names.includes(p)) names.push(p);
    }
  }
  return names.join(" / ");
}

function recomputeValidacaoLote(tipo, granelPayload, transbordoPayload, fallback = "") {
  if (
    (tipo === "granel_transbordo" || tipo === "entrada") &&
    granelPayload
  ) {
    return (
      granelPayload.lote ||
      granelPayload.lotes?.[0]?.lote ||
      fallback ||
      ""
    );
  }
  return (
    lotesLabelFromValidacaoOrigens(transbordoPayload?.origens) ||
    transbordoPayload?.origens?.[0]?.lote ||
    fallback ||
    ""
  );
}

function asJsonObject(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed != null ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? value : null;
}

/**
 * Propaga identidade (lote/produto/cliente) para validações criadas pela
 * Ordem de Transbordo Operacional — snapshots em t_transbordo_validacoes.
 */
export async function cascadeValidacoesIdentity(pairs = []) {
  const changedPairs = pairs.filter((p) => identityChanged(p.before, p.after));
  if (changedPairs.length === 0) return { validacoes: 0 };

  const estoqueIds = new Set(
    changedPairs.map((p) => normId(p.estoqueId)).filter(Boolean)
  );
  const oldLotes = new Set(
    changedPairs.map((p) => normCode(p.before?.lote)).filter(Boolean)
  );

  let validacoes = [];
  try {
    validacoes = await entities.transbordoValidacoes.list("-created_at");
  } catch (err) {
    console.error(
      "[Transbordo] Falha ao listar validações para cascade de lote:",
      err
    );
    return { validacoes: 0 };
  }

  const updates = [];

  for (const v of validacoes || []) {
    const granel = asJsonObject(v.granel_payload) || v.granel_payload;
    const transbordo =
      asJsonObject(v.transbordo_payload) || v.transbordo_payload;

    let nextGranel = granel;
    let nextTransbordo = transbordo;
    let payloadChanged = false;
    let headerOnlyPair = null;
    let primaryPair = null;

    for (const pair of changedPairs) {
      if (!validacaoProdutoMatches(v, pair)) continue;

      const granelPatched = patchGranelPayloadIdentity(nextGranel, pair);
      if (granelPatched.changed) {
        nextGranel = granelPatched.payload;
        payloadChanged = true;
        primaryPair = pair;
      }

      const origens = nextTransbordo?.origens || [];
      if (!Array.isArray(origens) || origens.length === 0) continue;

      let origensChanged = false;
      const nextOrigens = origens.map((origem) => {
        const patched = patchValidacaoOrigem(origem, pair);
        if (patched.changed) {
          origensChanged = true;
          primaryPair = pair;
          return patched.origem;
        }
        return origem;
      });

      if (origensChanged) {
        nextTransbordo = { ...(nextTransbordo || {}), origens: nextOrigens };
        payloadChanged = true;
      }
    }

    // Cabeçalho ainda com lote antigo (tanka/vasilhame sem entrada_id de estoque)
    if (!payloadChanged && oldLotes.size > 0) {
      for (const pair of changedPairs) {
        if (!validacaoProdutoMatches(v, pair)) continue;
        if (!pair.before?.lote) continue;
        const headerHasOld =
          sameText(v.lote, pair.before.lote) ||
          String(v.lote || "")
            .split(/\s*\/\s*/)
            .map((p) => p.trim())
            .some((part) => sameText(part, pair.before.lote));
        if (!headerHasOld) continue;
        const linkedByEstoque = (transbordo?.origens || []).some(
          (o) =>
            o?.entrada_id != null && estoqueIds.has(normId(o.entrada_id))
        );
        const linkedByLotePayload = (transbordo?.origens || []).some((o) =>
          origemMatchesIdentityPair(o, pair)
        );
        // Sem vínculo no payload: só atualiza se o lote do cabeçalho for exatamente o antigo
        // e o produto bater (já filtrado) — cobre ordens TANKA com lote denormalizado.
        if (linkedByEstoque || linkedByLotePayload || headerHasOld) {
          headerOnlyPair = pair;
          primaryPair = pair;
          break;
        }
      }
    }

    if (!payloadChanged && !headerOnlyPair) continue;

    const nextLote = payloadChanged
      ? recomputeValidacaoLote(
          v.tipo,
          nextGranel,
          nextTransbordo,
          primaryPair
            ? replaceLoteToken(
                v.lote,
                primaryPair.before.lote,
                primaryPair.after.lote
              )
            : v.lote
        )
      : replaceLoteToken(
          v.lote,
          headerOnlyPair.before.lote,
          headerOnlyPair.after.lote
        );

    const patch = {
      id: v.id,
      lote: nextLote || v.lote || null,
    };

    if (payloadChanged && nextGranel !== granel) {
      patch.granel_payload = nextGranel;
    }
    if (payloadChanged && nextTransbordo !== transbordo) {
      patch.transbordo_payload = nextTransbordo;
    }

    if (primaryPair?.after) {
      if (primaryPair.after.produto_id != null) {
        patch.produto_id = primaryPair.after.produto_id;
      }
      if (primaryPair.after.produto_nome) {
        patch.produto_nome = primaryPair.after.produto_nome;
      }
      if (primaryPair.after.produto_codigo) {
        patch.produto_codigo = primaryPair.after.produto_codigo;
      }
      if (primaryPair.after.cliente_id != null) {
        patch.cliente_id = primaryPair.after.cliente_id;
      }
      if (primaryPair.after.cliente_nome) {
        patch.cliente_nome = primaryPair.after.cliente_nome;
      }
    }

    updates.push(patch);
  }

  if (updates.length > 0) {
    await entities.transbordoValidacoes.bulkUpdate(updates);
  }

  return { validacoes: updates.length };
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
  if (item?.tipo === "embalado" || item?.tipo === "ind_retorno_mp") return false;
  return Boolean(
    item?.vasilhame_id || item?.vasilhame_placa || item?.vasilhame_barril
  );
}

function vasilhamePlaca(vasilhame) {
  return vasilhame?.placa || vasilhame?.container_number || "";
}

function vasilhameBarril(vasilhame) {
  return vasilhame?.barril ?? vasilhame?.barril_number ?? "";
}

/** Lote exibido do tanque (edição manual prevalece sobre a composição). */
function loteAtualDoVasilhame(vasilhame) {
  return normCode(loteExibidoDoVasilhame(vasilhame) || vasilhame?.lote);
}

/**
 * Item da saída ligado ao tanque por id ou placa/barril.
 * `force` = tanque inteiro renomeado (um lote): atualiza qualquer snapshot.
 */
function itemMatchesVasilhameForLote(
  item,
  vasilhameId,
  vasilhame,
  { oldLote, force = false } = {}
) {
  if (!isSaidaVasilhameItem(item)) return false;
  const byId =
    Boolean(vasilhameId) &&
    String(item?.vasilhame_id || "") === String(vasilhameId);
  const byIdentity =
    Boolean(vasilhame) &&
    sameTanqueIdentity(
      vasilhamePlaca(vasilhame),
      vasilhameBarril(vasilhame),
      item?.vasilhame_placa,
      item?.vasilhame_barril
    );
  if (!byId && !byIdentity) return false;
  if (force) return true;
  const current = normCode(item?.lote);
  if (!current || isLoteNaoInformado(current)) return true;
  return sameText(current, oldLote);
}

function withSaidaItemLote(item, nextLote, vasilhame) {
  const lote = normCode(nextLote);
  const next = { ...item, lote };
  if (vasilhame?.id && String(item?.vasilhame_id || "") !== String(vasilhame.id)) {
    next.vasilhame_id = vasilhame.id;
  }
  const placa = normCode(vasilhamePlaca(vasilhame));
  const barril = normCode(vasilhameBarril(vasilhame));
  if (placa) next.vasilhame_placa = placa;
  if (barril) next.vasilhame_barril = barril;
  return next;
}

function patchSaidasLote(saidas, index, vasilhamePatches, vasilhamesAtuais = []) {
  const patchById = new Map(vasilhamePatches.map((patch) => [String(patch.id), patch]));
  const vasilhameById = new Map(
    (vasilhamesAtuais || []).map((vasilhame) => [String(vasilhame.id), vasilhame])
  );
  const list = vasilhamesAtuais || [];
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
      const resolved =
        (item.vasilhame_id && vasilhameById.get(String(item.vasilhame_id))) ||
        resolveVasilhameDaSaida(item, list);
      const patch = resolved
        ? patchById.get(String(resolved.id))
        : patchById.get(String(item.vasilhame_id));

      if (!patch) {
        // Tanque já alinhado (ou lote manual): a saída copia o lote atual do vasilhame.
        const atual = loteAtualDoVasilhame(resolved);
        if (isLoteNaoInformado(atual) || sameText(current, atual)) {
          if (
            resolved?.id &&
            String(item.vasilhame_id || "") !== String(resolved.id)
          ) {
            changed = true;
            return withSaidaItemLote(item, current || atual, resolved);
          }
          return item;
        }
        changed = true;
        return withSaidaItemLote(item, atual, resolved);
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
      return withSaidaItemLote(item, nextLote, resolved || vasilhameById.get(String(patch.id)));
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

/**
 * Copia o lote editado no vasilhame para as saídas já registradas desse tanque.
 * Casa por `vasilhame_id` ou placa/barril (id obsoleto após regravação do OP).
 * `force: true` (padrão) atualiza todo item ligado ao tanque — lote único renomeado.
 * `force: false` só troca o snapshot que ainda tem o lote antigo (multi-lote).
 */
export async function syncSaidaLoteDoVasilhame(
  vasilhameId,
  oldLote,
  newLote,
  { vasilhame = null, force = true } = {}
) {
  if (!vasilhameId || sameText(oldLote, newLote)) return;
  const nextLote = normCode(newLote);
  if (!nextLote) return;

  const saidas = await entities.saidas.list();
  const updates = [];
  for (const saida of saidas || []) {
    if (saida?.enviado_ao_fiscal || saida?.status === "enviado_fiscal") continue;
    let changed = false;
    const itens = (saida.itens || []).map((item) => {
      if (
        !itemMatchesVasilhameForLote(item, vasilhameId, vasilhame, {
          oldLote,
          force,
        })
      ) {
        return item;
      }
      if (sameText(item.lote, nextLote) && String(item.vasilhame_id || "") === String(vasilhameId)) {
        return item;
      }
      changed = true;
      return withSaidaItemLote(item, nextLote, vasilhame || { id: vasilhameId });
    });
    if (changed) updates.push({ id: saida.id, itens });
  }
  if (updates.length === 0) return;
  await entities.saidas.bulkUpdate(updates);
  if (!vasilhame) return;
  try {
    await syncChecklistMetricsForSaidaUpdates(updates, vasilhame);
  } catch (err) {
    console.error(
      "[Transbordo] Falha ao sincronizar checklist após ajuste de lote:",
      err
    );
  }
}

/**
 * Propaga placa/barril editados no vasilhame para saídas abertas e checklist
 * de carregamento. Não altera saídas já enviadas ao fiscal.
 */
export async function syncSaidaPlacaDoVasilhame(vasilhameId, vasilhame) {
  if (!vasilhameId || !vasilhame) return;
  const nextPlaca = String(vasilhame.placa || vasilhame.container_number || "").trim();
  const nextBarril = String(
    vasilhame.barril || vasilhame.barril_number || ""
  ).trim();
  const saidas = await entities.saidas.list();
  const updates = [];
  for (const saida of saidas || []) {
    if (saida?.enviado_ao_fiscal || saida?.status === "enviado_fiscal") continue;
    let changed = false;
    const itens = (saida.itens || []).map((item) => {
      if (String(item?.vasilhame_id || "") !== String(vasilhameId)) return item;
      if (!isSaidaVasilhameItem(item)) return item;
      if (
        sameText(item.vasilhame_placa, nextPlaca) &&
        sameText(item.vasilhame_barril, nextBarril)
      ) {
        return item;
      }
      changed = true;
      return {
        ...item,
        vasilhame_placa: nextPlaca,
        vasilhame_barril: nextBarril,
      };
    });
    if (changed) updates.push({ id: saida.id, itens });
  }
  if (updates.length === 0) return;
  await entities.saidas.bulkUpdate(updates);
  try {
    await syncChecklistMetricsForSaidaUpdates(updates, vasilhame);
  } catch (err) {
    console.error(
      "[Transbordo] Falha ao sincronizar checklist após ajuste de placa/barril:",
      err
    );
  }
}

/**
 * Atualiza quantidade / peso líquido / volume nos snapshots de checklist
 * das saídas afetadas (agendamentos com checklist_respostas).
 */
async function syncChecklistMetricsForSaidaUpdates(saidaUpdates, vasilhame) {
  if (!saidaUpdates?.length) return;
  const bySaidaId = new Map(
    saidaUpdates.map((u) => [String(u.id), u])
  );
  let bookings = [];
  try {
    bookings = (await entities.agendamentosCarregamento.list()) || [];
  } catch (err) {
    console.error(
      "[Transbordo] Falha ao listar agendamentos para sync do checklist:",
      err
    );
    return;
  }

  const bookingUpdates = [];
  for (const booking of bookings) {
    const update = bySaidaId.get(String(booking?.saida_id || ""));
    if (!update) continue;
    const parsed = parseStoredChecklist(booking.checklist_respostas);
    if (!parsed.items?.length) continue;

    const linhaByVasilhame = new Map();
    for (const linha of update.itens || []) {
      if (linha?.vasilhame_id) {
        linhaByVasilhame.set(String(linha.vasilhame_id), linha);
      }
    }

    let changed = false;
    const items = parsed.items.map((it) => {
      const linha = it?.vasilhame_id
        ? linhaByVasilhame.get(String(it.vasilhame_id))
        : null;
      if (!linha) return it;
      const next = patchChecklistItemFromSaidaLinha(it, linha, vasilhame);
      if (
        next.quantidade !== it.quantidade ||
        Number(next.peso_liquido) !== Number(it.peso_liquido) ||
        Number(next.volume_solicitado) !== Number(it.volume_solicitado) ||
        Number(next.peso_bruto) !== Number(it.peso_bruto) ||
        !sameText(next.lote, it.lote) ||
        !sameText(next.vasilhame_placa, it.vasilhame_placa) ||
        !sameText(next.vasilhame_barril, it.vasilhame_barril) ||
        next.label !== it.label
      ) {
        changed = true;
      }
      return next;
    });
    if (!changed) continue;

    bookingUpdates.push({
      id: booking.id,
      checklist_respostas: {
        ...parsed,
        version: 2,
        items,
        saved_at: new Date().toISOString(),
      },
    });
  }

  if (bookingUpdates.length > 0) {
    await entities.agendamentosCarregamento.bulkUpdate(bookingUpdates);
  }
}

/**
 * Propaga volume/peso editado no vasilhame para saídas abertas desse tanque
 * (solicitação de saída / checklist). Não altera saídas já enviadas ao fiscal.
 */
export async function syncSaidaVolumeDoVasilhame(
  vasilhameId,
  vasilhame,
  { transbordos = [], previousVolume } = {}
) {
  if (!vasilhameId || !vasilhame) return;
  const saidas = await entities.saidas.list();
  const updates = [];
  const alignOpts = { previousVolume };
  for (const saida of saidas || []) {
    if (saida?.enviado_ao_fiscal || saida?.status === "enviado_fiscal") continue;
    let changed = false;
    const itens = (saida.itens || []).map((item) => {
      if (String(item?.vasilhame_id || "") !== String(vasilhameId)) return item;
      if (!isSaidaVasilhameItem(item)) return item;
      let next = alignSaidaItemVolumeToVasilhame(
        item,
        vasilhame,
        transbordos,
        alignOpts
      );
      next = refreshSaidaItemMassaFromVasilhame(next, vasilhame, transbordos);
      if (next !== item) changed = true;
      return next;
    });
    if (!changed) continue;
    const quantidade_total = calcSaidaQuantidadeTotal(itens, {
      vasilhames: [vasilhame],
      transbordos,
    });
    updates.push({ id: saida.id, itens, quantidade_total });
  }
  if (updates.length === 0) return;
  await entities.saidas.bulkUpdate(updates);
  try {
    await syncChecklistMetricsForSaidaUpdates(updates, vasilhame);
  } catch (err) {
    console.error(
      "[Transbordo] Falha ao sincronizar checklist após ajuste de volume:",
      err
    );
  }
}

/** Lote que parece quantidade (ex.: "38.581,575") — snapshot corrompido. */
function looksLikeQuantidadeAsLote(lote) {
  const s = normCode(lote);
  if (!s) return false;
  // BR: 38.581,575 | 38581,575 | EN: 38581.575
  return (
    /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ||
    /^\d+,\d+$/.test(s) ||
    /^\d+\.\d+$/.test(s)
  );
}

function resolveLotePadraoTanka(origem, orderedTransbordos) {
  const tankaId = origem?.entrada_id || origem?.tanka_id;
  if (!tankaId) return "";
  const all = computeTankaLotesDisponiveis({
    isotanqueId: tankaId,
    tankaCodigo: origem.tanka_codigo || "",
    transbordos: orderedTransbordos,
  }).map((item) => ({
    lote: normCode(item.lote),
    volume: Number(item.quantidade_l) || 0,
  }));

  // Ignora "lotes" que são quantidade numérica (snapshot corrompido).
  const lotesDaTanka = all.filter(
    (item) =>
      item.lote &&
      !isLoteNaoInformado(item.lote) &&
      !looksLikeQuantidadeAsLote(item.lote)
  );

  if (lotesDaTanka.length === 0) return "";
  if (lotesDaTanka.length === 1) return lotesDaTanka[0].lote;

  const current = normCode(origem?.lote);
  const currentIsBad =
    !current ||
    looksLikeQuantidadeAsLote(current) ||
    !lotesDaTanka.some((item) => sameText(item.lote, current));

  // Multi-lote legítimo: não sobrescreve lote ainda presente na tanka
  if (!currentIsBad) return "";

  lotesDaTanka.sort((a, b) => b.volume - a.volume);
  return lotesDaTanka[0].lote;
}

function applyLoteReplacementOnOrigem(origem, nextLote) {
  const from = normCode(origem?.lote);
  const to = normCode(nextLote);
  if (!to || sameText(from, to)) {
    // Ainda assim pode precisar corrigir lotes_retirados órfãos
    if (!Array.isArray(origem?.lotes_retirados) || origem.lotes_retirados.length === 0) {
      return { origem, changed: false };
    }
  }

  let next = {
    ...origem,
    lote: to || origem.lote,
    entrada_codigo: replaceLoteInCodigo(
      origem.entrada_codigo,
      from || origem.lote,
      to
    ),
  };
  let changed = !sameText(from, to);

  if (Array.isArray(origem.lotes_retirados) && origem.lotes_retirados.length > 0) {
    const lotes_retirados = origem.lotes_retirados.map((item) => {
      const itemLote = normCode(item?.lote);
      if (
        sameText(itemLote, to) ||
        (!looksLikeQuantidadeAsLote(itemLote) &&
          itemLote &&
          !sameText(itemLote, from) &&
          from)
      ) {
        // Mantém retirados de outros lotes legítimos em multi-lote
        if (!from || sameText(itemLote, from) || looksLikeQuantidadeAsLote(itemLote)) {
          if (sameText(itemLote, to)) return item;
          changed = true;
          return { ...item, lote: to };
        }
        return item;
      }
      if (
        sameText(itemLote, from) ||
        looksLikeQuantidadeAsLote(itemLote) ||
        !itemLote
      ) {
        changed = true;
        return { ...item, lote: to };
      }
      return item;
    });
    next = { ...next, lotes_retirados };
  }

  return { origem: next, changed };
}

/**
 * Realinha lotes congelados em t_transbordo_validacoes a partir do estoque
 * atual e dos OPs já healados (TANKA, embalado, lotes órfãos/numéricos).
 */
export async function healValidacoesLotes({
  estoqueRows = [],
  transbordos = [],
  validacoes: validacoesInput = null,
  loteReplacements = null,
} = {}) {
  let validacoes = validacoesInput;
  if (!validacoes) {
    try {
      validacoes = await entities.transbordoValidacoes.list("-created_at");
    } catch (err) {
      console.error(
        "[Transbordo] Falha ao listar validações para heal de lote:",
        err
      );
      return { validacoes: 0 };
    }
  }
  if (!validacoes?.length) return { validacoes: 0 };

  const index = indexEstoqueRows(estoqueRows);
  const ordered = sortTransbordosChrono(transbordos || []);
  const replacements =
    loteReplacements instanceof Map
      ? loteReplacements
      : new Map(
          Object.entries(loteReplacements || {}).map(([k, v]) => [
            normCode(k),
            normCode(v),
          ])
        );

  /** Lote legítimo mais comum por produto (irmão pendente/validado). */
  const loteCountsPorProduto = new Map();
  for (const row of validacoes) {
    const lote = normCode(row?.lote);
    if (!lote || looksLikeQuantidadeAsLote(lote) || isLoteNaoInformado(lote)) {
      continue;
    }
    const key =
      normId(row.produto_id) ||
      normCode(row.produto_codigo) ||
      normCode(row.produto_nome);
    if (!key) continue;
    if (!loteCountsPorProduto.has(key)) loteCountsPorProduto.set(key, new Map());
    const byLote = loteCountsPorProduto.get(key);
    byLote.set(lote, (byLote.get(lote) || 0) + 1);
  }
  const loteCanonicoPorProduto = new Map();
  for (const [key, byLote] of loteCountsPorProduto) {
    let best = null;
    for (const [lote, count] of byLote) {
      if (!best || count > best.count) best = { lote, count };
    }
    if (best) loteCanonicoPorProduto.set(key, best);
  }

  const updates = [];

  for (const v of validacoes) {
    const granel = asJsonObject(v.granel_payload) || v.granel_payload;
    const transbordo =
      asJsonObject(v.transbordo_payload) || v.transbordo_payload;
    let nextGranel = granel;
    let nextTransbordo = transbordo;
    let changed = false;

    if (Array.isArray(granel?.lotes) && granel.lotes.length > 0) {
      let lotesChanged = false;
      const lotes = granel.lotes.map((lote) => {
        const estoque = index.byId.get(
          normId(lote?.estoque_id || lote?.entrada_id)
        );
        let nextLote = normCode(estoque?.lote);
        if (!nextLote && replacements.size > 0) {
          nextLote = replacements.get(normCode(lote?.lote)) || "";
        }
        if (!nextLote || sameText(lote?.lote, nextLote)) return lote;
        lotesChanged = true;
        return { ...lote, lote: nextLote };
      });
      if (lotesChanged) {
        nextGranel = {
          ...granel,
          lotes,
          lote: lotes[0]?.lote || granel.lote,
        };
        changed = true;
      }
    } else if (granel && replacements.size > 0) {
      const mapped = replacements.get(normCode(granel.lote));
      if (mapped && !sameText(granel.lote, mapped)) {
        nextGranel = { ...granel, lote: mapped };
        changed = true;
      }
    }

    const origens = nextTransbordo?.origens || [];
    if (Array.isArray(origens) && origens.length > 0) {
      let origensChanged = false;
      const nextOrigens = origens.map((origem) => {
        let next = origem;
        let localChanged = false;

        const estoque = resolveEstoqueForOrigem(origem, index);
        const nextLoteEstoque = normCode(estoque?.lote);
        if (estoque && nextLoteEstoque && !sameText(origem.lote, nextLoteEstoque)) {
          const patched = applyLoteReplacementOnOrigem(origem, nextLoteEstoque);
          next = patched.origem;
          localChanged = patched.changed;
        }

        const isTanka =
          origem?.tipo_origem === "tanka" ||
          v.origem_tipo === "tanka" ||
          Boolean(origem?.tanka_id || origem?.tanka_codigo);

        if (isTanka) {
          let lotePadrao = resolveLotePadraoTanka(next, ordered);
          if (!lotePadrao && replacements.size > 0) {
            lotePadrao =
              replacements.get(normCode(next.lote)) ||
              replacements.get(normCode(origem.lote)) ||
              "";
          }
          // Cabeçalho numérico / órfão: força o lote canônico da tanka ou do replacement
          if (
            !lotePadrao &&
            looksLikeQuantidadeAsLote(next.lote) &&
            replacements.size === 1
          ) {
            lotePadrao = [...replacements.values()][0];
          }
          if (lotePadrao && !sameText(next.lote, lotePadrao)) {
            const patched = applyLoteReplacementOnOrigem(next, lotePadrao);
            next = patched.origem;
            localChanged = localChanged || patched.changed;
          } else if (
            looksLikeQuantidadeAsLote(next.lote) &&
            lotePadrao &&
            sameText(next.lote, lotePadrao)
          ) {
            // no-op
          }
        } else if (replacements.size > 0) {
          const mapped = replacements.get(normCode(next.lote));
          if (mapped && !sameText(next.lote, mapped)) {
            const patched = applyLoteReplacementOnOrigem(next, mapped);
            next = patched.origem;
            localChanged = localChanged || patched.changed;
          }
        }

        if (localChanged) origensChanged = true;
        return next;
      });

      if (origensChanged) {
        nextTransbordo = { ...(nextTransbordo || {}), origens: nextOrigens };
        changed = true;
      }
    }

    // Cabeçalho ainda com quantidade-como-lote (ex.: item 70 → irmãos PA26)
    if (!changed && looksLikeQuantidadeAsLote(v.lote)) {
      const origemTanka = (transbordo?.origens || []).find(
        (o) =>
          o?.tipo_origem === "tanka" ||
          o?.tanka_id ||
          v.origem_tipo === "tanka"
      );
      let lotePadrao = origemTanka
        ? resolveLotePadraoTanka(origemTanka, ordered)
        : "";
      if (!lotePadrao && replacements.size === 1) {
        lotePadrao = [...replacements.values()][0];
      }
      if (!lotePadrao) {
        const produtoKey =
          normId(v.produto_id) ||
          normCode(v.produto_codigo) ||
          normCode(v.produto_nome);
        lotePadrao = loteCanonicoPorProduto.get(produtoKey)?.lote || "";
      }
      if (lotePadrao && !sameText(v.lote, lotePadrao)) {
        if (origemTanka && nextTransbordo?.origens) {
          const nextOrigens = (nextTransbordo.origens || []).map((origem) => {
            if (
              !(
                origem?.tipo_origem === "tanka" ||
                origem?.tanka_id ||
                v.origem_tipo === "tanka"
              )
            ) {
              return origem;
            }
            const patched = applyLoteReplacementOnOrigem(origem, lotePadrao);
            return patched.changed ? patched.origem : origem;
          });
          nextTransbordo = { ...(nextTransbordo || {}), origens: nextOrigens };
        }
        const patch = {
          id: v.id,
          lote: lotePadrao,
        };
        if (nextTransbordo !== transbordo) {
          patch.transbordo_payload = nextTransbordo;
        }
        updates.push(patch);
        continue;
      }
    }

    if (!changed) {
      // Só cabeçalho via replacement map
      const mappedHeader = replacements.get(normCode(v.lote));
      if (mappedHeader && !sameText(v.lote, mappedHeader)) {
        updates.push({ id: v.id, lote: mappedHeader });
      }
      continue;
    }

    const nextLote = recomputeValidacaoLote(
      v.tipo,
      nextGranel,
      nextTransbordo,
      looksLikeQuantidadeAsLote(v.lote) ? "" : v.lote
    );

    const patch = {
      id: v.id,
      lote: nextLote || v.lote || null,
    };
    if (nextGranel !== granel) patch.granel_payload = nextGranel;
    if (nextTransbordo !== transbordo) patch.transbordo_payload = nextTransbordo;
    updates.push(patch);
  }

  if (updates.length > 0) {
    await entities.transbordoValidacoes.bulkUpdate(updates);
  }
  return { validacoes: updates.length, updates };
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

  const transbordosHealed = mergeById(transbordoRows, plan.transbordoUpdates);
  let validacoesHealed = 0;
  try {
    const healed = await healValidacoesLotes({
      estoqueRows: estoque,
      transbordos: transbordosHealed,
    });
    validacoesHealed = healed?.validacoes || 0;
  } catch (err) {
    console.error("[Transbordo] Falha ao alinhar lote das validações:", err);
  }

  return {
    ...plan,
    validacoes: validacoesHealed,
    transbordos: transbordosHealed,
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
    return {
      transbordos: 0,
      saidas: 0,
      vasilhames: 0,
      filtracoes: 0,
      validacoes: 0,
    };
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

  const [, , , , validacaoCascade] = await Promise.all([
    entities.transbordos.bulkUpdate(transbordoUpdates),
    entities.saidas.bulkUpdate(saidaUpdates),
    entities.vasilhames.bulkUpdate(vasilhameUpdates),
    entities.filtracoes.bulkUpdate(filtracaoUpdates),
    cascadeValidacoesIdentity(changedPairs).catch((err) => {
      console.error(
        "[Transbordo] Falha ao cascatear lote nas validações:",
        err
      );
      return { validacoes: 0 };
    }),
  ]);

  return {
    transbordos: transbordoUpdates.length,
    saidas: saidaUpdates.length,
    vasilhames: vasilhameUpdates.length,
    filtracoes: filtracaoUpdates.length,
    validacoes: validacaoCascade?.validacoes || 0,
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
