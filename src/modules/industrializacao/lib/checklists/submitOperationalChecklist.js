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

export async function submitOperationalChecklist({ productionId, etapa, answers }) {
  const sessionId = String(getSessionId() || '').trim();
  if (!sessionId) {
    throw new Error(EXPIRED_SESSION_MESSAGE);
  }

  // O gate de login usa validate_session. Se ela não reconhece o id,
  // o checklist também não vai gravar — evita o P0001 genérico.
  const session = await callRPC('validate_session', { p_session_id: sessionId });
  const confirmedSessionId = String(session?.session_id || '').trim();
  if (!confirmedSessionId) {
    throw new Error(EXPIRED_SESSION_MESSAGE);
  }

  try {
    const result = await callRPC('submit_operational_checklist', {
      p_production_id: productionId,
      p_etapa: etapa,
      p_answers: answers,
      p_session_id: confirmedSessionId,
    });
    return result;
  } catch (err) {
    const message = getChecklistErrorMessage(err);
    if (isInvalidSessionMessage(message)) {
      const retry = await callRPC('validate_session', { p_session_id: confirmedSessionId }).catch(() => null);
      if (!retry?.session_id) {
        throw new Error(EXPIRED_SESSION_MESSAGE);
      }
    }
    throw err;
  }
}
