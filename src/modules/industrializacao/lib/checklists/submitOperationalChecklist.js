import { callRPC, getSessionId } from '@industrializacao/api/rpcClient';

/**
 * Extrai mensagem legível de erros PostgREST/Postgres (JSON ou texto).
 * @param {unknown} err
 * @returns {string}
 */
export function getChecklistErrorMessage(err) {
  const raw = err?.message || String(err || '');
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.message) return String(parsed.message);
    if (typeof parsed === 'string') return parsed;
  } catch {
    // not JSON
  }

  const messageMatch = raw.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (messageMatch?.[1]) {
    return messageMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ');
  }

  return raw;
}

/**
 * Persiste checklist operacional via RPC (validação no backend).
 * @param {{ productionId: string, etapa: string, answers: Array<object> }} params
 */
const EXPIRED_SESSION_MESSAGE = 'Sessão expirada. Faça login novamente.';

function isInvalidSessionMessage(message) {
  return /sess[aã]o inv[aá]lida/i.test(String(message || ''));
}

/**
 * validate_session devolve o id na raiz ou, em versões mais novas, só dentro
 * de `user`. Um payload sem `session_id` não significa sessão expirada: o id
 * local (o mesmo do login) continua válido e a RPC resolve a linha.
 * @param {unknown} payload
 * @returns {string}
 */
function extractSessionId(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed || trimmed === 'null') return '';
    try {
      return extractSessionId(JSON.parse(trimmed));
    } catch {
      return '';
    }
  }
  if (Array.isArray(payload)) return extractSessionId(payload[0]);
  if (typeof payload !== 'object') return '';
  const record = /** @type {Record<string, unknown>} */ (payload);
  const direct = record.session_id || record.sessionId;
  return String(direct || '').trim();
}

function assertChecklistSaved(result) {
  if (!result || typeof result !== 'object') return result;
  const failed = result.success === false || result.ok === false;
  if (!failed) return result;
  const message = String(result.error || result.message || '').trim();
  throw new Error(message || 'Não foi possível salvar o checklist');
}

export async function submitOperationalChecklist({ productionId, etapa, answers }) {
  const sessionId = String(getSessionId() || '').trim();
  if (!sessionId) {
    throw new Error(EXPIRED_SESSION_MESSAGE);
  }

  // Confirma o id quando o servidor o devolve, mas não bloqueia a gravação
  // se o payload vier aninhado ou vazio: a RPC lê a sessão pelo id local.
  let confirmedSessionId = sessionId;
  try {
    const session = await callRPC('validate_session', { p_session_id: sessionId });
    const fromServer = extractSessionId(session);
    if (fromServer) confirmedSessionId = fromServer;
  } catch (err) {
    const message = getChecklistErrorMessage(err);
    if (isInvalidSessionMessage(message)) {
      throw new Error(EXPIRED_SESSION_MESSAGE);
    }
    // Falha transitória de rede não invalida o id já usado no restante do app.
  }

  const result = await callRPC('submit_operational_checklist', {
    p_production_id: productionId,
    p_etapa: etapa,
    p_answers: answers,
    p_session_id: confirmedSessionId,
  });
  return assertChecklistSaved(result);
}
