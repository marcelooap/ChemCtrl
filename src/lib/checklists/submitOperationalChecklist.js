import { callRPC, getSessionId } from '@/api/rpcClient';

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
export async function submitOperationalChecklist({ productionId, etapa, answers }) {
  const sessionId = getSessionId();
  if (!sessionId) {
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const result = await callRPC('submit_operational_checklist', {
    p_production_id: productionId,
    p_etapa: etapa,
    p_answers: answers,
    p_session_id: sessionId,
  });
  return result;
}
