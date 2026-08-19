import { getRevisionNumber } from "@industrializacao/lib/recipeRevisions";

export function parseRecipeRawMaterials(recipe) {
  const raw = recipe?.raw_materials;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function uniqueClientsFromNames(names) {
  const map = new Map();
  (names || []).forEach((raw) => {
    const nome = String(raw || "").trim();
    if (!nome) return;
    const key = nome.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { id: `ind-cli:${key}`, nome });
    }
  });
  return Array.from(map.values()).sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR")
  );
}

function toProdutoOption({ id, codigo, produto, clienteNome, densidade }) {
  const dens =
    densidade != null && densidade !== "" ? String(densidade) : "";
  const densNum = parseFloat(String(dens).replace(",", ".")) || 0;
  return {
    id,
    codigo: codigo || "",
    produto: produto || "",
    cliente_id: null,
    cliente_nome: clienteNome || "",
    densidade: dens,
    densidade_tabelada: densNum > 0,
  };
}

/** Matérias-primas (receitas + estoque MP), por cliente. */
export function buildMpProdutos(recipes, stocks) {
  const map = new Map();
  const upsert = (client, mpCode, mpName, density) => {
    const clienteNome = String(client || "").trim();
    const codigo = String(mpCode || "").trim();
    const produto = String(mpName || "").trim() || codigo;
    if (!clienteNome || (!codigo && !produto)) return;
    const key = `${clienteNome.toLowerCase()}|${(codigo || produto).toLowerCase()}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(
        key,
        toProdutoOption({
          id: `ind-mp:${key}`,
          codigo,
          produto,
          clienteNome,
          densidade: density,
        })
      );
      return;
    }
    if (!prev.produto && produto) prev.produto = produto;
    if (!prev.codigo && codigo) prev.codigo = codigo;
    if (!prev.densidade && density) {
      const next = toProdutoOption({
        id: prev.id,
        codigo: prev.codigo,
        produto: prev.produto,
        clienteNome,
        densidade: density,
      });
      map.set(key, next);
    }
  };

  (recipes || []).forEach((r) => {
    parseRecipeRawMaterials(r).forEach((mp) => {
      upsert(r.client, mp.mp_code, mp.mp_name, mp.mp_density);
    });
  });
  (stocks || []).forEach((s) => {
    upsert(s.client, s.mp_code, s.mp_name, s.density);
  });

  return Array.from(map.values()).sort((a, b) =>
    a.produto.localeCompare(b.produto, "pt-BR")
  );
}

/** Produtos acabados (última revisão da receita por cliente + nome). */
export function buildPaProdutos(recipes) {
  const map = new Map();
  (recipes || []).forEach((r) => {
    const produto = String(r.product_name || "").trim();
    const clienteNome = String(r.client || "").trim();
    if (!produto || !clienteNome) return;
    const key = `${clienteNome.toLowerCase()}|${produto.toLowerCase()}`;
    const current = map.get(key);
    if (!current || getRevisionNumber(r) > getRevisionNumber(current.recipe)) {
      map.set(key, {
        recipe: r,
        option: toProdutoOption({
          id: r.id ? `ind-pa:${r.id}` : `ind-pa:${key}`,
          codigo: r.code || "",
          produto,
          clienteNome,
          densidade: r.density,
        }),
      });
    }
  });
  return Array.from(map.values())
    .map((x) => x.option)
    .sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR"));
}

export function uniqueClientesByNome(clientes) {
  const map = new Map();
  (clientes || []).forEach((c) => {
    const nome = String(c?.nome || "").trim();
    if (!nome) return;
    const key = nome.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { ...c, nome });
    }
  });
  return Array.from(map.values()).sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR")
  );
}

export function clientsFromProdutos(produtos) {
  return uniqueClientsFromNames((produtos || []).map((p) => p.cliente_nome));
}

/**
 * Catálogo de produtos por destino (Recebimento / Ordem de Transbordo).
 * Industrialização + vasilhame → produto acabado; demais origens/tipos → MP.
 */
export function catalogProdutosByDestino({
  destino,
  tipoOrOrigem,
  produtosTb,
  produtosMp,
  produtosPa,
}) {
  if (destino === "industrializacao") {
    if (!tipoOrOrigem) return [];
    if (tipoOrOrigem === "vasilhame") return produtosPa || [];
    return produtosMp || [];
  }
  if (destino === "convencional") return produtosTb || [];
  return [];
}
