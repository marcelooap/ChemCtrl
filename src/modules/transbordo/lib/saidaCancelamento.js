import { entities } from "@transbordo/services/entities";
import { cancelSaidaAgendamento } from "@painel/lib/agendamentosCarregamento";
import { applySaidaFiscalToggle } from "@transbordo/lib/saidaFiscal";
import {
  isSaidaCancelada,
  isSaidaComValidacao,
  STATUS_SAIDA_CANCELADO,
} from "@transbordo/lib/saidaOrigem";

/**
 * Cancela o carregamento mantendo a saída no histórico.
 * Remove agendamento ativo, restaura estoque se validada e grava justificativa.
 */
export async function cancelarCarregamentoSaida({
  saida,
  justificativa,
  userNome = "",
  estoque = [],
  vasilhames = [],
} = {}) {
  if (!saida?.id) throw new Error("Saída inválida.");
  if (isSaidaCancelada(saida)) {
    throw new Error("Esta saída já está cancelada.");
  }

  const motivo = String(justificativa || "").trim();
  if (!motivo) {
    throw new Error("Informe a justificativa do cancelamento.");
  }

  let current = saida;

  if (isSaidaComValidacao(current)) {
    try {
      current = await applySaidaFiscalToggle(current, false, {
        userNome,
        estoque,
        vasilhames,
      });
    } catch (err) {
      throw new Error(
        err?.message ||
          "Não foi possível reverter a validação antes do cancelamento."
      );
    }
  }

  try {
    await cancelSaidaAgendamento({
      saida: current,
      clearDataProgramada: true,
    });
  } catch (err) {
    throw new Error(
      err?.message || "Não foi possível cancelar o agendamento da saída."
    );
  }

  const updated = await entities.saidas.update(current.id, {
    status: STATUS_SAIDA_CANCELADO,
    data_programada: null,
    enviado_ao_fiscal: false,
    enviado_fiscal_usuario: null,
    enviado_fiscal_data: null,
    cancelamento_justificativa: motivo,
    cancelamento_usuario: userNome || null,
    cancelamento_data: new Date().toISOString(),
  });

  return updated || {
    ...current,
    status: STATUS_SAIDA_CANCELADO,
    data_programada: null,
    enviado_ao_fiscal: false,
    enviado_fiscal_usuario: null,
    enviado_fiscal_data: null,
    cancelamento_justificativa: motivo,
    cancelamento_usuario: userNome || null,
    cancelamento_data: new Date().toISOString(),
  };
}

export function assertPodeExcluirSaidaDefinitivamente(saida) {
  if (!saida) throw new Error("Saída inválida.");
  if (isSaidaComValidacao(saida)) {
    throw new Error(
      "Esta saída já foi validada. Desvalide-a antes de excluir definitivamente."
    );
  }
  return true;
}
