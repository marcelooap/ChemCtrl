/**
 * Códigos de exibição E001… alinhados à tela de Entradas
 * (ordem cronológica da entrada-pai, não do índice de estoque).
 */

function createdTs(row) {
  return new Date(row?.created_at || row?.created_date || 0).getTime();
}

/**
 * Mapa entrada.id → "E001".
 * @param {Array} entradasList — registros da tabela `entradas`
 */
export function buildEntradaCodigoById(entradasList = []) {
  const map = {};
  [...(entradasList || [])]
    .sort((a, b) => createdTs(a) - createdTs(b))
    .forEach((e, i) => {
      if (e?.id) map[e.id] = `E${String(i + 1).padStart(3, "0")}`;
    });
  return map;
}

/**
 * Quando só há lista de estoque: agrupa por `entrada_id` (pai)
 * e numera como na tela de Entradas.
 * Retorna mapa estoque.id → "E001".
 */
export function buildEstoqueDisplayCodigoMap(estoqueList = []) {
  const parentFirstTs = new Map();

  for (const e of estoqueList || []) {
    // Estoque gerado por transbordo (TB…) não define uma nova entrada
    if (String(e?.grupo_entrada || "").startsWith("TB")) continue;
    const parentId = e?.entrada_id || e?.id;
    if (!parentId) continue;
    const ts = createdTs(e);
    const prev = parentFirstTs.get(parentId);
    if (prev == null || ts < prev) parentFirstTs.set(parentId, ts);
  }

  const sortedParents = [...parentFirstTs.entries()].sort(
    (a, b) => a[1] - b[1]
  );
  const codigoByParent = {};
  sortedParents.forEach(([id], i) => {
    codigoByParent[id] = `E${String(i + 1).padStart(3, "0")}`;
  });

  const map = {};
  for (const e of estoqueList || []) {
    if (!e?.id) continue;
    const parentId = e.entrada_id || e.id;
    map[e.id] =
      codigoByParent[parentId] ||
      codigoByParent[e.id] ||
      e.entrada_codigo ||
      "E000";
  }
  return map;
}

/**
 * True se a origem do OP pertence à entrada (via ids de estoque/entrada).
 * Com `entrada_id` presente, NÃO usa fallback por texto E00N
 * (códigos gravados podem estar desalinhados do índice atual).
 */
export function origemPertenceAEntrada(origem, origemIds, codigoRef = "") {
  if (!origem) return false;

  if (origem.entrada_id) {
    return origemIds.has(origem.entrada_id);
  }

  const ref = String(codigoRef || "")
    .trim()
    .toUpperCase();
  if (!ref || ref === "-") return false;

  const cod = String(origem.entrada_codigo || "")
    .toUpperCase()
    .trim();
  if (!cod) return false;

  return (
    cod === ref ||
    cod.startsWith(`${ref} `) ||
    cod.startsWith(`${ref}—`) ||
    cod.startsWith(`${ref}-`)
  );
}
