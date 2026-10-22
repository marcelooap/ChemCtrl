import { parseArr } from '@industrializacao/lib/containerOrigins';

const toDay = (v) => {
  if (!v) return null;
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
};

const plateKey = (placa, barril) =>
  `${String(placa || '').trim().toLowerCase()}||${String(barril || '').trim().toLowerCase()}`;

/**
 * Lookup O(1) amortizado por container — evita varrer todos os transbordos a cada linha da tabela.
 */
export function createTransferRelationLookup(transfers = []) {
  const byTransferNumber = new Map();
  const byOriginContainerId = new Map();
  /** @type {Map<string, Array<{ transfer: object, trDay: string|null }>>} */
  const destByPlateKey = new Map();

  for (const tr of transfers) {
    const num = tr?.transfer_number;
    if (num && String(num).startsWith('TB')) {
      byTransferNumber.set(num, tr);
    }

    for (const o of parseArr(tr.origins)) {
      if (o?.container_id) {
        byOriginContainerId.set(o.container_id, tr);
      }
    }

    const trDay = toDay(tr.date) || toDay(tr.created_date);
    for (const d of parseArr(tr.destinations)) {
      if ((d.type || tr.destination_type) !== 'Transbordo') continue;
      const key = plateKey(d.placa, d.barril);
      if (key === '||') continue;
      const bucket = destByPlateKey.get(key) || [];
      bucket.push({ transfer: tr, trDay });
      destByPlateKey.set(key, bucket);
    }
  }

  return (container) => {
    if (!container) return null;

    const op = container.op_number;
    if (op && String(op).startsWith('TB')) {
      const t = byTransferNumber.get(op);
      if (t) return { transfer: t, role: 'destino' };
    }

    const originTr = byOriginContainerId.get(container.id);
    if (originTr) return { transfer: originTr, role: 'origem' };

    const cn = (container.container_number || '').trim().toLowerCase();
    if (!cn) return null;
    const key = plateKey(container.container_number, container.barril_number);
    const candidates = destByPlateKey.get(key);
    if (!candidates?.length) return null;

    const createdDay = toDay(container.created_date);
    const departedDay = toDay(container.departure_date);
    for (const { transfer, trDay } of candidates) {
      if (createdDay && trDay && trDay < createdDay) continue;
      if (departedDay && trDay && trDay > departedDay) continue;
      return { transfer, role: 'destino' };
    }
    return null;
  };
}
