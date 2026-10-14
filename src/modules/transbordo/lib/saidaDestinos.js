/**
 * Destinos da carga em solicitações de saída.
 *
 * Fonte única da lista: usada pela Solicitação de Saída e pelo Check List de
 * Expedição (prazos de validade dos testes por destino). Não duplicar a lista.
 */

/** Lista fechada de destinos. Destino em branco é representado por string vazia / null. */
export const DESTINOS_SAIDA = Object.freeze([
  'Petrobras',
  'Petrorio',
  'Trident',
  'Total Energies',
  'Shell',
]);

/** Id da opção "Em branco" no seletor (nunca persistido). */
export const DESTINO_EM_BRANCO = '__em_branco__';

/**
 * Chave de comparação do destino (sem acentos, caixa e espaços duplicados).
 * @param {unknown} value
 * @returns {string}
 */
export function destinoKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Nome canônico do destino ou string vazia quando não pertence à lista.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeDestino(value) {
  const key = destinoKey(value);
  if (!key) return '';
  return DESTINOS_SAIDA.find((nome) => destinoKey(nome) === key) || '';
}

const DESTINO_OPTIONS = Object.freeze(DESTINOS_SAIDA.map((nome) => ({ id: nome, nome })));
const DESTINO_OPTIONS_COM_BRANCO = Object.freeze([
  { id: DESTINO_EM_BRANCO, nome: 'Em branco' },
  ...DESTINO_OPTIONS,
]);

/**
 * Opções do seletor de destino.
 * @param {{ allowBlank?: boolean }} [opts]
 * @returns {ReadonlyArray<{ id: string, nome: string }>}
 */
export function getDestinoOptions({ allowBlank = true } = {}) {
  return allowBlank ? DESTINO_OPTIONS_COM_BRANCO : DESTINO_OPTIONS;
}
