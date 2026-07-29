import { entities } from "@chemflow/services/entities";
import { syncEstoqueSaldos } from "@chemflow/lib/estoqueSaldo";
import { getDominantLote } from "@chemflow/lib/vasilhameComposicao";

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
  // Fallback: mesmo lote antigo no tanque do produto vinculado
  if (
    sameText(ctx.vasilhameLote, pair.before.lote) ||
    sameText(ctx.vasilhameProdutoId, pair.before.produto_id) ||
    sameText(ctx.vasilhameProdutoCodigo, pair.before.produto_codigo)
  ) {
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
        anyChange = true;
      }

      // Cabeçalho do vasilhame quando o lote dominante era o antigo
      if (
        sameText(v.lote, pair.before.lote) &&
        (affectedTransbordoIds.has(v.transbordo_id) ||
          sameText(v.produto_id, pair.before.produto_id) ||
          sameText(v.produto_codigo, pair.before.produto_codigo))
      ) {
        anyChange = true;
      }
    }

    if (!anyChange) continue;

    const dominant = getDominantLote(composicao);
    const primaryPair =
      changedPairs.find(
        (p) =>
          sameText(v.lote, p.before.lote) ||
          sameText(v.produto_id, p.before.produto_id)
      ) || changedPairs[0];

    vasilhameUpdates.push({
      id: v.id,
      composicao,
      lote: dominant || primaryPair?.after.lote || v.lote || "",
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
        (affectedTransbordoIds.has(f.transbordo_id) ||
          sameText(f.produto_id, pair.before.produto_id) ||
          sameText(f.produto_codigo, pair.before.produto_codigo))
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
  const [existingEstoque, allTransbordos, allSaidas] = await Promise.all([
    entities.estoque.filter({ entrada_id: entradaId }),
    entities.transbordos.list(),
    entities.saidas.list(),
  ]);

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

  const estoqueIds = savedEstoques.map((e) => e.id).filter(Boolean);
  if (estoqueIds.length > 0) {
    await syncEstoqueSaldos(estoqueIds);
  }

  return { savedEstoques, cascade };
}
