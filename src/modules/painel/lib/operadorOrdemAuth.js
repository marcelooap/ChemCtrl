import { callRPC } from "@industrializacao/api/rpcClient";
import { isHttpError } from "@industrializacao/lib/HttpError";

const PERMISSION = "painel_operacional_ordem_transbordo.create";

function isMissingRpc(err) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("pgrst202") ||
    msg.includes("could not find the function") ||
    msg.includes("list_ordem_transbordo_operators") ||
    msg.includes("confirm_ordem_transbordo_operator")
  );
}

function mapTransportError(err) {
  if (isMissingRpc(err)) {
    return { errorCode: "unavailable" };
  }
  if (isHttpError(err) && err.status === 429) {
    return { errorCode: "rate_limited" };
  }
  return { errorCode: "network" };
}

function isLoginOperacao(usuario) {
  const key = String(usuario || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return key === "operacao";
}

/**
 * Usuários ativos do perfil Operacional, exceto o login genérico da operação.
 * Não inclui senha nem o restante do cadastro.
 */
export async function listOrdemTransbordoOperators() {
  try {
    const result = await callRPC("list_ordem_transbordo_operators", {});
    if (!result || result.success === false) {
      return { users: [], errorCode: result?.error_code || "load" };
    }
    const users = Array.isArray(result.users) ? result.users : [];
    return {
      users: users
        .filter((u) => u?.id && u?.usuario && !isLoginOperacao(u.usuario))
        .map((u) => ({
          id: String(u.id),
          nome: String(u.nome_completo || u.usuario),
          usuario: String(u.usuario),
        })),
      errorCode: null,
    };
  } catch (err) {
    return { users: [], ...mapTransportError(err) };
  }
}

/**
 * Confirma a identidade do operador desta ordem.
 * A RPC não cria sessão: o usuário genérico do computador permanece logado.
 */
export async function confirmOrdemTransbordoOperator(usuario, password) {
  try {
    const result = await callRPC("confirm_ordem_transbordo_operator", {
      p_username: usuario,
      p_password: password,
    });
    if (!result || result.success !== true || !result.user?.id) {
      return {
        operator: null,
        errorCode: result?.error_code || "invalid_credentials",
      };
    }
    return {
      operator: {
        id: String(result.user.id),
        nome: String(result.user.nome_completo || result.user.usuario || ""),
        usuario: String(result.user.usuario || usuario),
        permission: PERMISSION,
      },
      errorCode: null,
    };
  } catch (err) {
    return { operator: null, ...mapTransportError(err) };
  }
}
