import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useNavigate } from 'react-router-dom';
import { Search, Eye, Pencil, Ban, Loader2, PackagePlus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import InvoiceToggle from '@/components/productions/InvoiceToggle';
import { generateProductionPDF, generateProductionTanksPDF, generateProductionOriginsPDF, generateProductionOpFiscalPDF } from '@/lib/pdfReports';
import QrCodeDialog from '@/components/productions/QrCodeDialog';
import ProductionViewDialog from '@/components/production/ProductionViewDialog';
import FractionalBadge from '@/components/production/FractionalBadge';
import { isComplementPending } from '@/lib/fractionalSupply';
import { parseArr, containersOfProductionLot } from '@/lib/productionViewUtils';
import { packagingRowsForProduction } from '@/lib/containerOrigins';
import { fmtDate, fmtNumber, fmtCurrency } from '@/i18n/formatters';
import { translateProductionStatus } from '@/i18n/domainMaps';
import moment from 'moment';
import { usePermissions } from '@/lib/rbac/PermissionProvider';

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

export default function Producoes() {
  const { t, i18n } = useTranslation();
  const { hasPermission } = usePermissions();
  const canEditOp = hasPermission('productions.edit_op');
  const canCancelOp = hasPermission('productions.cancel');
  const canComplementLot = hasPermission('productions.complement');
  const [searchParams] = useSearchParams();
  const { data: productions, loading, reload: load, setData: setProductions } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 2000));
  const { data: containers } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const { data: stocks } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 500));
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500));
  const { data: transfers } = useRealtimeEntity('Transfer', () => base44.entities.Transfer.list('-created_date', 500));
  const { data: containerOrigins } = useRealtimeEntity('ContainerOrigin', () => base44.entities.ContainerOrigin.list('-created_date', 2000));
  const [search, setSearch] = useState(() => searchParams.get('product') || '');
  const [clientFilter, setClientFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || 'todos');
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('from') || '');
  const [dateTo, setDateTo] = useState(() => searchParams.get('to') || '');
  const [showView, setShowView] = useState(false);
  const [showEditPkg, setShowEditPkg] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [viewContainers, setViewContainers] = useState([]);
  const [viewPackagingRows, setViewPackagingRows] = useState([]);
  const [editingPkg, setEditingPkg] = useState(null);
  const [pkgValue, setPkgValue] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [clientOrder, setClientOrder] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);
  const [complementTarget, setComplementTarget] = useState(null);
  const [savingPkg, setSavingPkg] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrToken, setQrToken] = useState(null);
  const [qrLabel, setQrLabel] = useState('');
  const { toast } = useToast();
  const navigate = useNavigate();

  const clearDateFilter = () => {
    setDateFrom('');
    setDateTo('');
  };

  const clientOptions = useMemo(() => {
    const set = new Set();
    (recipes || []).forEach(r => { if (r.client?.trim()) set.add(r.client.trim()); });
    productions.forEach(p => { if (p.client?.trim()) set.add(p.client.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, i18n.language));
  }, [recipes, productions, i18n.language]);

  const hasActiveFilters = Boolean(
    search.trim()
    || dateFrom
    || dateTo
    || clientFilter !== 'todos'
    || statusFilter !== 'todos'
  );

  const filtered = useMemo(() => productions.filter(p => {
    const q = search.toLowerCase();
    const rows = packagingRowsForProduction(containers, containerOrigins, p);
    const opContainersOf = () => {
      const seen = new Set();
      const list = [];
      for (const r of rows) {
        if (r.container?.id && !seen.has(r.container.id)) {
          seen.add(r.container.id);
          list.push(r.container);
        }
      }
      return list.length ? list : containersOfProductionLot(containers, p);
    };
    const matchSearch = !q || [p.op_number, p.product, p.client, p.lot, p.client_order].some(v => (v || '').toLowerCase().includes(q))
      || opContainersOf().some(c => (c.container_number || '').toLowerCase().includes(q))
      || (p.packaging_type || '').toLowerCase().includes(q);
    const fabRaw = p.end_time || p.updated_date || null;
    const fabDate = fabRaw ? moment(fabRaw) : null;
    const matchFrom = !dateFrom || (fabDate && !fabDate.isBefore(moment(dateFrom, 'YYYY-MM-DD'), 'day'));
    const matchTo = !dateTo || (fabDate && !fabDate.isAfter(moment(dateTo, 'YYYY-MM-DD'), 'day'));
    const matchesClient = clientFilter === 'todos' || (p.client || '') === clientFilter;
    const matchStatus = statusFilter === 'todos'
      ? true
      : statusFilter === 'pendente_complemento'
        ? isComplementPending(p)
        : p.status === statusFilter;
    return matchSearch && matchFrom && matchTo && matchesClient && matchStatus;
  }), [productions, containers, containerOrigins, search, dateFrom, dateTo, clientFilter, statusFilter]);

  const footerStats = useMemo(() => {
    let activeOPs = 0;
    let finishedVolume = 0;
    for (const p of filtered) {
      if (!['Finalizado', 'Cancelado'].includes(p.status)) activeOPs += 1;
      if (p.status === 'Finalizado') {
        finishedVolume += parseFloat(p.volume) || 0;
      }
    }
    return {
      totalOPs: filtered.length,
      activeOPs,
      finishedVolume,
    };
  }, [filtered]);
  const fmt = (n) => fmtNumber(n, { minimumFractionDigits: 0 }, i18n.language);
  const fmtMoney = (n) => fmtCurrency(n, 'BRL', i18n.language);
  const savePkg = async () => {
    const price = parseFloat(unitPrice) || 0;
    const totalValue = price * (editingPkg.mass || 0);
    const updates = {
      packaging_type: pkgValue,
      packaging_info: pkgValue,
      unit_price: price,
      total_value: totalValue,
    };
    if (clientOrder.trim()) updates.client_order = clientOrder.trim();

    setSavingPkg(true);
    try {
      await base44.entities.Production.update(editingPkg.id, updates);

      if (clientOrder.trim()) {
        const syncedClientOrder = clientOrder.trim();
        const opNum = editingPkg.op_number;
        if (editingPkg.order_id) {
          await base44.entities.Order.update(editingPkg.order_id, { client_order: syncedClientOrder }).catch(() => {});
          // Propaga para todas as OPs do mesmo pedido (campo denormalizado)
          await base44.entities.Production.updateMany(
            { order_id: editingPkg.order_id },
            { client_order: syncedClientOrder }
          ).catch(() => {});
        }
        const allQR = await base44.entities.QualityResult.filter({ production_id: editingPkg.id });
        for (const qr of allQR) {
          await base44.entities.QualityResult.update(qr.id, { op_number: opNum }).catch(() => {});
        }
        const allC = containers.filter(c => c.op_number === opNum);
        for (const c of allC) {
          await base44.entities.Container.update(c.id, { op_number: opNum }).catch(() => {});
        }
      }

      setShowEditPkg(false);
      load();
      toast({ title: t('production.messages.updated') });
    } catch (err) {
      toast({ title: t('production.messages.updateError'), description: err.message, variant: 'destructive' });
    } finally {
      setSavingPkg(false);
    }
  };

  const canCancel = (status) => ['Aguardando Início', 'Em Produção'].includes(status);

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    try {
      const mps = parseArr(cancelTarget.raw_materials_used);
      // Return MP stock to inventory — aggregate by stock_id
      const stockReturns = {};
      for (const mp of mps) {
        if (mp.stock_id && mp.qty_fiscal > 0) {
          stockReturns[mp.stock_id] = (stockReturns[mp.stock_id] || 0) + mp.qty_fiscal;
        }
      }
      for (const [stockId, returnQty] of Object.entries(stockReturns)) {
        const stock = stocks.find(s => s.id === stockId);
        if (stock) {
          const newStock = parseFloat(((stock.current_stock || 0) + returnQty).toFixed(3));
          await base44.entities.RawMaterialStock.update(stockId, { current_stock: newStock });
        }
      }

      // Update linked order: subtract cancelled volume and recalculate
      if (cancelTarget.order_id) {
        try {
          const order = await base44.entities.Order.get(cancelTarget.order_id);
          if (order) {
            const cancelledVol = cancelTarget.volume || 0;
            const newProduced = Math.max(0, (order.volume_produced || 0) - cancelledVol);
            const newPending = Math.max(0, (order.volume_ordered || 0) - newProduced);
            const newStatus = newProduced <= 0 ? 'Pendente' : newProduced < (order.volume_ordered || 0) ? 'Em produção' : 'Finalizado';
            await base44.entities.Order.update(cancelTarget.order_id, {
              volume_produced: newProduced,
              volume_pending: newPending,
              status: newStatus,
            });
          }
        } catch (_e) {}
      }

      await base44.entities.Production.update(cancelTarget.id, {
        status: 'Cancelado',
        end_time: cancelTarget.end_time || new Date().toISOString(),
      });

      toast({ title: t('production.cancel.success', { op: cancelTarget.op_number }), description: t('production.cancel.successDetail') });
      setCancelTarget(null);
      load();
    } catch (err) {
      toast({ title: t('production.cancel.error'), variant: 'destructive' });
    }
  };

  const openView = (p) => {
    setViewing(p);
    const rows = packagingRowsForProduction(containers, containerOrigins, p);
    setViewPackagingRows(rows);
    const uniqueContainers = [];
    const seen = new Set();
    for (const row of rows) {
      if (row.container?.id && !seen.has(row.container.id)) {
        seen.add(row.container.id);
        uniqueContainers.push(row.container);
      }
    }
    // Fallback to lot-based list when no origin rows yet
    setViewContainers(uniqueContainers.length ? uniqueContainers : containersOfProductionLot(containers, p));
    setShowView(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 mb-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">📊 {t('production.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {hasActiveFilters
              ? t('production.list.subtitleFiltered', { filtered: footerStats.totalOPs, total: productions.length })
              : t('production.list.subtitle', { count: productions.length })}
          </p>
        </div>
        <div className="bg-card rounded-xl shadow-sm border border-border px-3 py-2 flex items-end gap-2 flex-wrap">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('production.filters.dateFrom')}</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="h-8 text-xs mt-0.5 w-[140px]"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('production.filters.dateTo')}</label>
            <Input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="h-8 text-xs mt-0.5 w-[140px]"
            />
          </div>
          {(dateFrom || dateTo) && (
            <Button size="sm" variant="outline" onClick={clearDateFilter} className="h-8 text-xs">
              {t('buttons.clear')}
            </Button>
          )}
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Filters */}
        <div className="shrink-0 p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="relative w-full max-w-md min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder={t('production.list.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder={t('common.client')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t('production.list.allClients')}</SelectItem>
              {clientOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder={t('common.status')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t('common.all')}</SelectItem>
              <SelectItem value="pendente_complemento">{t('production.fractional.badgePending')}</SelectItem>
              <SelectItem value="Aguardando Início">{translateProductionStatus('Aguardando Início')}</SelectItem>
              <SelectItem value="Em Produção">{translateProductionStatus('Em Produção')}</SelectItem>
              <SelectItem value="Qualidade">{translateProductionStatus('Qualidade')}</SelectItem>
              <SelectItem value="Envase">{translateProductionStatus('Envase')}</SelectItem>
              <SelectItem value="Finalizado">{translateProductionStatus('Finalizado')}</SelectItem>
              <SelectItem value="Cancelado">{translateProductionStatus('Cancelado')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Scrollable Table — só spinner no fetch inicial; recargas silenciosas preservam scroll */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
          {loading && productions.length === 0 ? (
            <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
          ) : (
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left">{t('production.opNumber')}</th>
                  <th className="px-4 py-3 text-left">{t('production.list.manufacturing')}</th>
                  <th className="px-4 py-3 text-left">{t('common.product')}</th>
                  <th className="px-4 py-3 text-left">{t('common.client')}</th>
                  <th className="px-4 py-3 text-left">{t('common.lot')}</th>
                  <th className="px-4 py-3 text-right">{t('production.packaging.volume')}</th>
                  <th className="px-4 py-3 text-left">{t('production.list.packagingCol')}</th>
                  <th className="px-4 py-3 text-center">{t('production.list.stage')}</th>
                  <th className="px-4 py-3 text-center">{t('production.list.billingSend')}</th>
                  <th className="px-4 py-3 text-center">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="border-b border-border hover:bg-accent/30">
                    <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>{p.op_number}</td>
                    <td className="px-4 py-2.5 text-sm">{p.end_time ? fmtDate(p.end_time, undefined, i18n.language) : t('common.notAvailable')}</td>
                    <td className="px-4 py-2.5 font-medium text-sm">{p.product}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{p.client}</td>
                    <td className="px-4 py-2.5 text-sm">{p.lot}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-sm">{fmt(p.volume)}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">
                      {(() => {
                        const rows = packagingRowsForProduction(containers, containerOrigins, p);
                        const opContainers = [];
                        const seen = new Set();
                        for (const r of rows) {
                          if (r.container?.id && !seen.has(r.container.id)) {
                            seen.add(r.container.id);
                            opContainers.push(r.container);
                          }
                        }
                        if (opContainers.length === 0) {
                          const legacy = containersOfProductionLot(containers, p);
                          if (legacy.length > 0) {
                            if (legacy.length > 1) {
                              return t('production.packaging.loadUnits', { count: String(legacy.length).padStart(2, '0') });
                            }
                            return legacy[0].container_number || p.packaging_type || t('common.notAvailable');
                          }
                          return p.packaging_type || t('common.notAvailable');
                        }
                        if (rows.length > 1 && opContainers.length === 1) {
                          return `${opContainers[0].container_number || t('common.notAvailable')} (${rows.length} ${t('production.opNumber').toLowerCase()})`;
                        }
                        if (opContainers.length > 1) {
                          return t('production.packaging.loadUnits', { count: String(opContainers.length).padStart(2, '0') });
                        }
                        return opContainers[0].container_number || p.packaging_type || t('common.notAvailable');
                      })()}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        {isComplementPending(p) ? (
                          <FractionalBadge production={p} />
                        ) : (
                          <StatusBadge status={p.status} />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <InvoiceToggle
                        invoiced={p.invoiced}
                        onToggle={async () => {
                          const next = !p.invoiced;
                          setProductions((prev) =>
                            prev.map((item) => (item.id === p.id ? { ...item, invoiced: next } : item))
                          );
                          try {
                            await base44.entities.Production.update(p.id, { invoiced: next });
                          } catch {
                            setProductions((prev) =>
                              prev.map((item) => (item.id === p.id ? { ...item, invoiced: !next } : item))
                            );
                            toast({
                              title: t('production.messages.updateError'),
                              variant: 'destructive',
                            });
                          }
                        }}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openView(p)} className="p-1 rounded hover:bg-muted"><Eye className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        {canEditOp && (
                          <button onClick={() => { setEditingPkg(p); setPkgValue(p.packaging_info || p.packaging_type || ''); setUnitPrice(p.unit_price || ''); setClientOrder(p.client_order || ''); setShowEditPkg(true); }} className="p-1 rounded hover:bg-muted"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        )}
                        {canComplementLot && isComplementPending(p) && (
                          <button
                            onClick={() => setComplementTarget(p)}
                            className="p-1 rounded hover:bg-amber-50"
                            title={t('production.fractional.complementAction')}
                          >
                            <PackagePlus className="w-3.5 h-3.5 text-amber-600" />
                          </button>
                        )}
                        {canCancelOp && canCancel(p.status) && (
                          <button onClick={() => setCancelTarget(p)} className="p-1 rounded hover:bg-red-50" title={t('production.actions.cancel')}><Ban className="w-3.5 h-3.5 text-red-400" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Fixed Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-border flex items-center gap-6 text-xs text-muted-foreground flex-wrap">
          <span>{t('production.list.totalOps')}: <strong className="text-foreground">{footerStats.totalOPs}</strong></span>
          <span>{t('production.list.activeOps')}: <strong className="text-foreground">{footerStats.activeOPs}</strong></span>
          <span>{t('production.list.finishedVolume')}: <strong className="text-foreground">{fmt(footerStats.finishedVolume)} L</strong></span>
        </div>
      </div>

      <ProductionViewDialog
        production={viewing}
        containers={viewContainers}
        origins={containerOrigins}
        packagingRows={viewPackagingRows}
        stocks={stocks}
        recipes={recipes}
        transfers={transfers}
        productions={productions}
        open={showView}
        onOpenChange={setShowView}
        onGeneratePdf={() => generateProductionPDF(viewing, viewContainers, stocks, recipes)}
        onGenerateTanksPdf={(selected) => {
          if (!selected || selected.length === 0) {
            generateProductionOpFiscalPDF(viewing, stocks, recipes);
            return;
          }
          const isOriginRows = Array.isArray(selected) && selected.length > 0 && selected[0]?.container;
          const ok = isOriginRows
            ? generateProductionOriginsPDF(viewing, selected, productions, stocks, recipes, viewPackagingRows)
            : generateProductionTanksPDF(viewing, viewContainers, selected, stocks, recipes);
          if (!ok) {
            toast({
              title: t('production.messages.tanksPdfError'),
              description: t('production.messages.tanksPdfZeroNet'),
              variant: 'destructive',
            });
          }
        }}
        onShowQr={() => { setQrToken(viewing.public_token); setQrLabel(`${viewing.op_number} · ${viewing.product} · ${t('common.lot')} ${viewing.lot}`); setShowQr(true); }}
      />

      {/* Edit Packaging Dialog */}
      <Dialog open={showEditPkg} onOpenChange={setShowEditPkg}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('production.list.editTitle', { op: editingPkg?.op_number })}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('production.list.clientOrder')}</label>
              <Input value={clientOrder} onChange={e => setClientOrder(e.target.value)} placeholder={t('production.list.clientOrderPlaceholder')} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('production.fields.packaging')}</label>
              <Input value={pkgValue} onChange={e => setPkgValue(e.target.value)} placeholder={t('production.newProduction.packagingPlaceholder')} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('production.list.unitPriceBrl')}</label>
              <Input type="number" step="0.01" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('production.list.totalValueAuto')}</label>
              <Input value={fmtMoney((parseFloat(unitPrice) || 0) * (editingPkg?.mass || 0))} readOnly className="bg-muted/50 font-semibold" />
              <p className="text-xs text-muted-foreground mt-1">{fmt(editingPkg?.mass || 0)} kg × {fmtCurrency(parseFloat(unitPrice) || 0, 'BRL', i18n.language)}</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowEditPkg(false)} disabled={savingPkg}>{t('buttons.cancel')}</Button>
            <Button onClick={savePkg} disabled={savingPkg} style={{ background: '#2575D1', color: 'white' }}>
              {savingPkg ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('common.saving')}</> : t('buttons.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <QrCodeDialog open={showQr} onOpenChange={setShowQr} token={qrToken} lotLabel={qrLabel} />
      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
        title={t('production.list.cancelTitle')}
        message={t('production.list.cancelMessage', { op: cancelTarget?.op_number })}
        onConfirm={confirmCancel}
        confirmLabel={t('production.list.cancelConfirmLabel')}
        confirmColor="#DC2626"
      />
      <ConfirmDialog
        open={!!complementTarget}
        onOpenChange={(open) => { if (!open) setComplementTarget(null); }}
        title={t('production.fractional.complementConfirmTitle')}
        message={t('production.fractional.complementConfirmMessage')}
        onConfirm={() => {
          if (complementTarget) navigate(`/nova-producao?complement=${complementTarget.id}`);
        }}
      />
    </div>
  );
}
