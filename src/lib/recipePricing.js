/** Fator para converter preço com imposto em preço sem imposto. */
export const PRICE_WITHOUT_TAX_FACTOR = 0.70785;

export function calcPriceWithoutTax(priceWithTax) {
  return (Number(priceWithTax) || 0) * PRICE_WITHOUT_TAX_FACTOR;
}
