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
  'Equinor',
  'Derio',
  'Deaçu',
  'Modec',
  'BW',
  'KAROON',
  'YINSON',
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

/**
 * Opções do seletor de destino (Solicitação de Saída, Checklist de Expedição, etc.).
 * @param {{ allowBlank?: boolean, excludeDestinoKeys?: string[] }} [opts]
 * @returns {Array<{ id: string, nome: string }>}
 */
export function getDestinoOptions({ allowBlank = true, excludeDestinoKeys = [] } = {}) {
  const exclude = new Set(
    (excludeDestinoKeys || []).map((k) => String(k ?? '').trim()).filter(Boolean)
  );
  const destinoOptions = DESTINOS_SAIDA.filter((nome) => !exclude.has(destinoKey(nome))).map(
    (nome) => ({ id: nome, nome })
  );
  if (!allowBlank) return destinoOptions;
  return [{ id: DESTINO_EM_BRANCO, nome: 'Em branco' }, ...destinoOptions];
}
