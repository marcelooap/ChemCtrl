import {
  getContainerPackageQty,
  getOriginalPackageQty,
  isUnitPackagingLike,
} from '@industrializacao/lib/packagingTypes';
import { collectIndVasilhameItemsForContainer } from '@transbordo/lib/saidaIndContainer';
import { initialVolumeForProductionPackaging } from '@industrializacao/lib/productionViewUtils';

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

export function parsePackageExits(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function appendPackageExit(existing, entry) {
  return [...parsePackageExits(existing), entry];
}

function saidaStatus(saida) {
  if (saida?.enviado_ao_fiscal || saida?.status === 'enviado_fiscal') return 'fiscal';
  if (saida?.status === 'cancelado') return 'cancelled';
  return 'pending';
}

function qtyFromSaidaItem(item, volPerUnit) {
  const explicit = Math.round(Number(item?.quantidade_embalagens) || 0);
  if (explicit > 0) return explicit;
  const vol = Number(item?.volume_solicitado) || 0;
  if (vol > 0 && volPerUnit > 0) return Math.max(1, Math.round(vol / volPerUnit));
  return 0;
}

/**
 * Histórico de saída de IBC / tambor / bombona (não contentor clássico).
 * Combina saídas fiscais, registros de pátio persistidos e o saldo inferido
 * (original − pátio − já listado) para lotes expedidos antes deste histórico.
 */
export function listIndContainerExitHistory({
  container,
  origins = [],
  saidas = [],
  production = null,
} = {}) {
  if (!container?.id) return [];
  if (!isUnitPackagingLike(container.type, container.container_number)) return [];

  const initialVolume = initialVolumeForProductionPackaging(container, origins, production);
  const originalQty = getOriginalPackageQty(container, {
    initialVolume,
    productionVolume: production?.volume,
  });
  const onYard = container.status === 'Expedido' ? 0 : getContainerPackageQty(container);
  const currentVol = parseFloat(container.volume) || 0;
  const volPerUnit = onYard > 0 && currentVol > 0 ? currentVol / onYard : (originalQty > 0 && initialVolume > 0 ? initialVolume / originalQty : 0);

  const rows = [];

  for (const exit of parsePackageExits(container.package_exits)) {
    const qty = Math.max(0, Math.round(Number(exit.qty) || 0));
    if (qty < 1) continue;
    rows.push({
      key: `patio:${exit.date || ''}:${qty}:${exit.volume || 0}`,
      source: 'patio',
      codigo: exit.codigo || null,
      date: exit.date || exit.created_at || null,
      qty,
      volume: round3(exit.volume) || 0,
      netWeight: Number(exit.net_weight) || 0,
      status: 'patio',
      operator: exit.operator || '',
    });
  }

  const linked = collectIndVasilhameItemsForContainer(saidas, container.id);
  for (const { saida, item } of linked) {
    const qty = qtyFromSaidaItem(item, volPerUnit);
    rows.push({
      key: `saida:${saida?.id || item?.id || rows.length}`,
      source: 'saida',
      codigo: saida?.codigo || null,
      date: saida?.data_programada || saida?.data_solicitacao || saida?.created_at || saida?.created_date || null,
      qty,
      volume: round3(item?.volume_solicitado) || 0,
      netWeight: Number(item?.peso_liquido) || Number(item?.quantidade_solicitada) || 0,
      status: saidaStatus(saida),
      operator: saida?.usuario_responsavel || saida?.usuario_criador || '',
    });
  }

  const accountedQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const shippedTotal = Math.max(0, originalQty - onYard);
  const gap = shippedTotal - accountedQty;
  if (gap >= 1) {
    const accountedVol = rows.reduce((s, r) => s + (Number(r.volume) || 0), 0);
    const shippedVol = Math.max(0, (initialVolume || 0) - (onYard > 0 ? currentVol : 0));
    rows.push({
      key: `inferred:${container.id}`,
      source: 'inferred',
      codigo: null,
      date: container.departure_date || container.updated_date || container.updated_at || null,
      qty: gap,
      volume: round3(Math.max(0, shippedVol - accountedVol)),
      netWeight: 0,
      status: 'patio',
      operator: container.operator || '',
    });
  }

  rows.sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : 0;
    const tb = b.date ? new Date(b.date).getTime() : 0;
    if (ta !== tb) return tb - ta;
    return String(b.codigo || '').localeCompare(String(a.codigo || ''));
  });

  return rows;
}
