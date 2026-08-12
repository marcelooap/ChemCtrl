import { entities } from "@transbordo/services/entities";

/**
 * Ao alterar nome/código no cadastro de produtos, propaga os snapshots
 * denormalizados para estoque e tabelas operacionais vinculadas por produto_id.
 */

function sameText(a, b) {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

function normChave(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

/** Mesma regra de agregação usada em reservas comerciais. */
function buildReservaChave({
  clienteId,
  clienteNome,
  produtoCodigo,
  lote,
  unidade,
}) {
  const cliente = clienteId || normChave(clienteNome) || "";
  return [
    cliente,
    normChave(produtoCodigo),
    normChave(lote),
    String(unidade || "kg").trim(),
  ].join("||");
}

function productIdentityChanged(before, after) {
  return (
    !sameText(before?.codigo, after?.codigo) ||
    !sameText(before?.produto, after?.produto)
  );
}

function matchesProdutoRow(row, produtoId, beforeCodigo) {
  if (produtoId && sameText(row?.produto_id, produtoId)) return true;
  // Legado: sem FK, mas com o código antigo do produto
  if (
    !row?.produto_id &&
    beforeCodigo &&
    sameText(row?.produto_codigo, beforeCodigo)
  ) {
    return true;
  }
  return false;
}

function patchLotes(lotes, { produtoId, beforeCodigo, afterNome, afterCodigo }) {
  if (!Array.isArray(lotes) || lotes.length === 0) {
    return { lotes, changed: false };
  }

  let changed = false;
  const next = lotes.map((lote) => {
    const byId = produtoId && sameText(lote?.produto_id, produtoId);
    const byCodigo =
      beforeCodigo && sameText(lote?.produto_codigo, beforeCodigo);
    const singleHeader =
      lotes.length === 1 &&
      !lote?.produto_id &&
      !lote?.produto_codigo;

    if (!byId && !byCodigo && !singleHeader) return lote;

    const patched = {
      ...lote,
      produto_id: produtoId || lote.produto_id || null,
      produto_nome: afterNome,
      produto_codigo: afterCodigo,
    };
    if (
      !sameText(lote.produto_nome, patched.produto_nome) ||
      !sameText(lote.produto_codigo, patched.produto_codigo) ||
      !sameText(lote.produto_id, patched.produto_id)
    ) {
      changed = true;
    }
    return patched;
  });

  return { lotes: next, changed };
}

function buildHeaderPatch(row, { produtoId, afterNome, afterCodigo }) {
  return {
    id: row.id,
    produto_id: produtoId || row.produto_id || null,
    produto_nome: afterNome,
    produto_codigo: afterCodigo,
  };
}

/**
 * @param {{ produtoId: string, before: { codigo?: string, produto?: string }, after: { codigo?: string, produto?: string } }} args
 */
export async function cascadeProdutoIdentity({ produtoId, before, after }) {
  if (!produtoId || !productIdentityChanged(before, after)) {
    return {
      estoque: 0,
      entradas: 0,
      transbordos: 0,
      vasilhames: 0,
      filtracoes: 0,
      isotanques: 0,
      saidas: 0,
      reservas: 0,
    };
  }

  const afterNome = String(after?.produto ?? "").trim();
  const afterCodigo = String(after?.codigo ?? "").trim();
  const beforeCodigo = String(before?.codigo ?? "").trim();
  const identity = { produtoId, beforeCodigo, afterNome, afterCodigo };

  const [
    estoqueRows,
    entradasRows,
    transbordos,
    vasilhames,
    filtracoes,
    isotanques,
    saidas,
    reservas,
  ] = await Promise.all([
    entities.estoque.filter({ produto_id: produtoId }).catch(() => []),
    entities.entradas.filter({ produto_id: produtoId }).catch(() => []),
    entities.transbordos.filter({ produto_id: produtoId }).catch(() => []),
    entities.vasilhames.filter({ produto_id: produtoId }).catch(() => []),
    entities.filtracoes.filter({ produto_id: produtoId }).catch(() => []),
    entities.isotanques.filter({ produto_id: produtoId }).catch(() => []),
    entities.saidas.list().catch(() => []),
    entities.materialReservas.filter({ produto_id: produtoId }).catch(() => []),
  ]);

  // Complementa com registros legados sem produto_id (mesmo código antigo)
  let estoqueLegacy = [];
  let entradasLegacy = [];
  if (beforeCodigo) {
    const [estByCodigo, entByCodigo] = await Promise.all([
      entities.estoque.filter({ produto_codigo: beforeCodigo }).catch(() => []),
      entities.entradas.filter({ produto_codigo: beforeCodigo }).catch(() => []),
    ]);
    const estoqueIds = new Set((estoqueRows || []).map((r) => r.id));
    const entradaIds = new Set((entradasRows || []).map((r) => r.id));
    estoqueLegacy = (estByCodigo || []).filter(
      (r) => !r.produto_id && !estoqueIds.has(r.id)
    );
    entradasLegacy = (entByCodigo || []).filter(
      (r) => !r.produto_id && !entradaIds.has(r.id)
    );
  }

  const estoqueUpdates = [...(estoqueRows || []), ...estoqueLegacy]
    .map((row) => {
      if (!matchesProdutoRow(row, produtoId, beforeCodigo)) return null;
      const header = buildHeaderPatch(row, identity);
      const { lotes, changed: lotesChanged } = patchLotes(row.lotes, identity);
      const headerChanged =
        !sameText(row.produto_nome, afterNome) ||
        !sameText(row.produto_codigo, afterCodigo) ||
        !sameText(row.produto_id, produtoId);
      if (!headerChanged && !lotesChanged) return null;
      return { ...header, lotes };
    })
    .filter(Boolean);

  const entradaUpdates = [...(entradasRows || []), ...entradasLegacy]
    .map((row) => {
      if (!matchesProdutoRow(row, produtoId, beforeCodigo)) return null;
      const header = buildHeaderPatch(row, identity);
      const { lotes, changed: lotesChanged } = patchLotes(row.lotes, identity);
      const headerChanged =
        !sameText(row.produto_nome, afterNome) ||
        !sameText(row.produto_codigo, afterCodigo) ||
        !sameText(row.produto_id, produtoId);
      if (!headerChanged && !lotesChanged) return null;
      return { ...header, lotes };
    })
    .filter(Boolean);

  const transbordoUpdates = (transbordos || [])
    .filter((row) => matchesProdutoRow(row, produtoId, beforeCodigo))
    .filter(
      (row) =>
        !sameText(row.produto_nome, afterNome) ||
        !sameText(row.produto_codigo, afterCodigo)
    )
    .map((row) => buildHeaderPatch(row, identity));

  const vasilhameUpdates = (vasilhames || [])
    .filter((row) => matchesProdutoRow(row, produtoId, beforeCodigo))
    .filter(
      (row) =>
        !sameText(row.produto_nome, afterNome) ||
        !sameText(row.produto_codigo, afterCodigo)
    )
    .map((row) => buildHeaderPatch(row, identity));

  const filtracaoUpdates = (filtracoes || [])
    .filter((row) => matchesProdutoRow(row, produtoId, beforeCodigo))
    .filter(
      (row) =>
        !sameText(row.produto_nome, afterNome) ||
        !sameText(row.produto_codigo, afterCodigo)
    )
    .map((row) => buildHeaderPatch(row, identity));

  const isotanqueUpdates = (isotanques || [])
    .filter((row) => matchesProdutoRow(row, produtoId, beforeCodigo))
    .filter((row) => !sameText(row.produto_nome, afterNome))
    .map((row) => ({
      id: row.id,
      produto_id: produtoId || row.produto_id || null,
      produto_nome: afterNome,
    }));

  const saidaUpdates = [];
  for (const saida of saidas || []) {
    let changed = false;
    const nextItens = (saida.itens || []).map((item) => {
      const byId = produtoId && sameText(item?.produto_id, produtoId);
      const byCodigo =
        !item?.produto_id &&
        beforeCodigo &&
        sameText(item?.produto_codigo, beforeCodigo);
      if (!byId && !byCodigo) return item;
      const next = {
        ...item,
        produto_id: produtoId || item.produto_id || null,
        produto_nome: afterNome,
        produto_codigo: afterCodigo,
      };
      if (
        !sameText(item.produto_nome, next.produto_nome) ||
        !sameText(item.produto_codigo, next.produto_codigo) ||
        !sameText(item.produto_id, next.produto_id)
      ) {
        changed = true;
      }
      return next;
    });
    if (changed) {
      saidaUpdates.push({ id: saida.id, itens: nextItens });
    }
  }

  const reservaUpdates = (reservas || [])
    .filter((row) => matchesProdutoRow(row, produtoId, beforeCodigo))
    .map((row) => {
      const nextCodigo = afterCodigo;
      const nextNome = afterNome;
      const nextChave = buildReservaChave({
        clienteId: row.cliente_id,
        clienteNome: row.cliente_nome,
        produtoCodigo: nextCodigo,
        lote: row.lote,
        unidade: row.unidade_medida,
      });
      if (
        sameText(row.produto_nome, nextNome) &&
        sameText(row.produto_codigo, nextCodigo) &&
        sameText(row.chave, nextChave) &&
        sameText(row.produto_id, produtoId)
      ) {
        return null;
      }
      return {
        id: row.id,
        produto_id: produtoId || row.produto_id || null,
        produto_nome: nextNome,
        produto_codigo: nextCodigo,
        chave: nextChave,
      };
    })
    .filter(Boolean);

  await Promise.all([
    entities.estoque.bulkUpdate(estoqueUpdates),
    entities.entradas.bulkUpdate(entradaUpdates),
    entities.transbordos.bulkUpdate(transbordoUpdates),
    entities.vasilhames.bulkUpdate(vasilhameUpdates),
    entities.filtracoes.bulkUpdate(filtracaoUpdates),
    entities.isotanques.bulkUpdate(isotanqueUpdates),
    entities.saidas.bulkUpdate(saidaUpdates),
    entities.materialReservas.bulkUpdate(reservaUpdates),
  ]);

  return {
    estoque: estoqueUpdates.length,
    entradas: entradaUpdates.length,
    transbordos: transbordoUpdates.length,
    vasilhames: vasilhameUpdates.length,
    filtracoes: filtracaoUpdates.length,
    isotanques: isotanqueUpdates.length,
    saidas: saidaUpdates.length,
    reservas: reservaUpdates.length,
  };
}
