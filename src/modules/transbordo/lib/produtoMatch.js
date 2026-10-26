import {
  matchProdutoCliente,
  normProdutoKey,
} from "@transbordo/lib/cadastroProdutosCentral";

/**
 * Verifica se um registro operacional (tanka, vasilhame, estoque…) refere-se
 * ao produto/cliente selecionados no transbordo.
 */
export function matchesProdutoOperacional(
  row,
  { produtoId, produtoNome, produtoCodigo, clienteId, clienteNome } = {},
  { requireCliente = false } = {}
) {
  if (!row) return false;

  const hasCliente = Boolean(
    String(clienteId || "").trim() || String(clienteNome || "").trim()
  );
  if (hasCliente || requireCliente) {
    if (
      !matchProdutoCliente(row, {
        clienteId,
        clienteNome,
      })
    ) {
      return false;
    }
  }

  const ctxPid = String(produtoId || "").trim();
  const rowPid = String(row.produto_id || "").trim();
  if (ctxPid && rowPid && ctxPid === rowPid) return true;

  const ctxNome = normProdutoKey(produtoNome);
  const rowNome = normProdutoKey(
    row.produto_nome || row.produto || row.product || ""
  );
  if (ctxNome && rowNome && ctxNome === rowNome) return true;

  const ctxCod = normProdutoKey(produtoCodigo);
  const rowCod = normProdutoKey(row.produto_codigo || "");
  if (ctxCod && rowCod && ctxCod === rowCod) return true;

  return false;
}
