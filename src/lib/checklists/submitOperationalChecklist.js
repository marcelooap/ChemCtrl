import { callRPC } from '@/api/rpcClient';

/**
 * Persiste checklist operacional via RPC (validação no backend).
 * @param {{ productionId: string, etapa: string, answers: Array<object> }} params
 */
export async function submitOperationalChecklist({ productionId, etapa, answers }) {
  const result = await callRPC('submit_operational_checklist', {
    p_production_id: productionId,
    p_etapa: etapa,
    p_answers: answers,
  });
  return result;
}
