/**
 * Correção pontual de fabricação e validade na etiqueta.
 * A data de envase (created_date) e os demais vasilhames permanecem iguais.
 */
const OVERRIDES = [
  {
    id: '75904f29-a0be-485b-96f8-267153247737',
    registrationId: '298',
    containerNumber: '25651-4',
    manufactureDate: '2026-03-04',
    expiryDate: '2028-02-22',
  },
];

export function containerLabelDateOverride(container) {
  if (!container) return null;
  const id = String(container.id || '');
  const registrationId = String(container.registration_id ?? '');
  const plate = String(container.container_number || '').trim();
  const row = OVERRIDES.find((item) => {
    if (id && id === item.id) return true;
    return registrationId === item.registrationId && plate === item.containerNumber;
  });
  if (!row) return null;
  return {
    manufactureDate: row.manufactureDate,
    expiryDate: row.expiryDate,
  };
}
