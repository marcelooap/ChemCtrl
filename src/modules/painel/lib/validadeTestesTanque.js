/**
 * Verificação da validade dos testes do tanque (Check List Expedição).
 *
 * As datas trafegam como "YYYY-MM-DD" (data de calendário, sem horário) e a
 * aritmética é feita em UTC, evitando deslocamentos de fuso e de horário de verão.
 */

import { destinoKey } from '@transbordo/lib/saidaDestinos';

export const VALIDADE_TESTES_PRAZO_PADRAO_DIAS = 180;
export const VALIDADE_TESTES_PRAZO_MIN_DIAS = 1;
export const VALIDADE_TESTES_PRAZO_MAX_DIAS = 3650;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const MS_PER_DAY = 86_400_000;

/**
 * Converte o prazo informado em inteiro válido.
 * @returns {number|null} `null` quando vazio, não numérico ou fora do intervalo permitido.
 */
export function parsePrazoDias(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const dias = Number(text);
  if (dias < VALIDADE_TESTES_PRAZO_MIN_DIAS || dias > VALIDADE_TESTES_PRAZO_MAX_DIAS) {
    return null;
  }
  return dias;
}

/** Prazo válido ou o padrão (180 dias) — usado ao ler dados persistidos. */
export function normalizePrazoDias(value) {
  return parsePrazoDias(value) ?? VALIDADE_TESTES_PRAZO_PADRAO_DIAS;
}

/** Códigos de erro da validação dos prazos por destino. */
export const PRAZO_DESTINO_ERROR = Object.freeze({
  DESTINO_REQUIRED: 'DESTINO_REQUIRED',
  DUPLICATE_DESTINO: 'DUPLICATE_DESTINO',
  PRAZO_INVALID: 'PRAZO_INVALID',
});

/**
 * Valida as linhas "destino + prazo" do item de validade dos testes.
 * Regras: destino obrigatório, sem repetição no mesmo item e prazo inteiro positivo.
 *
 * @param {Array<{ destino?: string, dias?: string|number }>} rows
 * @returns {{
 *   ok: boolean,
 *   errors: Array<{ index: number, field: 'destino'|'dias', code: string }>,
 *   items: Array<{ destino: string, dias: number }>,
 * }} `items` traz apenas as linhas válidas, já normalizadas.
 */
export function validarPrazosPorDestino(rows = []) {
  const errors = [];
  const items = [];
  const seen = new Set();

  (rows || []).forEach((row, index) => {
    const destino = String(row?.destino ?? '').trim();
    const key = destinoKey(destino);
    const rowErrors = [];

    if (!key) {
      rowErrors.push({ index, field: 'destino', code: PRAZO_DESTINO_ERROR.DESTINO_REQUIRED });
    } else if (seen.has(key)) {
      rowErrors.push({ index, field: 'destino', code: PRAZO_DESTINO_ERROR.DUPLICATE_DESTINO });
    } else {
      seen.add(key);
    }

    const dias = parsePrazoDias(row?.dias);
    if (dias == null) {
      rowErrors.push({ index, field: 'dias', code: PRAZO_DESTINO_ERROR.PRAZO_INVALID });
    }

    if (rowErrors.length > 0) errors.push(...rowErrors);
    else items.push({ destino, dias });
  });

  return { ok: errors.length === 0, errors, items };
}

/**
 * Prazo aplicável à solicitação: cliente + destino.
 *
 * O prazo existe somente por destino: sem cadastro para o destino da solicitação
 * (ou sem destino informado) o prazo é `null` — nunca se reaproveita o prazo de
 * outro destino nem um valor padrão.
 *
 * @param {{ prazosPorDestino?: Array<{ destino: string, dias: number|string }> }} config
 * @param {string|null|undefined} destino destino da solicitação de saída
 * @returns {{ dias: number|null, destino: string }}
 */
export function resolverPrazoValidadeTestes(config, destino) {
  const destinoNome = String(destino ?? '').trim();
  const prazos = Array.isArray(config?.prazosPorDestino) ? config.prazosPorDestino : [];
  const key = destinoKey(destinoNome);
  const found = key ? prazos.find((p) => destinoKey(p?.destino) === key) : null;
  return { dias: found ? parsePrazoDias(found.dias) : null, destino: destinoNome };
}

/**
 * Data limite = dia de calendário local de `base` + `dias`.
 * Ex.: 13/10/2026 + 180 dias → "2027-04-11".
 * @param {number} dias
 * @param {Date} [base]
 * @returns {string} "YYYY-MM-DD"
 */
export function calcularDataLimiteTestes(dias, base = new Date()) {
  const prazo = normalizePrazoDias(dias);
  const utcMs = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()) + prazo * MS_PER_DAY;
  return new Date(utcMs).toISOString().slice(0, 10);
}

/**
 * Formata "YYYY-MM-DD" (ou ISO completo) sem passar por fuso horário.
 * @returns {string} data localizada ou "—" quando inválida.
 */
export function formatDataLimiteTestes(value, language = 'pt-BR') {
  const match = ISO_DATE_RE.exec(String(value || ''));
  if (!match) return '—';
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(language || 'pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
