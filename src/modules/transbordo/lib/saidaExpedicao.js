import {
  chemflowSupabase,
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';

function assertConfigured(context) {
  if (!isChemFlowConfigured || !chemflowSupabase) {
    throw new Error(`[ChemFlow:${context}] ${CHEMFLOW_CONFIG_ERROR}`);
  }
}

/**
 * IDs de saídas cujo carregamento já foi finalizado (status = concluido).
 * Status na listagem Comercial: Expedido.
 */
export async function listSaidaIdsExpedidas() {
  assertConfigured('t_agendamentos_carregamento.listSaidaIdsExpedidas');
  const { data, error } = await chemflowSupabase
    .from('t_agendamentos_carregamento')
    .select('saida_id')
    .eq('status', 'concluido')
    .not('saida_id', 'is', null);

  if (error) {
    throw new Error(
      `[ChemFlow:t_agendamentos_carregamento.listSaidaIdsExpedidas] ${error.message || 'Erro desconhecido'}`
    );
  }

  const ids = new Set();
  for (const row of data || []) {
    if (row?.saida_id) ids.add(String(row.saida_id));
  }
  return ids;
}

export function isSaidaExpedida(saidaId, expedidasIds) {
  if (!saidaId || !expedidasIds) return false;
  return expedidasIds.has(String(saidaId));
}
