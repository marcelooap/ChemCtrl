/**
 * Cadastro central de produtos (tabela cadastro_produtos).
 * Identidade: codigo + nome normalizados (trim, maiúsculas, sem acento).
 * Leitura via entities.produtos; escrita via RPCs registrar/promover.
 */
import { callRPC } from '@industrializacao/api/rpcClient';
import { entities } from '@transbordo/services/entities';

export const ORIGEM_INDUSTRIALIZACAO = 'INDUSTRIALIZACAO';
export const ORIGEM_ARMAZENAGEM = 'ARMAZENAGEM';
export const ORIGEM_AMBOS = 'AMBOS';

/** Origens válidas no CHECK da tabela. */
export const ORIGENS_VALIDAS = Object.freeze([
  ORIGEM_INDUSTRIALIZACAO,
  ORIGEM_ARMAZENAGEM,
  ORIGEM_AMBOS,
]);

/** Filtro padrão por módulo. */
export const ORIGENS_POR_MODULO = Object.freeze({
  INDUSTRIALIZACAO: [ORIGEM_INDUSTRIALIZACAO, ORIGEM_AMBOS],
  ARMAZENAGEM: [ORIGEM_ARMAZENAGEM, ORIGEM_AMBOS],
});

const DEFAULT_SELECT =
  'id, codigo, produto, cliente_id, cliente_nome, densidade, densidade_tabelada, filtrado, controlado, orgao_regulamentador, origem, data_cadastro';

export function normProdutoKey(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function produtoIdentityKey(codigo, nome) {
  return `${normProdutoKey(codigo)}|${normProdutoKey(nome)}`;
}

/**
 * Origem permitida para o módulo. Valores nulos/inesperados: retorna true
 * (não ocultar) e loga em desenvolvimento.
 */
export function origemPermitida(origem, modulo) {
  const allowed = ORIGENS_POR_MODULO[String(modulo || '').toUpperCase()];
  if (!allowed) return true;
  const o = String(origem ?? '').trim().toUpperCase();
  if (!o || !ORIGENS_VALIDAS.includes(o)) {
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      console.warn('[cadastro_produtos] origem nula/inesperada:', origem);
    }
    return true;
  }
  return allowed.includes(o);
}

/** Match cliente: preferir cliente_id; fallback nome normalizado. */
export function matchProdutoCliente(produto, { clienteId, clienteNome } = {}) {
  const id = String(clienteId || '').trim();
  const nome = normProdutoKey(clienteNome || '');
  if (!id && !nome) return true;
  const pId = String(produto?.cliente_id || '').trim();
  const pNome = normProdutoKey(produto?.cliente_nome || '');
  if (id && pId) return pId === id || (nome && pNome === nome);
  if (nome) return pNome === nome;
  return true;
}

export function produtoLabel(produto) {
  const codigo = String(produto?.codigo || '').trim();
  const nome = String(produto?.produto || '').trim();
  if (codigo && nome) return `${codigo} — ${nome}`;
  return nome || codigo || '';
}

/**
 * Opção padronizada para Combobox/SearchableSelect.
 * value padrão = id (uuid). Use valueMode: 'nome' | 'codigo' quando o form legado exigir.
 */
export function toProdutoSelectOption(produto, { valueMode = 'id' } = {}) {
  if (!produto) return null;
  const id = String(produto.id || '').trim();
  const codigo = String(produto.codigo || '').trim();
  const nome = String(produto.produto || '').trim();
  let value = id;
  if (valueMode === 'nome') value = nome;
  else if (valueMode === 'codigo') value = codigo;
  if (!value) return null;
  return {
    value,
    label: produtoLabel(produto) || value,
    id,
    codigo,
    produto: nome,
    cliente_id: produto.cliente_id || null,
    cliente_nome: produto.cliente_nome || '',
    densidade: produto.densidade,
    controlado: Boolean(produto.controlado),
    orgao_regulamentador: produto.orgao_regulamentador || '',
    origem: produto.origem || null,
    item: produto,
  };
}

/**
 * Inclui opção "fantasma" do valor atual se não estiver na lista (edição segura).
 */
export function ensureGhostProdutoOption(options, current, { valueMode = 'id' } = {}) {
  const list = Array.isArray(options) ? [...options] : [];
  if (!current) return list;
  const asOption =
    typeof current === 'object'
      ? toProdutoSelectOption(current, { valueMode })
      : {
          value: String(current),
          label: String(current),
          id: '',
          codigo: '',
          produto: String(current),
          item: null,
        };
  if (!asOption?.value) return list;
  if (list.some((o) => String(o.value) === String(asOption.value))) return list;
  return [asOption, ...list];
}

/**
 * Lista produtos do cadastro central com filtros de origem/cliente/busca.
 * @param {object} [opts]
 * @param {string|string[]} [opts.origem] — ex.: 'ARMAZENAGEM' ou ['ARMAZENAGEM','AMBOS']
 * @param {'INDUSTRIALIZACAO'|'ARMAZENAGEM'} [opts.modulo] — atalho para ORIGENS_POR_MODULO
 * @param {string} [opts.clienteId]
 * @param {string} [opts.clienteNome]
 * @param {string} [opts.search]
 * @param {string} [opts.select]
 * @param {number} [opts.limit]
 * @param {string} [opts.sort]
 */
export async function listProdutos(opts = {}) {
  const {
    origem,
    modulo,
    clienteId,
    clienteNome,
    search,
    select = DEFAULT_SELECT,
    limit,
    sort = 'produto',
  } = opts;

  const rows = await entities.produtos.list(sort, {
    select,
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
  });

  let origemFilter = null;
  if (Array.isArray(origem) && origem.length) {
    origemFilter = origem.map((o) => String(o).toUpperCase());
  } else if (origem) {
    origemFilter = [String(origem).toUpperCase()];
  } else if (modulo) {
    origemFilter = ORIGENS_POR_MODULO[String(modulo).toUpperCase()] || null;
  }

  const q = normProdutoKey(search || '');
  const hasCliente = Boolean(String(clienteId || '').trim() || String(clienteNome || '').trim());

  return (rows || []).filter((p) => {
    if (origemFilter) {
      const o = String(p?.origem ?? '').trim().toUpperCase();
      if (!o || !ORIGENS_VALIDAS.includes(o)) {
        if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
          console.warn('[cadastro_produtos] origem nula/inesperada na listagem:', p?.id, p?.origem);
        }
      } else if (!origemFilter.includes(o)) {
        return false;
      }
    }
    if (hasCliente && !matchProdutoCliente(p, { clienteId, clienteNome })) {
      return false;
    }
    if (q) {
      const hay = `${normProdutoKey(p.codigo)} ${normProdutoKey(p.produto)} ${normProdutoKey(p.cliente_nome)}`;
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export async function getProdutoById(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  return entities.produtos.get(key);
}

export async function findProdutoByIdentity(codigo, nome) {
  const code = String(codigo || '').trim();
  const name = String(nome || '').trim();
  if (!code || !name) return null;
  const key = produtoIdentityKey(code, name);
  const rows = await listProdutos({
    select: DEFAULT_SELECT,
  });
  return (
    (rows || []).find(
      (p) => produtoIdentityKey(p.codigo, p.produto) === key
    ) || null
  );
}

/**
 * Resolve receita a partir de um produto do cadastro.
 * Preferência: produto_acabado_id === produto.id; senão codigo+nome; senão só nome.
 */
export function resolveRecipeForProduto(recipes, produto, { getLatestRecipes, getLatestRecipeForProduct } = {}) {
  if (!produto || !Array.isArray(recipes)) return null;
  const pid = String(produto.id || '').trim();
  const code = normProdutoKey(produto.codigo);
  const name = normProdutoKey(produto.produto);

  const byPaId = pid
    ? recipes.filter((r) => String(r.produto_acabado_id || '').trim() === pid)
    : [];
  if (byPaId.length && typeof getLatestRecipes === 'function') {
    const latest = getLatestRecipes(byPaId);
    if (latest.length) return latest[0];
  } else if (byPaId.length) {
    return byPaId.sort(
      (a, b) => (Number(b.revision_number) || 0) - (Number(a.revision_number) || 0)
    )[0];
  }

  const byIdentity = recipes.filter((r) => {
    const rCode = normProdutoKey(r.code);
    const rName = normProdutoKey(r.product_name);
    if (code && name && rCode && rName) {
      return rCode === code && rName === name;
    }
    return name && rName === name;
  });
  if (byIdentity.length && typeof getLatestRecipes === 'function') {
    const latest = getLatestRecipes(byIdentity);
    if (latest.length) return latest[0];
  }
  if (byIdentity.length) {
    return byIdentity.sort(
      (a, b) => (Number(b.revision_number) || 0) - (Number(a.revision_number) || 0)
    )[0];
  }

  if (produto.produto && typeof getLatestRecipeForProduct === 'function') {
    return getLatestRecipeForProduct(recipes, produto.produto);
  }
  return null;
}

/**
 * Garante produto no cadastro central e promove origem quando necessário.
 * @param {'INDUSTRIALIZACAO'|'ARMAZENAGEM'} modulo
 * @returns {Promise<string|null>} uuid do produto, ou null se codigo/nome insuficientes
 */
function isMissingRpcError(err) {
  const msg = String(err?.message || err?.body || err || '');
  return (
    err?.status === 404 ||
    /PGRST202|Could not find the function|cadastro_produtos_registrar_uso|cadastro_produtos_promover_ids/i.test(
      msg
    )
  );
}

export async function registrarUsoProduto({
  codigo,
  nome,
  modulo,
  attrs = {},
}) {
  const code = String(codigo ?? '').trim();
  const name = String(nome ?? '').trim();
  if (!code || !name) return null;

  try {
    const id = await callRPC('cadastro_produtos_registrar_uso', {
      p_codigo: code,
      p_nome: name,
      p_modulo: modulo,
      p_attrs: attrs && typeof attrs === 'object' ? attrs : {},
    });
    return id || null;
  } catch (err) {
    if (isMissingRpcError(err)) {
      // Migration 046 ainda não aplicada — caller pode usar create legado.
      const e = new Error(
        'RPC cadastro_produtos_registrar_uso indisponivel. Aplique 046_cadastro_produtos_central.sql.'
      );
      e.code = 'CADASTRO_PRODUTOS_RPC_MISSING';
      e.cause = err;
      throw e;
    }
    throw err;
  }
}

/**
 * Registra produto acabado e matérias-primas cadastráveis de uma receita.
 * Itens sem codigo ou sem nome são ignorados (a receita pode seguir).
 */
export async function registrarProdutosDaReceita({
  code,
  product_name,
  client,
  density,
  raw_materials = [],
}) {
  const ids = [];

  try {
    const paId = await registrarUsoProduto({
      codigo: code,
      nome: product_name,
      modulo: 'INDUSTRIALIZACAO',
      attrs: {
        cliente_nome: client || '',
        densidade:
          density === null || density === undefined || density === ''
            ? '-'
            : String(density),
        densidade_tabelada: !(
          density === null ||
          density === undefined ||
          density === ''
        ),
      },
    });
    if (paId) ids.push(paId);

    for (const mp of raw_materials || []) {
      const mpId = await registrarUsoProduto({
        codigo: mp?.mp_code,
        nome: mp?.mp_name,
        modulo: 'INDUSTRIALIZACAO',
        attrs: {
          cliente_nome: client || '',
          densidade:
            mp?.mp_density === null ||
            mp?.mp_density === undefined ||
            mp?.mp_density === ''
              ? '-'
              : String(mp.mp_density),
          densidade_tabelada: !(
            mp?.mp_density === null ||
            mp?.mp_density === undefined ||
            mp?.mp_density === ''
          ),
          controlado: Boolean(mp?.controlado),
          orgao_regulamentador: mp?.controlado
            ? mp?.orgao_regulamentador || ''
            : '',
        },
      });
      if (mpId) ids.push(mpId);
    }
  } catch (err) {
    if (err?.code === 'CADASTRO_PRODUTOS_RPC_MISSING') throw err;
    throw err;
  }

  return ids;
}

/**
 * Promove INDUSTRIALIZACAO -> AMBOS para ids usados em JSON (saidas.itens, lotes).
 */
export async function promoverProdutosPorIds(produtoIds = []) {
  const unique = [
    ...new Set(
      (produtoIds || [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    ),
  ];
  if (!unique.length) return 0;
  try {
    const n = await callRPC('cadastro_produtos_promover_ids', { p_ids: unique });
    return Number(n) || 0;
  } catch (err) {
    if (isMissingRpcError(err)) return 0;
    throw err;
  }
}
