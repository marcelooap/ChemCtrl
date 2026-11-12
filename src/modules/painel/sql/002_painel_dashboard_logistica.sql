-- ============================================================================
-- Painel Dashboard — consolidação Logística (opcional)
-- O frontend consolida via `groupCarregamentosConcluidos` + métricas client-side.
-- Este script documenta uma RPC futura para agregação no banco; não é obrigatório.
-- ============================================================================

-- Pré-requisitos / campos utilizados em t_agendamentos_carregamento:
--   status, data, horario, hora_carregamento, data_carregamento,
--   justificativa_atraso_responsavel, justificativa_atraso_motivo,
--   grupo_conclusao_id, cliente_nome, transportadora, motorista, placa, updated_at
--
-- Regras (espelho do frontend):
--   - Conta apenas status = 'concluido'
--   - Agrupa por grupo_conclusao_id (ou slot + horário real + veículo)
--   - Pontual: hora_carregamento <= horario + 29 minutos (ou encaixe na mesma data)
--   - Responsabilidade sem valor → 'nao_informado' (nunca presume Intertank/Cliente)

COMMENT ON TABLE t_agendamentos_carregamento IS
  'Agendamentos de carregamento. Dashboard Logística usa status=concluido e campos de pontualidade/justificativa.';
