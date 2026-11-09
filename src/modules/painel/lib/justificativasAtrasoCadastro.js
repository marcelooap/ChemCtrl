/**
 * Cadastro de motivos de atraso de carregamento (Logística).
 * Fonte: t_justificativas_atraso — Painel → Configuração → Justificativas Atraso.
 */

import { entities } from '@transbordo/services/entities';
import {
  JUSTIFICATIVA_ATRASO_MOTIVOS_FALLBACK,
  normalizeMotivoAtraso,
} from '@painel/lib/agendamentosCarregamento';

const TABLE_MISSING_MESSAGE =
  'A tabela de justificativas ainda não existe no banco. Execute o script SQL 058_t_justificativas_atraso.sql no Supabase e recarregue a página.';

function isTableMissingError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('pgrst205') ||
    msg.includes("could not find the table 'public.t_justificativas_atraso'") ||
    (msg.includes('t_justificativas_atraso') &&
      (msg.includes('does not exist') ||
        msg.includes('schema cache') ||
        msg.includes('could not find') ||
        msg.includes('relation')))
  );
}

function isVirtual(rowOrId) {
  if (!rowOrId) return false;
  if (typeof rowOrId === 'string') return rowOrId.startsWith('virtual:');
  return Boolean(rowOrId._virtual) || String(rowOrId.id || '').startsWith('virtual:');
}

function virtualRow(motivo, ativo = true) {
  return {
    id: `virtual:${motivo}`,
    motivo,
    ativo,
    _virtual: true,
  };
}

function fallbackRows() {
  return JUSTIFICATIVA_ATRASO_MOTIVOS_FALLBACK.map((motivo) =>
    virtualRow(normalizeMotivoAtraso(motivo), true)
  );
}

export async function listJustificativasAtrasoCadastro() {
  try {
    const rows = await entities.justificativasAtraso.list('motivo');
    return (rows || []).sort((a, b) =>
      String(a.motivo || '').localeCompare(String(b.motivo || ''), 'pt-BR', {
        sensitivity: 'base',
      })
    );
  } catch (err) {
    if (!isTableMissingError(err)) throw err;
    return fallbackRows();
  }
}

/** Motivos ativos (texto já em maiúsculas) para o combobox de atraso. */
export async function listJustificativasAtrasoAtivas() {
  const rows = await listJustificativasAtrasoCadastro();
  const ativos = rows
    .filter((r) => r.ativo !== false)
    .map((r) => normalizeMotivoAtraso(r.motivo))
    .filter(Boolean);
  if (ativos.length) return ativos;
  return JUSTIFICATIVA_ATRASO_MOTIVOS_FALLBACK.map(normalizeMotivoAtraso);
}

export async function createJustificativaAtraso(motivo) {
  const trimmed = normalizeMotivoAtraso(motivo);
  if (!trimmed) throw new Error('Informe o motivo da justificativa.');
  try {
    return await entities.justificativasAtraso.create({ motivo: trimmed, ativo: true });
  } catch (err) {
    if (isTableMissingError(err)) throw new Error(TABLE_MISSING_MESSAGE);
    throw err;
  }
}

export async function updateJustificativaAtraso(id, payload) {
  if (isVirtual(id)) throw new Error(TABLE_MISSING_MESSAGE);
  const next = { ...payload };
  if (next.motivo != null) next.motivo = normalizeMotivoAtraso(next.motivo);
  try {
    return await entities.justificativasAtraso.update(id, next);
  } catch (err) {
    if (isTableMissingError(err)) throw new Error(TABLE_MISSING_MESSAGE);
    throw err;
  }
}

export async function deleteJustificativaAtraso(id) {
  if (isVirtual(id)) throw new Error(TABLE_MISSING_MESSAGE);
  try {
    await entities.justificativasAtraso.delete(id);
    return true;
  } catch (err) {
    if (isTableMissingError(err)) throw new Error(TABLE_MISSING_MESSAGE);
    throw err;
  }
}
