import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, QrCode, ArrowUpRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { fmtDateTime, fmtNumber, fmtVolume, fmtMass, fmtCurrency } from '@/i18n/formatters';
import { translateProductionStatus, translatePriority } from '@/i18n/domainMaps';
import { parseArr, stockUnitOf, liveLotOf, stockUnitPriceOf, isTransferDestinationContainer, containerLiveNetWeight, resolveProductDensity } from '@/lib/productionViewUtils';
import FractionalBadge from '@/components/production/FractionalBadge';
import { isComplementPending } from '@/lib/fractionalSupply';
import { packagingRowsForProduction, originShareKey } from '@/lib/containerOrigins';

const StatusBadge = ({ status }) => {
  const c = {
    'Aguardando Início': 'bg-muted text-foreground',
    'Em Produção': 'bg-blue-100 text-blue-700',
    'Qualidade': 'bg-amber-100 text-amber-700',
    'Envase': 'bg-purple-100 text-purple-700',
    'Finalizado': 'bg-green-100 text-green-700',
    'Cancelado': 'bg-red-100 text-red-700',
  };
  return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${c[status] || 'bg-muted'}`}>{translateProductionStatus(status)}</span>;
};

export default function ProductionViewDialog({
  production,
  containers = [],
  origins = [],
  packagingRows: packagingRowsProp,
  stocks = [],
  recipes = [],
  transfers = [],
  productions = [],
  open,
  onOpenChange,
  simplified = false,
  onGeneratePdf,
  onGenerateTanksPdf,
  onShowQr,
}) {
  const { t, i18n } = useTranslation();
  const fmt = (n) => fmtNumber(n, { minimumFractionDigits: 0 }, i18n.language);
  const fmtGross = (n) => fmtNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, i18n.language);
  const fmtMoney = (n) => fmtCurrency(n, 'BRL', i18n.language);
  const fmt4 = (n) => fmtNumber(n, { minimumFractionDigits: 4, maximumFractionDigits: 4 }, i18n.language);

  const unitOf = (mp) => stockUnitOf(mp, stocks);
  const lotOf = (mp) => liveLotOf(mp, stocks);
  const priceOf = (mp) => stockUnitPriceOf(mp, stocks);

  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const packagingRows = packagingRowsProp
    || packagingRowsForProduction(containers, origins, production);

  useEffect(() => {
    if (!open) setSelectedIds(new Set());
  }, [open, production?.id]);

  const toggleSelect = (key) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedRows = packagingRows.filter((row) => selectedIds.has(originShareKey(row)));
  const hasSelection = selectedRows.length > 0;
  const allSelected = packagingRows.length > 0 && selectedRows.length === packagingRows.length;

  const selectAllPackaging = () => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(packagingRows.map((row) => originShareKey(row))));
  };

  const handleGenerateTanksPdf = () => {
    if (!hasSelection || !onGenerateTanksPdf) return;
    onGenerateTanksPdf(selectedRows);
  };

  const rowLiveNet = (row) => {
    const dens = resolveProductDensity(production, row.container, recipes);
    const vol = parseFloat(row.volume) || 0;
    if (vol <= 0) return 0;
    if (dens) return Math.round(vol * dens);
    // Fallback: scale container net
    const cVol = parseFloat(row.container?.volume) || 0;
    const cNet = containerLiveNetWeight(row.container, production, recipes);
    if (cVol > 0) return Math.round(cNet * (vol / cVol));
    return Math.round(parseFloat(row.container?.net_weight) || 0);
  };

  const rowLiveGross = (row) => {
    const net = rowLiveNet(row);
    // Gross only includes tare once per physical container — for origin rows show net only + proportional tare of full container when single origin
    const originsOnSame = packagingRows.filter((r) => r.container?.id === row.container?.id);
    if (originsOnSame.length <= 1) {
      return Math.round(net + (parseFloat(row.container?.tare) || 0));
    }
    return net;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{production?.op_number} · {production?.product}</DialogTitle></DialogHeader>
        {production && (
          <div>
            <div className="grid grid-cols-3 gap-4 text-sm mb-4">
              <div><p className="text-xs text-muted-foreground">{t('production.opNumber')}</p><p className="font-bold" style={{ color: '#2575D1' }}>{production.op_number}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('common.lot')}</p><p className="font-medium">{production.lot}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('production.list.finishDate')}</p><p className="font-medium">{production.end_time ? fmtDateTime(production.end_time, undefined, i18n.language) : t('common.notAvailable')}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('common.product')}</p><p className="font-bold">{production.product}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('common.client')}</p><p className="font-medium">{production.client}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('common.volume')}</p><p className="font-medium">{fmtVolume(production.volume, 'L', i18n.language)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('common.mass')}</p><p className="font-bold">{fmtMass(production.mass, 'kg', i18n.language)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('production.list.revision')}</p><p className="font-medium">{production.recipe_revision}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('production.fields.priority')}</p><p className="font-medium">{translatePriority(production.priority)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('production.list.stage')}</p>
                {isComplementPending(production) ? (
                  <FractionalBadge production={production} />
                ) : (
                  <StatusBadge status={production.status} />
                )}
              </div>
              {!simplified && (
                <>
                  <div><p className="text-xs text-muted-foreground">{t('production.fields.unitPrice')}</p><p className="font-bold" style={{ color: '#2575D1' }}>{t('production.list.unitPricePerKg', { price: fmtCurrency(production.unit_price || 0, 'BRL', i18n.language) })}</p></div>
                  <div><p className="text-xs text-muted-foreground">{t('production.fields.totalValue')}</p><p className="font-bold">{fmtMoney(production.total_value)}</p></div>
                </>
              )}
              {production.fractional_supply && (
                <>
                  <div><p className="text-xs text-muted-foreground">{t('production.fractional.volumeApontado')}</p><p className="font-medium">{fmtVolume(production.volume_apontado ?? production.volume, 'L', i18n.language)}</p></div>
                  <div><p className="text-xs text-muted-foreground">{t('production.fractional.volumePendente')}</p><p className="font-medium">{fmtVolume(production.volume_pendente ?? 0, 'L', i18n.language)}</p></div>
                  <div><p className="text-xs text-muted-foreground">{t('production.fractional.complementStatus')}</p><p className="font-medium">{production.complement_status === 'Pendente' ? t('production.fractional.complementStatusPending') : t('production.fractional.complementStatusComplete')}</p></div>
                </>
              )}
            </div>

            <h4 className="text-sm font-semibold mt-4 mb-2">{t('production.list.rawMaterialsUsed')}</h4>
            <table className="w-full text-sm border rounded-lg overflow-hidden mb-4">
              <thead><tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                <th className="px-3 py-2 text-left">{t('common.code')}</th>
                <th className="px-3 py-2 text-left">{t('production.list.mpShort')}</th>
                <th className="px-3 py-2 text-left">{t('common.lot')}</th>
                <th className="px-3 py-2 text-right">{t('production.checklist.qtyFiscal')}</th>
                <th className="px-3 py-2 text-right">{t('production.checklist.qtyOperational')} (kg)</th>
              </tr></thead>
              <tbody>
                {parseArr(production.raw_materials_used).map((m, i) => {
                  const unit = unitOf(m);
                  return (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs" style={{ color: '#2575D1' }}>{m.mp_code}</td>
                      <td className="px-3 py-2">{m.mp_name}</td>
                      <td className="px-3 py-2">{lotOf(m) || t('common.notAvailable')}</td>
                      <td className="px-3 py-2 text-right">{fmt(m.qty_fiscal)} {unit}</td>
                      <td className="px-3 py-2 text-right font-medium">{fmt(m.qty_operational)} kg</td>
                    </tr>
                  );
                })}
                {(() => {
                  const mps = parseArr(production.raw_materials_used);
                  const units = mps.map(unitOf);
                  const sameUnit = units.length > 0 && units.every(u => u === units[0]);
                  const tFiscal = mps.reduce((s, m) => s + (m.qty_fiscal || 0), 0);
                  const tOp = mps.reduce((s, m) => s + (m.qty_operational || 0), 0);
                  return (
                    <tr className="border-t bg-muted/50 font-bold" style={{ color: '#2575D1' }}>
                      <td colSpan={3} className="px-3 py-2">{t('production.checklist.total').toUpperCase()}</td>
                      <td className="px-3 py-2 text-right">{fmt(tFiscal)}{sameUnit ? ' ' + units[0] : ''}</td>
                      <td className="px-3 py-2 text-right">{fmt(tOp)} kg</td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>

            {production.fractional_supply && parseArr(production.supply_complements).length > 0 && (
              <div className="mt-4 mb-4">
                <h4 className="text-sm font-semibold mb-3">{t('production.fractional.historyTitle')}</h4>
                <div className="space-y-3">
                  {parseArr(production.supply_complements).map((entry, i) => (
                    <div key={i} className="border rounded-lg p-3 text-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold">
                          {entry.type === 'complement'
                            ? t('production.fractional.historyComplement')
                            : t('production.fractional.historyInitial')}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {entry.date ? fmtDateTime(entry.date, undefined, i18n.language) : t('common.notAvailable')}
                        </span>
                      </div>
                      {entry.user && <p className="text-xs text-muted-foreground mb-2">{entry.user}</p>}
                      <div className="space-y-1">
                        {parseArr(entry.entries).map((e, j) => (
                          <div key={j} className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1">
                            <span className="font-mono" style={{ color: '#2575D1' }}>{e.mp_code}</span>
                            <span>{e.mp_name}</span>
                            <span className="text-muted-foreground">{e.lot}</span>
                            <span className="ml-auto font-medium">{fmt(e.qty_operational)} kg</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {packagingRows.length > 0 ? (
              <>
                <div className="flex items-center justify-between gap-2 mb-2 mt-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <h4 className="text-sm font-semibold">{t('production.list.packagedContainers')}</h4>
                    {!simplified && packagingRows.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={selectAllPackaging}
                        className="shrink-0"
                      >
                        {allSelected
                          ? t('production.list.deselectAllPackaging')
                          : t('production.list.selectAllPackaging')}
                      </Button>
                    )}
                  </div>
                  {!simplified && hasSelection && (
                    <Button variant="outline" size="sm" onClick={handleGenerateTanksPdf} className="gap-2 shrink-0">
                      <FileText className="w-4 h-4" /> {t('production.actions.generateTanksPdf')}
                    </Button>
                  )}
                </div>
                <table className="w-full text-sm border rounded-lg overflow-hidden">
                  <thead><tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                    {!simplified && (
                      <th className="px-2 py-2 text-center w-10">
                        <span className="sr-only">{t('production.list.selectPackaging')}</span>
                      </th>
                    )}
                    <th className="px-3 py-2 text-left">{t('production.list.packagingNumber')}</th>
                    <th className="px-3 py-2 text-left">{t('production.opNumber')}</th>
                    <th className="px-3 py-2 text-left">{t('common.type')}</th>
                    <th className="px-3 py-2 text-right">{t('production.packaging.volume')}</th>
                    <th className="px-3 py-2 text-right">{t('production.packaging.netWeight')}</th>
                    <th className="px-3 py-2 text-right">{t('production.packaging.grossWeight')}</th>
                  </tr></thead>
                  <tbody>
                    {packagingRows.map((row, i) => {
                      const c = row.container;
                      const seq = String(i + 1).padStart(2, '0');
                      const fromTransfer = isTransferDestinationContainer(c);
                      const liveNet = rowLiveNet(row);
                      const liveGross = rowLiveGross(row);
                      const key = originShareKey(row);
                      const isSelected = selectedIds.has(key);
                      const multiOrigin = packagingRows.filter((r) => r.container?.id === c?.id).length > 1;
                      return (
                      <tr key={key} className={`border-t ${isSelected ? 'bg-blue-50/40' : ''}`}>
                        {!simplified && (
                          <td className="px-2 py-2 text-center">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(key)}
                              aria-label={t('production.list.selectPackagingItem', { label: c?.container_number || seq })}
                              className="rounded-full"
                            />
                          </td>
                        )}
                        <td className="px-3 py-2 font-medium">
                          <span className="inline-flex items-center gap-1">
                            <span className="text-muted-foreground tabular-nums">{seq}-</span>
                            {c?.container_number || t('common.notAvailable')}
                            {fromTransfer && (
                              <ArrowUpRight
                                className="w-3.5 h-3.5 shrink-0"
                                style={{ color: '#4B0082' }}
                                title={t('containers.vasilhames.transferDest')}
                              />
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-medium" style={{ color: multiOrigin ? '#2575D1' : undefined }}>
                          {row.op_number || c?.op_number || t('common.notAvailable')}
                        </td>
                        <td className="px-3 py-2">{c?.type || t('common.notAvailable')}</td>
                        <td className="px-3 py-2 text-right">
                          {(parseFloat(row.volume) || 0) <= 0
                            ? t('production.list.emptyContainer')
                            : (
                              <span className="inline-flex items-center justify-end gap-1">
                                <FractionalBadge
                                  production={production}
                                  container={c}
                                  transfers={transfers}
                                  variant="container"
                                />
                                {fmt(row.volume)}
                              </span>
                            )}
                        </td>
                        <td className="px-3 py-2 text-right">{fmt(liveNet)}</td>
                        <td className="px-3 py-2 text-right">{fmtGross(liveGross)}</td>
                      </tr>
                      );
                    })}
                    <tr className="border-t bg-muted/50 font-bold" style={{ color: '#2575D1' }}>
                      <td colSpan={simplified ? 3 : 4} className="px-3 py-2">{t('production.checklist.total').toUpperCase()}</td>
                      <td className="px-3 py-2 text-right">{fmt(packagingRows.reduce((s, r) => s + (parseFloat(r.volume) || 0), 0))} L</td>
                      <td className="px-3 py-2 text-right">{fmt(packagingRows.reduce((s, r) => s + rowLiveNet(r), 0))} kg</td>
                      <td className="px-3 py-2 text-right">{fmtGross(packagingRows.reduce((s, r) => s + rowLiveGross(r), 0))} kg</td>
                    </tr>
                  </tbody>
                </table>
              </>
            ) : (production.packaging_info || production.packaging_type) ? (
              <div className="mt-4">
                <h4 className="text-sm font-semibold mb-2">{t('production.list.suggestedPackaging')}</h4>
                <p className="text-sm bg-muted/50 rounded-lg px-3 py-2 font-medium">{production.packaging_info || production.packaging_type}</p>
              </div>
            ) : null}

            {!simplified && (() => {
              const p = production;
              const startMs = p.start_time ? new Date(p.start_time).getTime() : null;
              const endMs = p.end_time ? new Date(p.end_time).getTime() : null;
              const qcStartMs = p.qc_start_time ? new Date(p.qc_start_time).getTime() : null;
              const envaseStartMs = p.envase_start_time ? new Date(p.envase_start_time).getTime() : null;
              const pauseMs = p.total_pause_ms || 0;

              const fmtDur = (ms) => {
                if (!ms || ms <= 0) return t('common.notAvailable');
                const totalMin = Math.floor(ms / 60000);
                const h = Math.floor(totalMin / 60);
                const m = totalMin % 60;
                return h > 0 ? t('production.list.durationHours', { hours: h, minutes: m }) : t('production.list.durationMinutes', { minutes: m });
              };

              const prodMs = (qcStartMs && startMs) ? (qcStartMs - startMs - pauseMs) : (endMs && startMs && !qcStartMs) ? (endMs - startMs - pauseMs) : null;
              const qcMs = (envaseStartMs && qcStartMs) ? (envaseStartMs - qcStartMs) : null;
              const envaseMs = (endMs && envaseStartMs) ? (endMs - envaseStartMs) : null;
              const totalMs = (endMs && startMs) ? ((prodMs || 0) + (qcMs || 0) + (envaseMs || 0)) : null;

              if (!startMs) return null;

              return (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold mb-3">{t('production.list.productionTimes')}</h4>
                  <div className="grid grid-cols-1 gap-2 text-sm">
                    <div className="bg-blue-50 rounded-lg p-3">
                      <p className="text-xs font-semibold text-blue-700 mb-2">{t('production.list.productionPhase')}</p>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div><p className="text-muted-foreground">{t('production.fields.startTime')}</p><p className="font-medium">{p.start_time ? fmtDateTime(p.start_time, undefined, i18n.language) : t('common.notAvailable')}</p></div>
                        <div><p className="text-muted-foreground">{t('production.fields.endTime')}</p><p className="font-medium">{qcStartMs ? fmtDateTime(p.qc_start_time, undefined, i18n.language) : (endMs ? fmtDateTime(p.end_time, undefined, i18n.language) : t('common.notAvailable'))}</p></div>
                        <div><p className="text-muted-foreground">{t('production.list.timeMinusPause')}</p><p className="font-bold text-blue-700">{fmtDur(prodMs)}{pauseMs > 0 ? t('production.list.pauseLabel', { duration: fmtDur(pauseMs) }) : ''}</p></div>
                      </div>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-3">
                      <p className="text-xs font-semibold text-amber-700 mb-2">{t('production.list.qualityPhase')}</p>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div><p className="text-muted-foreground">{t('production.fields.startTime')}</p><p className="font-medium">{p.qc_start_time ? fmtDateTime(p.qc_start_time, undefined, i18n.language) : t('common.notAvailable')}</p></div>
                        <div><p className="text-muted-foreground">{t('production.fields.endTime')}</p><p className="font-medium">{envaseStartMs ? fmtDateTime(p.envase_start_time, undefined, i18n.language) : t('common.notAvailable')}</p></div>
                        <div><p className="text-muted-foreground">{t('common.time')}</p><p className="font-bold text-amber-700">{fmtDur(qcMs)}</p></div>
                      </div>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-3">
                      <p className="text-xs font-semibold text-purple-700 mb-2">{t('production.list.packagingPhase')}</p>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div><p className="text-muted-foreground">{t('production.fields.startTime')}</p><p className="font-medium">{p.envase_start_time ? fmtDateTime(p.envase_start_time, undefined, i18n.language) : t('common.notAvailable')}</p></div>
                        <div><p className="text-muted-foreground">{t('production.fields.endTime')}</p><p className="font-medium">{endMs ? fmtDateTime(p.end_time, undefined, i18n.language) : t('common.notAvailable')}</p></div>
                        <div><p className="text-muted-foreground">{t('common.time')}</p><p className="font-bold text-purple-700">{fmtDur(envaseMs)}</p></div>
                      </div>
                    </div>
                    {totalMs && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-green-700">{t('production.list.totalProductionTime')}</p>
                          <p className="text-lg font-bold text-green-700">{fmtDur(totalMs)}</p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{t('production.list.totalTimeBreakdown')}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {!simplified && (() => {
              const mps = parseArr(production.raw_materials_used);
              const mpCostRows = mps.map(m => {
                const price = priceOf(m);
                const qty = m.qty_fiscal || 0;
                return { name: m.mp_name, unit: unitOf(m), price, qty, cost: price * qty };
              });
              const totalMpCost = mpCostRows.reduce((s, r) => s + r.cost, 0);
              const recipe = (recipes || []).find(r => r.product_name === production.product);
              const productPrice = recipe?.price || production.unit_price || 0;
              const mass = production.mass || 0;
              const moCost = productPrice * mass;
              const totalCost = totalMpCost + moCost;
              const costPerKg = mass > 0 ? totalCost / mass : 0;
              const pctMp = totalCost > 0 ? (totalMpCost / totalCost) * 100 : 0;
              const pctMo = totalCost > 0 ? (moCost / totalCost) * 100 : 0;
              return (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold mb-2">{t('production.list.costAnalysis')}</h4>
                  <table className="w-full text-sm border rounded-lg overflow-hidden mb-3">
                    <thead><tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                      <th className="px-3 py-2 text-left">{t('production.list.rawMaterialCol')}</th>
                      <th className="px-3 py-2 text-right">{t('production.checklist.qtyFiscal')}</th>
                      <th className="px-3 py-2 text-right">{t('production.list.unitPriceCol')}</th>
                      <th className="px-3 py-2 text-right">{t('production.list.costCol')}</th>
                    </tr></thead>
                    <tbody>
                      {mpCostRows.map((r, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">{r.name || t('common.notAvailable')}</td>
                          <td className="px-3 py-2 text-right">{fmt(r.qty)} {r.unit}</td>
                          <td className="px-3 py-2 text-right">{fmt4(r.price)}</td>
                          <td className="px-3 py-2 text-right font-medium">{fmtMoney(r.cost)}</td>
                        </tr>
                      ))}
                      <tr className="border-t bg-muted/50 font-bold">
                        <td colSpan={3} className="px-3 py-2 text-right">{t('production.list.mpCost')}</td>
                        <td className="px-3 py-2 text-right" style={{ color: '#2575D1' }}>{fmtMoney(totalMpCost)}</td>
                      </tr>
                      <tr className="border-t bg-muted/50 font-bold">
                        <td colSpan={2} className="px-3 py-2">{t('production.list.laborCost')}</td>
                        <td className="px-3 py-2 text-right">{t('production.list.laborFormula', { price: fmt4(productPrice), mass: fmt(mass) })}</td>
                        <td className="px-3 py-2 text-right" style={{ color: '#2575D1' }}>{fmtMoney(moCost)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-blue-50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">{t('production.list.costMp')}</p>
                      <p className="font-bold text-sm" style={{ color: '#2575D1' }}>{fmtMoney(totalMpCost)}</p>
                      <p className="text-xs text-muted-foreground">{t('production.list.percentOfTotal', { percent: pctMp.toFixed(1) })}</p>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">{t('production.list.costMo')}</p>
                      <p className="font-bold text-sm text-purple-700">{fmtMoney(moCost)}</p>
                      <p className="text-xs text-muted-foreground">{t('production.list.percentOfTotal', { percent: pctMo.toFixed(1) })}</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">{t('production.list.totalCost')}</p>
                      <p className="font-bold text-sm text-green-700">{fmtMoney(totalCost)}</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">{t('production.list.costPerKg')}</p>
                      <p className="font-bold text-sm text-amber-700">{fmtMoney(costPerKg)}</p>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
        <div className={simplified ? 'flex justify-end mt-4' : 'flex justify-between mt-4'}>
          {!simplified && (
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={onGeneratePdf} className="gap-2">
                <FileText className="w-4 h-4" /> {t('production.actions.generatePdf')}
              </Button>
              {production?.public_token && (
                <Button variant="outline" onClick={onShowQr} className="gap-2">
                  <QrCode className="w-4 h-4" /> {t('production.list.qrCode')}
                </Button>
              )}
            </div>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('buttons.close')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
