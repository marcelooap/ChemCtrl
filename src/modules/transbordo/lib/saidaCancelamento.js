import { entities } from "@transbordo/services/entities";
import { cancelSaidaAgendamento } from "@painel/lib/agendamentosCarregamento";
import {
  isSaidaCancelada,
  isSaidaComValidacao,
  STATUS_SAIDA_CANCELADO,
} from "@transbordo/lib/saidaOrigem";

/**
 * Cancelamento de carregamento só é permitido após validação.
 * Assim a baixa de saldo, data de saída e flags de validação já existem
 * e permanecem intactas (itens não voltam ao estoque).
 */
export function assertPodeCancelarCarregamentoSaida(saida) {
  if (!saida?.id) throw new Error("Saída inválida.");
  if (isSaidaCancelada(saida)) {
    throw new Error("Esta saída já está cancelada.");
  }
  if (!isSaidaComValidacao(saida)) {
    throw new Error(
      "Só é possível cancelar o carregamento após a validação da carga. A validação garante que a baixa de saldo e a data de saída já foram registradas."
    );
  }
  return true;
}

/**
 * Cancela o carregamento mantendo a saída no histórico.
 * Não reverte validação nem estoque: baixa, data de saída e validação
 * permanecem. Apenas libera o agendamento e grava a justificativa.
 */
export async function cancelarCarregamentoSaida({
  saida,
  justificativa,
  userNome = "",
} = {}) {
  assertPodeCancelarCarregamentoSaida(saida);

  const motivo = String(justificativa || "").trim();
  if (!motivo) {
    throw new Error("Informe a justificativa do cancelamento.");
  }

  const current = saida;

  try {
    await cancelSaidaAgendamento({
      saida: current,
      clearDataProgramada: false,
    });
  } catch (err) {
    throw new Error(
      err?.message || "Não foi possível cancelar o agendamento da saída."
    );
  }

  const cancelamentoData = new Date().toISOString();
  const patch = {
    status: STATUS_SAIDA_CANCELADO,
    data_programada: null,
    cancelamento_justificativa: motivo,
    cancelamento_usuario: userNome || null,
    cancelamento_data: cancelamentoData,
  };

  // Garante que a validação continue contabilizando baixa após o status
  // deixar de ser `enviado_fiscal` (legado sem flag booleana).
  if (!current.enviado_ao_fiscal) {
    patch.enviado_ao_fiscal = true;
    if (!current.enviado_fiscal_data) {
      patch.enviado_fiscal_data = cancelamentoData;
    }
    if (!current.enviado_fiscal_usuario && userNome) {
      patch.enviado_fiscal_usuario = userNome;
    }
  }

  const updated = await entities.saidas.update(current.id, patch);

  return (
    updated || {
      ...current,
      ...patch,
    }
  );
}

export function assertPodeExcluirSaidaDefinitivamente(saida) {
  if (!saida) throw new Error("Saída inválida.");
  if (isSaidaCancelada(saida)) {
    throw new Error(
      "Carregamento cancelado permanece no histórico e não pode ser excluído definitivamente."
    );
  }
  if (isSaidaComValidacao(saida)) {
    throw new Error(
      "Esta saída já foi validada. Desvalide-a antes de excluir definitivamente."
    );
  }
  return true;
}
