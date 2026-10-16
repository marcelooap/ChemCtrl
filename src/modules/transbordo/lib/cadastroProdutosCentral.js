/**
 * Cadastro central de produtos (tabela cadastro_produtos).
 * Identidade: codigo + nome normalizados (trim, maiúsculas, sem acento).
 */
import { callRPC } from '@industrializacao/api/rpcClient';

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
