/**
 * Helpers para seletores de PA/MP da Industrialização
 * com fonte em cadastro_produtos + resolução de receita.
 */
import {
  listProdutos,
  produtoLabel,
  resolveRecipeForProduto,
  ensureGhostProdutoOption,
  toProdutoSelectOption,
  matchProdutoCliente,
  ORIGEM_INDUSTRIALIZACAO,
} from '@transbordo/lib/cadastroProdutosCentral';
import {
  getLatestRecipes,
  getLatestRecipeForProduct,
} from '@industrializacao/lib/recipeRevisions';

/**
 * Carrega produtos do cadastro para o módulo Industrialização.
 */
export async function loadProdutosIndustrializacao(opts = {}) {
  return listProdutos({
    modulo: ORIGEM_INDUSTRIALIZACAO,
    ...opts,
  });
}

/**
 * Opções de PA: catálogo IND/AMBOS que possuem receita resolvível.
 * value = product_name (compatível com forms legados).
 * Inclui fallback de receitas sem match no catálogo (transição) e fantasma do valor atual.
 */
export function buildIndPaSelectOptions({
  produtos = [],
  recipes = [],
  currentProductName = '',
} = {}) {
  const seen = new Set();
  const options = [];

  for (const p of produtos || []) {
    const recipe = resolveRecipeForProduto(recipes, p, {
      getLatestRecipes,
      getLatestRecipeForProduct,
    });
    if (!recipe) continue;
    const name = String(recipe.product_name || p.produto || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      value: name,
      label: produtoLabel(p) || name,
      id: p.id,
      codigo: p.codigo || recipe.code || '',
      produto: name,
      cliente_nome: p.cliente_nome || recipe.client || '',
      item: { produto: p, recipe },
    });
  }

  // Transição: receitas ainda sem linha correspondente no catálogo
  for (const r of getLatestRecipes(recipes)) {
    const name = String(r.product_name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      value: name,
      label: r.code ? `${r.code} — ${name}` : name,
      id: r.produto_acabado_id || '',
      codigo: r.code || '',
      produto: name,
      cliente_nome: r.client || '',
      item: { produto: null, recipe: r },
    });
  }

  options.sort((a, b) =>
    String(a.label).localeCompare(String(b.label), 'pt-BR')
  );

  return ensureGhostProdutoOption(options, currentProductName, {
    valueMode: 'nome',
  });
}

/**
 * Produto acabado da Industrialização: somente nomes cadastrados em `receitas`.
 * Uma opção por produto (revisão mais recente). value = product_name.
 */
export function buildRecipeProductSelectOptions({
  recipes = [],
  currentProductName = '',
} = {}) {
  const seen = new Set();
  const options = [];

  for (const recipe of getLatestRecipes(recipes)) {
    const name = String(recipe?.product_name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      value: name,
      label: name,
      id: recipe.produto_acabado_id || '',
      codigo: recipe.code || '',
      produto: name,
      cliente_nome: recipe.client || '',
      item: { produto: null, recipe },
    });
  }

  options.sort((a, b) =>
    String(a.label).localeCompare(String(b.label), 'pt-BR')
  );

  return ensureGhostProdutoOption(options, currentProductName, {
    valueMode: 'nome',
  });
}

/**
 * Opções de MP a partir do catálogo, filtradas por cliente.
 * value = codigo (compatível com Combobox de código MP).
 */
export function buildIndMpSelectOptions({
  produtos = [],
  clienteId = '',
  clienteNome = '',
  currentCodigo = '',
  currentNome = '',
} = {}) {
  const hasCliente = Boolean(
    String(clienteId || '').trim() || String(clienteNome || '').trim()
  );
  const seen = new Set();
  const options = [];

  for (const p of produtos || []) {
    if (
      hasCliente &&
      !matchProdutoCliente(p, { clienteId, clienteNome })
    ) {
      continue;
    }
    const code = String(p.codigo || '').trim();
    const nome = String(p.produto || '').trim();
    if (!code) continue;
    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const densRaw = p.densidade;
    const densNum =
      densRaw && densRaw !== '-'
        ? Number(String(densRaw).replace(',', '.'))
        : null;
    options.push({
      value: code,
      label: nome ? `${code} — ${nome}` : code,
      id: p.id,
      codigo: code,
      produto: nome,
      mp_code: code,
      mp_name: nome,
      mp_density: Number.isFinite(densNum) ? densNum : null,
      controlado: Boolean(p.controlado),
      orgao_regulamentador: p.orgao_regulamentador || '',
      cliente_nome: p.cliente_nome || '',
      item: p,
    });
  }

  options.sort((a, b) =>
    String(a.codigo).localeCompare(String(b.codigo), 'pt-BR')
  );

  if (currentCodigo) {
    const key = String(currentCodigo).toLowerCase();
    if (!seen.has(key)) {
      options.unshift({
        value: currentCodigo,
        label: currentNome
          ? `${currentCodigo} — ${currentNome}`
          : currentCodigo,
        id: '',
        codigo: currentCodigo,
        produto: currentNome || '',
        mp_code: currentCodigo,
        mp_name: currentNome || '',
        item: null,
      });
    }
  }

  return options;
}

export function toCatalogMpOption(produto) {
  return toProdutoSelectOption(produto, { valueMode: 'codigo' });
}
