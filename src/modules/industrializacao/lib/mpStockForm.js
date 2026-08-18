import { calcPackagingQty } from '@industrializacao/lib/stockUtils';

export const CONFERENCE_TOLERANCE = 0.01;

export function createEmptyMpItem() {
  return {
    mp_name: '',
    mp_code: '',
    client: '',
    lot: '',
    nota_fiscal: '',
    supplier: '',
    unit: 'kg',
    unit_price: '',
    entry_date: new Date().toISOString().split('T')[0],
    manufacture_date: '',
    expiry_date: '',
    initial_stock: '',
    current_stock: '',
    density: '',
    observations: '',
    tank_storage: false,
    tank_entries: [],
    packaging_type: '',
    packaging_capacity: '',
    packaging_quantity: 0,
    status_wms: false,
  };
}

export function parseJsonArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return [];
    }
  }
  return [];
}

function pendingTankVolume(tankName, pendingItems) {
  let volume = 0;
  (pendingItems || []).forEach((s) => {
    if (!s.tank_storage) return;
    parseJsonArray(s.tank_entries).forEach((te) => {
      if (te.tank_name === tankName && te.volume) volume += parseFloat(te.volume) || 0;
    });
  });
  return volume;
}

/** Volume atual da tanka (mesma regra da tela Tankagem), opcionalmente excluindo um registro de MP. */
export function computeTankCurrentVolume(tankName, stockEntries, containers, excludeStockId, pendingItems = []) {
  if (!tankName) return 0;

  const extra = pendingTankVolume(tankName, pendingItems);
  const tankContainers = (containers || []).filter((c) => {
    const isTank = (c.type || '').toLowerCase().includes('tank');
    return isTank && c.container_number === tankName && c.status === 'No Pátio';
  });

  if (tankContainers.length > 0) {
    return tankContainers.reduce((sum, c) => sum + (c.volume || 0), 0) + extra;
  }

  let volume = 0;
  (stockEntries || []).forEach((s) => {
    if (excludeStockId && s.id === excludeStockId) return;
    if (!s.tank_storage) return;
    const entries = parseJsonArray(s.tank_entries);
    if (entries.length) {
      entries.forEach((te) => {
        if (te.tank_name === tankName && te.volume) volume += te.volume;
      });
    } else if (s.tank_name === tankName && s.tank_volume) {
      volume += s.tank_volume;
    }
  });
  return volume + extra;
}

export function buildMpStockPayload(form, { isEditing } = {}) {
  const initialStock = parseFloat(form.initial_stock) || 0;
  const packagingCapacity = parseFloat(form.packaging_capacity) || 0;
  const stockForPackaging = isEditing ? (parseFloat(form.current_stock) || 0) : initialStock;
  return {
    ...form,
    nota_fiscal: (form.nota_fiscal || '').trim(),
    unit_price: parseFloat(form.unit_price) || 0,
    initial_stock: initialStock,
    current_stock: isEditing ? (parseFloat(form.current_stock) || 0) : initialStock,
    density: parseFloat(form.density) || 0,
    entry_date: form.entry_date || null,
    packaging_capacity: packagingCapacity,
    packaging_quantity: calcPackagingQty(stockForPackaging, packagingCapacity),
    status_wms: isEditing ? !!form.status_wms : false,
    tank_entries: form.tank_storage
      ? (form.tank_entries || []).filter((te) => te.tank_name).map((te) => ({
          tank_name: te.tank_name,
          volume: parseFloat(te.volume) || 0,
          mass: te.mass || 0,
        }))
      : [],
  };
}

export function getTankConference(form) {
  const usesVolume = (form.unit || '').toLowerCase() === 'l';
  const conferenceUnit = usesVolume ? 'L' : 'kg';
  const initialStockQty = parseFloat(form.initial_stock) || 0;
  const tankConferenceTotal = (form.tank_entries || []).reduce((sum, entry) => {
    if (usesVolume) return sum + (parseFloat(entry.volume) || 0);
    return sum + (parseFloat(entry.mass) || 0);
  }, 0);
  const tankConferenceDiff = tankConferenceTotal - initialStockQty;
  const tankConferenceStatus =
    Math.abs(tankConferenceDiff) <= CONFERENCE_TOLERANCE
      ? 'match'
      : tankConferenceDiff > 0
        ? 'over'
        : 'under';
  return {
    usesVolume,
    conferenceUnit,
    initialStockQty,
    tankConferenceTotal,
    tankConferenceDiff,
    tankConferenceStatus,
  };
}

export function validateMpStockForm(form, { t, fmtNumber, index } = {}) {
  const at = index != null ? { index } : null;
  if (!form.mp_name) {
    return {
      title: at
        ? t('rawMaterialStock.messages.mpRequiredAt', at)
        : t('rawMaterialStock.messages.mpRequired'),
    };
  }

  if (!form.tank_storage) return null;

  const data = buildMpStockPayload(form, { isEditing: false });
  const { usesVolume, conferenceUnit, initialStockQty } = getTankConference(form);
  const allocated = (data.tank_entries || []).reduce((sum, entry) => {
    if (usesVolume) return sum + (entry.volume || 0);
    return sum + (entry.mass || 0);
  }, 0);

  if (allocated - initialStockQty <= CONFERENCE_TOLERANCE) return null;

  return {
    title: at
      ? t('rawMaterialStock.messages.tankConferenceExceededAt', at)
      : t('rawMaterialStock.messages.tankConferenceExceeded'),
    description: t('rawMaterialStock.messages.tankConferenceExceededDetail', {
      allocated: fmtNumber(allocated),
      initialStock: fmtNumber(initialStockQty),
      unit: conferenceUnit,
    }),
  };
}
