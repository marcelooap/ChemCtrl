import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, QrCode, ArrowUpRight, Pencil, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtDateTime, fmtNumber, fmtVolume, fmtMass, fmtCurrency } from '@/i18n/formatters';
import { translateProductionStatus } from '@/i18n/domainMaps';
import {
  parseArr,
  stockUnitOf,
  liveLotOf,
  isTransferDestinationContainer,
  containerLiveNetWeight,
  resolveProductDensity,
  convertToKg,
  convertFromKg,
  round3,
} from '@/lib/productionViewUtils';
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
  canEditMp = false,
  savingMp = false,
  onSaveMp,
  onGeneratePdf,
  onGenerateTanksPdf,
  onShowQr,
}) {
  const { t, i18n } = useTranslation();
  const fmt = (n) => fmtNumber(n, { minimumFractionDigits: 0 }, i18n.language);
  const fmtGross = (n) => fmtNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, i18n.language);
  const fmtMoney = (n) => fmtCurrency(n, 'BRL', i18n.language);

  const unitOf = (mp) => stockUnitOf(mp, stocks);
  const lotOf = (mp) => liveLotOf(mp, stocks);
  const densityOf = (mp) => {
    if (!mp?.stock_id) return 1;
    const s = stocks.find((x) => x.id === mp.stock_id);
    return s?.density || 1;
  };

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [editingMp, setEditingMp] = useState(false);
  const [draftMps, setDraftMps] = useState([]);

  const packagingRows = packagingRowsProp
    || packagingRowsForProduction(containers, origins, production);

  const rawMaterials = editingMp ? draftMps : parseArr(production?.raw_materials_used);
  const canShowEditMp = !simplified
    && canEditMp
    && !!onSaveMp
    && production
    && production.status !== 'Cancelado'
    && parseArr(production.raw_materials_used).length > 0;

  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setEditingMp(false);
      setDraftMps([]);
    }
  }, [open, production?.id]);

  const startEditMp = () => {
    setDraftMps(parseArr(production.raw_materials_used).map((m) => ({ ...m })));
    setEditingMp(true);
  };

  const cancelEditMp = () => {
    setEditingMp(false);
    setDraftMps([]);
  };

  const handleQtyFiscalChange = (index, rawVal) => {
    const val = Math.max(0, parseFloat(rawVal) || 0);
    setDraftMps((prev) => {
      const next = [...prev];
      const mp = { ...next[index] };
      const unit = unitOf(mp);
      const dens = densityOf(mp);
      mp.qty_fiscal = round3(val);
      mp.qty_operational = round3(convertToKg(val, unit, dens));
      next[index] = mp;
      return next;
    });
  };

  const handleQtyOperationalChange = (index, rawVal) => {
    const val = Math.max(0, parseFloat(rawVal) || 0);
    setDraftMps((prev) => {
      const next = [...prev];
      const mp = { ...next[index] };
      const unit = unitOf(mp);
      const dens = densityOf(mp);
      mp.qty_operational = round3(val);
      mp.qty_fiscal = round3(convertFromKg(val, unit, dens));
      next[index] = mp;
      return next;
    });
  };

  /** Available stock lots for a MP row (excludes lots already used by sibling rows). */
  const availableStocksForRow = (mp, index) => {
    const usedByOthers = new Set(
      draftMps
        .filter((row, j) => j !== index && row.mp_code === mp.mp_code)
        .map((row) => row.stock_id)
        .filter(Boolean)
    );
    return stocks.filter((s) => {
      if (s.mp_code !== mp.mp_code) return false;
      if (s.id === mp.stock_id) return true;
      if (usedByOthers.has(s.id)) return false;
      return (s.current_stock || 0) > 0;
    });
  };

  const handleLotChange = (index, stockId) => {
    const stock = stocks.find((s) => s.id === stockId);
    if (!stock) return;
    setDraftMps((prev) => {
      const next = [...prev];
      const mp = { ...next[index] };
      const opKg = parseFloat(mp.qty_operational) || 0;
      const unit = stock.unit || 'kg';
      const dens = stock.density || 1;
      // Keep operational mass; recalculate fiscal for the new stock unit/density
      mp.stock_id = stockId;
      mp.lot = stock.lot || '';
      mp.qty_operational = round3(opKg);
      mp.qty_fiscal = round3(convertFromKg(opKg, unit, dens));
      next[index] = mp;
      return next;
    });
  };

  const handleSaveMp = async () => {
    if (!onSaveMp) return;
    try {
      await onSaveMp(draftMps);
      setEditingMp(false);
      setDraftMps([]);
    } catch (_err) {
      // Parent already toasted; keep edit mode so the user can adjust
    }
  };

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

  const handleGenerateOpFiscalPdf = () => {
    if (!onGenerateTanksPdf) return;
    onGenerateTanksPdf([]);
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
              <div><p className="text-xs text-muted-foreground">{t('production.list.clientOrder')}</p><p className="font-medium">{production.client_order || t('common.notAvailable')}</p></div>
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

            <div className="flex items-center gap-3 mt-4 mb-2 flex-wrap">
              <h4 className="text-sm font-semibold">{t('production.list.rawMaterialsUsed')}</h4>
              {canShowEditMp && (
                editingMp ? (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={cancelEditMp}
                      disabled={savingMp}
                      className="h-7 text-xs"
                    >
                      {t('buttons.cancel')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSaveMp}
                      disabled={savingMp}
                      className="h-7 text-xs text-white hover:opacity-90"
                      style={{ background: '#2575D1' }}
                    >
                      {savingMp
                        ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> {t('common.saving')}</>
                        : t('buttons.save')}
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={startEditMp}
                    className="h-7 text-xs gap-1.5"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    {t('production.actions.editMp')}
                  </Button>
                )
              )}
            </div>
            <table className={`w-full text-sm border rounded-lg overflow-hidden ${!simplified && packagingRows.length === 0 ? 'mb-3' : 'mb-4'}`}>
              <thead><tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                <th className="px-3 py-2 text-left">{t('common.code')}</th>
                <th className="px-3 py-2 text-left">{t('production.list.mpShort')}</th>
                <th className="px-3 py-2 text-left">{t('common.lot')}</th>
                <th className="px-3 py-2 text-right">{t('production.checklist.qtyFiscal')}</th>
                <th className="px-3 py-2 text-right">{t('production.checklist.qtyOperational')} (kg)</th>
              </tr></thead>
              <tbody>
                {rawMaterials.map((m, i) => {
                  const unit = unitOf(m);
                  const lotOptions = editingMp ? availableStocksForRow(m, i) : [];
                  return (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs" style={{ color: '#2575D1' }}>{m.mp_code}</td>
                      <td className="px-3 py-2">{m.mp_name}</td>
                      <td className="px-3 py-2">
                        {editingMp ? (
                          <Select
                            value={m.stock_id || undefined}
                            onValueChange={(v) => handleLotChange(i, v)}
                            disabled={savingMp}
                          >
                            <SelectTrigger className="h-8 text-xs min-w-[10rem] max-w-[14rem]">
                              <SelectValue placeholder={t('production.newProduction.selectLot')} />
                            </SelectTrigger>
                            <SelectContent>
                              {lotOptions.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {t('production.newProduction.lotOption', {
                                    id: s.entry_id || s.id,
                                    lot: s.lot || t('common.notAvailable'),
                                    balance: fmt(s.current_stock || 0),
                                    unit: s.unit || 'kg',
                                  })}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          lotOf(m) || t('common.notAvailable')
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {editingMp ? (
                          <div className="inline-flex items-center justify-end gap-1">
                            <Input
                              type="number"
                              step="0.001"
                              min="0"
                              value={m.qty_fiscal ?? ''}
                              onChange={(e) => handleQtyFiscalChange(i, e.target.value)}
                              disabled={savingMp}
                              className="h-8 w-[7.5rem] text-xs text-right"
                            />
                            <span className="text-xs text-muted-foreground min-w-[1.5rem]">{unit}</span>
                          </div>
                        ) : (
                          <>{fmt(m.qty_fiscal)} {unit}</>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {editingMp ? (
                          <div className="inline-flex items-center justify-end gap-1">
                            <Input
                              type="number"
                              step="0.001"
                              min="0"
                              value={m.qty_operational ?? ''}
                              onChange={(e) => handleQtyOperationalChange(i, e.target.value)}
                              disabled={savingMp}
                              className="h-8 w-[7.5rem] text-xs text-right"
                            />
                            <span className="text-xs text-muted-foreground">kg</span>
                          </div>
                        ) : (
                          <>{fmt(m.qty_operational)} kg</>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(() => {
                  const mps = rawMaterials;
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
            {!simplified && packagingRows.length === 0 && (
              <div className="flex justify-end mb-4">
                <Button
                  size="sm"
                  onClick={handleGenerateOpFiscalPdf}
                  className="gap-2 text-white hover:opacity-90"
                  style={{ background: '#2575D1' }}
                >
                  <FileText className="w-4 h-4" /> {t('production.actions.generateTanksPdf')}
                </Button>
              </div>
            )}

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
                <h4 className="text-sm font-semibold mb-2 mt-4">{t('production.list.packagedContainers')}</h4>
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
                {!simplified && (
                  <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
                    <Button
                      type="button"
                      size="sm"
                      onClick={selectAllPackaging}
                      className="shrink-0 text-white hover:opacity-90"
                      style={{ background: '#2575D1' }}
                    >
                      {allSelected
                        ? t('production.list.deselectAllPackaging')
                        : t('production.list.selectAllPackaging')}
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleGenerateTanksPdf}
                      disabled={!hasSelection}
                      className="gap-2 shrink-0 text-white hover:opacity-90"
                      style={{ background: '#2575D1' }}
                    >
                      <FileText className="w-4 h-4" /> {t('production.actions.generateTanksPdf')}
                    </Button>
                  </div>
                )}
              </>
            ) : (production.packaging_info || production.packaging_type) ? (
              <div className="mt-4">
                <h4 className="text-sm font-semibold mb-2">{t('production.list.suggestedPackaging')}</h4>
                <p className="text-sm bg-muted/50 rounded-lg px-3 py-2 font-medium">{production.packaging_info || production.packaging_type}</p>
              </div>
            ) : null}
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
