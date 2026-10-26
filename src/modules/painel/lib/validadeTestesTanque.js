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

/** Valores persistidos de Color Cod da eslinga (por destino). */
export const COLOR_COD_VALUES = Object.freeze([
  'laranja',
  'roxo',
  'verde',
  'amarelo',
  'azul',
]);

/** Classes Tailwind do nome da cor (configuração e inspeção). */
export const COLOR_COD_TEXT_CLASS = Object.freeze({
  laranja: 'text-orange-600',
  roxo: 'text-purple-600',
  verde: 'text-emerald-600',
  amarelo: 'text-amber-500',
  azul: 'text-blue-600',
});

/** Tons hex para PDF / destaques fora do Tailwind. */
export const COLOR_COD_HEX = Object.freeze({
  laranja: '#EA580C',
  roxo: '#9333EA',
  verde: '#059669',
  amarelo: '#D97706',
  azul: '#2563EB',
});

const COLOR_COD_SET = new Set(COLOR_COD_VALUES);

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const MS_PER_DAY = 86_400_000;

/** Normaliza o Color Cod cadastrado; vazio ou inválido → `null`. */
export function normalizeColorCod(value) {
  const key = String(value ?? '')
    .trim()
    .toLowerCase();
  return COLOR_COD_SET.has(key) ? key : null;
}

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

/** Nome usado só para converter o prazo único antigo em um teste, até o cadastro ser revisado. */
export const TESTE_LEGADO_NOME = 'Validade dos testes';

/** Tamanho máximo do nome livre do teste. */
export const TESTE_NOME_MAX = 120;

/** Códigos de erro da validação dos testes por destino. */
export const PRAZO_DESTINO_ERROR = Object.freeze({
  DESTINO_REQUIRED: 'DESTINO_REQUIRED',
  DUPLICATE_DESTINO: 'DUPLICATE_DESTINO',
  PRAZO_INVALID: 'PRAZO_INVALID',
  TESTES_REQUIRED: 'TESTES_REQUIRED',
  TESTE_NOME_REQUIRED: 'TESTE_NOME_REQUIRED',
  TESTE_NOME_LONG: 'TESTE_NOME_LONG',
  DUPLICATE_TESTE: 'DUPLICATE_TESTE',
  TESTE_PRAZO_INVALID: 'TESTE_PRAZO_INVALID',
  TESTE_VALIDADE_INVALID: 'TESTE_VALIDADE_INVALID',
});

/** Nome do teste normalizado para comparação (sem acento, caixa ou espaços nas pontas). */
export function testeNomeKey(nome) {
  return String(nome ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Chave estável da resposta do checklist para um teste.
 * Nomes que diferem só por acento, caixa ou pontuação compartilham a mesma chave.
 */
export function validadeTesteCheckKey(nome) {
  const slug = testeNomeKey(nome)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `validade_teste:${slug || 'teste'}`;
}

/**
 * Lista persistida (`[{ nome, prazo_dias, validade_dias }]`) → `[{ nome, dias, validade? }]`.
 * Linhas sem nome ou sem prazo são descartadas. Validade ausente (cadastro antigo)
 * fica de fora: a conferência continua com a conta anterior até o campo ser preenchido.
 * @param {unknown} raw
 * @returns {Array<{ nome: string, dias: number, validade?: number }>}
 */
export function normalizeTestesConfig(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((teste) => {
      const nome = String(teste?.nome ?? '').trim();
      const dias = parsePrazoDias(teste?.dias ?? teste?.prazo_dias);
      if (!nome || dias == null) return null;
      const validade = parsePrazoDias(teste?.validade ?? teste?.validade_dias);
      return validade == null ? { nome, dias } : { nome, dias, validade };
    })
    .filter(Boolean);
}

/**
 * Valida as linhas "destino + color cod + testes" da verificação.
 * Cada destino tem um ou mais testes, com nome, validade e prazo próprios.
 * Color Cod continua opcional e vale para o destino inteiro.
 *
 * @param {Array<{
 *   destino?: string,
 *   color_cod?: string|null,
 *   testes?: Array<{ nome?: string, dias?: string|number, validade?: string|number }>,
 * }>} rows
 * @returns {{
 *   ok: boolean,
 *   errors: Array<{ index: number, testeIndex?: number, field: string, code: string }>,
 *   items: Array<{ destino: string, color_cod: string|null, testes: Array<{ nome: string, dias: number, validade: number }> }>,
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

    const rawColor = String(row?.color_cod ?? '').trim();
    const color_cod = normalizeColorCod(rawColor);
    if (rawColor && !color_cod) {
      rowErrors.push({ index, field: 'color_cod', code: 'COLOR_COD_INVALID' });
    }

    const testes = Array.isArray(row?.testes) ? row.testes : [];
    const cleanTestes = [];
    const seenTestes = new Set();
    if (testes.length === 0) {
      rowErrors.push({ index, field: 'testes', code: PRAZO_DESTINO_ERROR.TESTES_REQUIRED });
    } else {
      testes.forEach((teste, testeIndex) => {
        const nome = String(teste?.nome ?? '').trim();
        const nomeKey = testeNomeKey(nome);
        const checkKey = validadeTesteCheckKey(nome);
        let nomeOk = false;
        if (!nomeKey) {
          rowErrors.push({
            index,
            testeIndex,
            field: 'nome',
            code: PRAZO_DESTINO_ERROR.TESTE_NOME_REQUIRED,
          });
        } else if (nome.length > TESTE_NOME_MAX) {
          rowErrors.push({
            index,
            testeIndex,
            field: 'nome',
            code: PRAZO_DESTINO_ERROR.TESTE_NOME_LONG,
          });
        } else if (seenTestes.has(checkKey)) {
          rowErrors.push({
            index,
            testeIndex,
            field: 'nome',
            code: PRAZO_DESTINO_ERROR.DUPLICATE_TESTE,
          });
        } else {
          seenTestes.add(checkKey);
          nomeOk = true;
        }

        const dias = parsePrazoDias(teste?.dias);
        const validade = parsePrazoDias(teste?.validade);
        if (dias == null) {
          rowErrors.push({
            index,
            testeIndex,
            field: 'dias',
            code: PRAZO_DESTINO_ERROR.TESTE_PRAZO_INVALID,
          });
        }
        if (validade == null) {
          rowErrors.push({
            index,
            testeIndex,
            field: 'validade',
            code: PRAZO_DESTINO_ERROR.TESTE_VALIDADE_INVALID,
          });
        }
        if (dias != null && validade != null && nomeOk) {
          cleanTestes.push({ nome, dias, validade });
        }
      });
    }

    if (rowErrors.length > 0) errors.push(...rowErrors);
    else items.push({ destino, color_cod, testes: cleanTestes });
  });

  return { ok: errors.length === 0, errors, items };
}

/**
 * Testes e Color Cod aplicáveis à solicitação: cliente + destino.
 * Sem cadastro para o destino, `encontrado` é false e a lista de testes fica vazia.
 *
 * @param {{ prazosPorDestino?: Array<{ destino: string, color_cod?: string|null, testes?: Array<{ nome: string, dias: number }> }> }} config
 * @param {string|null|undefined} destino destino da solicitação de saída
 * @returns {{ encontrado: boolean, destino: string, color_cod: string|null, testes: Array<{ nome: string, dias: number, validade?: number }> }}
 */
export function resolverTestesPorDestino(config, destino) {
  const destinoNome = String(destino ?? '').trim();
  const prazos = Array.isArray(config?.prazosPorDestino) ? config.prazosPorDestino : [];
  const key = destinoKey(destinoNome);
  const found = key ? prazos.find((p) => destinoKey(p?.destino) === key) : null;
  return {
    encontrado: Boolean(found),
    destino: destinoNome,
    color_cod: found ? normalizeColorCod(found.color_cod) : null,
    testes: found ? normalizeTestesConfig(found.testes) : [],
  };
}

/**
 * Prazo mínimo da data de realização de um teste.
 * Com validade: dia local de `base` + prazo de verificação − validade.
 * Sem validade (cadastro antigo): dia local de `base` − prazo.
 * A data de execução no físico deve ser igual ou posterior a este dia.
 * Ex.: 26/10/2026 + 170 − 365 → "2026-04-14".
 * @param {number} dias prazo de verificação, em dias
 * @param {Date} [base]
 * @param {number|string|null} [validade] validade do teste, em dias
 * @returns {string} "YYYY-MM-DD"
 */
export function calcularDataLimiteTestes(dias, base = new Date(), validade = null) {
  const prazo = normalizePrazoDias(dias);
  const validadeDias = parsePrazoDias(validade);
  const deltaDias = validadeDias == null ? -prazo : prazo - validadeDias;
  const utcMs =
    Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()) + deltaDias * MS_PER_DAY;
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
