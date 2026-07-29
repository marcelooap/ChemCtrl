/**
 * Localiza OPs de transbordo vinculados a uma entrada.
 * Inclui:
 * - OPs diretos (origem = estoque/entrada)
 * - OPs posteriores na cadeia (ex.: tanka → vasilhame após entrada → tanka)
 */

function norm(v) {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

function collectCandidateIds(prefillEntrada, estoqueList = []) {
  const ids = new Set();
  const saved = prefillEntrada?.savedEstoques || prefillEntrada?.savedEntradas || [];

  for (const e of saved) {
    if (e?.id) ids.add(e.id);
    if (e?.entrada_id) ids.add(e.entrada_id);
  }

  const entradaId = prefillEntrada?.id;
  if (entradaId) {
    ids.add(entradaId);
    for (const e of estoqueList || []) {
      if (e?.entrada_id === entradaId && e?.id) ids.add(e.id);
    }
  }

  return ids;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getOrigens(t) {
  return parseJsonArray(t?.origens);
}

function getDestinos(t) {
  return parseJsonArray(t?.destinos);
}

function collectLotes(prefillEntrada, estoqueList = []) {
  const lotes = new Set();
  for (const lt of prefillEntrada?.lotes || []) {
    if (lt?.lote) lotes.add(norm(lt.lote));
  }
  for (const e of prefillEntrada?.savedEstoques || prefillEntrada?.savedEntradas || []) {
    if (e?.lote) lotes.add(norm(e.lote));
  }
  const entradaId = prefillEntrada?.id;
  if (entradaId) {
    for (const e of estoqueList || []) {
      if (e?.entrada_id === entradaId && e?.lote) lotes.add(norm(e.lote));
    }
  }
  if (prefillEntrada?.lote) lotes.add(norm(prefillEntrada.lote));
  return lotes;
}

function sortNewestFirst(list) {
  return [...list].sort((a, b) => {
    const da = new Date(a.created_at || a.created_date || 0).getTime();
    const db = new Date(b.created_at || b.created_date || 0).getTime();
    return db - da;
  });
}

function sortOldestFirst(list) {
  return [...list].sort((a, b) => {
    const da = new Date(a.created_at || a.created_date || 0).getTime();
    const db = new Date(b.created_at || b.created_date || 0).getTime();
    return da - db;
  });
}

function normalizeTransbordo(t) {
  if (!t) return null;
  return {
    ...t,
    origens: getOrigens(t),
    destinos: getDestinos(t),
  };
}

/**
 * Recursos criados/usados nos destinos de um OP (para achar OPs posteriores).
 */
function collectDestinoResources(transbordo, vasilhamesList = []) {
  const ids = new Set();
  const placas = new Set();

  for (const d of getDestinos(transbordo)) {
    if (d?.tanka_id) ids.add(d.tanka_id);
    if (d?.vasilhame_existente_id) ids.add(d.vasilhame_existente_id);
    if (d?.placa) placas.add(norm(d.placa));
  }

  // Vasilhames gerados por este OP
  for (const v of vasilhamesList || []) {
    if (v?.transbordo_id === transbordo.id) {
      if (v.id) ids.add(v.id);
      if (v.placa) placas.add(norm(v.placa));
    }
  }

  return { ids, placas };
}

function origemMatchesResources(origem, resources) {
  if (!origem) return false;
  if (origem.entrada_id && resources.ids.has(origem.entrada_id)) return true;
  if (origem.tanka_id && resources.ids.has(origem.tanka_id)) return true;
  if (origem.vasilhame_id && resources.ids.has(origem.vasilhame_id)) return true;

  const codigo = norm(origem.entrada_codigo || "");
  if (codigo && resources.placas.size > 0) {
    for (const placa of resources.placas) {
      if (placa && codigo.includes(placa)) return true;
    }
  }
  return false;
}

/**
 * Retorna todos os OPs ligados à entrada (diretos + cadeia posterior).
 * Ordenados do mais antigo (OP de entrada) para o mais novo.
 */
export function findAllLinkedTransbordos(
  transbordos,
  prefillEntrada,
  estoqueList = [],
  vasilhamesList = []
) {
  if (!prefillEntrada || !Array.isArray(transbordos) || transbordos.length === 0) {
    return [];
  }

  const candidateIds = collectCandidateIds(prefillEntrada, estoqueList);
  const linked = new Map();

  // 1) OPs diretos: origem aponta para estoque/entrada
  for (const t of transbordos) {
    const direct = getOrigens(t).some(
      (o) => o?.entrada_id && candidateIds.has(o.entrada_id)
    );
    if (direct) linked.set(t.id, normalizeTransbordo(t));
  }

  // 2) Cadeia posterior: destinos do OP viram origem de OPs seguintes
  let grew = true;
  while (grew) {
    grew = false;
    const resources = { ids: new Set(), placas: new Set() };
    for (const t of linked.values()) {
      const r = collectDestinoResources(t, vasilhamesList);
      r.ids.forEach((id) => resources.ids.add(id));
      r.placas.forEach((p) => resources.placas.add(p));
    }

    for (const t of transbordos) {
      if (linked.has(t.id)) continue;
      const downstream = getOrigens(t).some((o) =>
        origemMatchesResources(o, resources)
      );
      if (downstream) {
        linked.set(t.id, normalizeTransbordo(t));
        grew = true;
      }
    }
  }

  // 3) Se ainda não achou diretos, fallback por produto+lote (só para seed)
  if (linked.size === 0) {
    const lotes = collectLotes(prefillEntrada, estoqueList);
    const produtoId = prefillEntrada.produto_id;
    const produtoNome = norm(prefillEntrada.produto_nome);
    if (lotes.size > 0 || produtoId || produtoNome) {
      for (const t of transbordos) {
        const sameProduto =
          (produtoId && t.produto_id === produtoId) ||
          (produtoNome && norm(t.produto_nome) === produtoNome);
        if (!sameProduto) continue;
        const origens = getOrigens(t);
        const matchLote =
          lotes.size === 0
            ? origens.length > 0
            : origens.some((o) => o?.lote && lotes.has(norm(o.lote)));
        if (matchLote) linked.set(t.id, normalizeTransbordo(t));
      }
    }
  }

  return sortOldestFirst([...linked.values()]);
}

/**
 * Retorna o OP de entrada (mais antigo direto) quando há exatamente 1 OP na cadeia.
 * Se houver 0 ou 2+, retorna null (edição via "Ir para Transbordo" não é segura).
 */
export function findLinkedTransbordo(
  transbordos,
  prefillEntrada,
  estoqueList = [],
  vasilhamesList = []
) {
  const all = findAllLinkedTransbordos(
    transbordos,
    prefillEntrada,
    estoqueList,
    vasilhamesList
  );
  if (all.length !== 1) return null;
  return all[0];
}

/**
 * Mensagem quando há múltiplos OPs impedindo edição do transbordo de entrada.
 */
export function multipleTransbordosMessage(linked = []) {
  const codigos = linked
    .map((t) => t.codigo_transbordo || t.codigo || "")
    .filter(Boolean);
  const lista =
    codigos.length > 0
      ? ` (${codigos.join(", ")})`
      : "";
  return (
    `Existem ${linked.length} transbordos vinculados a esta entrada${lista}. ` +
    `Exclua os transbordos posteriores na tela de Transbordo para poder editar o transbordo de entrada.`
  );
}

export { sortNewestFirst, sortOldestFirst };
