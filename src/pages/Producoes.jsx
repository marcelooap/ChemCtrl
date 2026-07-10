import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { Search, Eye, Pencil, FileText, Ban, Loader2, QrCode } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import InvoiceToggle from '@/components/productions/InvoiceToggle';
import { generateProductionPDF } from '@/lib/pdfReports';
import QrCodeDialog from '@/components/productions/QrCodeDialog';
import { fmtDate, fmtDateTime, fmtNumber, fmtVolume, fmtMass, fmtCurrency } from '@/i18n/formatters';
import { translateProductionStatus, translatePriority } from '@/i18n/domainMaps';
import moment from 'moment';

const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) { return []; }
};

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
  const { data: productions, loading, reload: load } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 500));
  const { data: containers } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const { data: stocks } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 500));
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('todos');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showView, setShowView] = useState(false);
  const [showEditPkg, setShowEditPkg] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [viewContainers, setViewContainers] = useState([]);
  const [editingPkg, setEditingPkg] = useState(null);
  const [pkgValue, setPkgValue] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [clientOrder, setClientOrder] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);
  const [savingPkg, setSavingPkg] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrToken, setQrToken] = useState(null);
  const [qrLabel, setQrLabel] = useState('');
  const { toast } = useToast();

  const clientOptions = useMemo(() => {
    const set = new Set();
    (recipes || []).forEach(r => { if (r.client?.trim()) set.add(r.client.trim()); });
    productions.forEach(p => { if (p.client?.trim()) set.add(p.client.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, i18n.language));
  }, [recipes, productions, i18n.language]);

  const filtered = productions.filter(p => {
    const q = search.toLowerCase();
    const opContainersOf = (p) => containers.filter(c => c.op_number === p.op_number);
    const matchSearch = !q || [p.op_number, p.product, p.client, p.lot, p.client_order].some(v => (v || '').toLowerCase().includes(q))
      || opContainersOf(p).some(c => (c.container_number || '').toLowerCase().includes(q))
      || (p.packaging_type || '').toLowerCase().includes(q);
    const endDate = p.end_time ? moment(p.end_time) : null;
    const matchFrom = !dateFrom || (endDate && endDate.isSameOrAfter(moment(dateFrom), 'day'));
    const matchTo = !dateTo || (endDate && endDate.isSameOrBefore(moment(dateTo), 'day'));
    const matchesClient = clientFilter === 'todos' || (p.client || '') === clientFilter;
    return matchSearch && matchFrom && matchTo && matchesClient;
  });

  const totalOPs = filtered.length;
  const activeOPs = filtered.filter(p => !['Finalizado', 'Cancelado'].includes(p.status)).length;
  const totalVol = filtered.filter(p => p.status === 'Finalizado').reduce((s, p) => s + (p.volume || 0), 0);
  const fmt = (n) => fmtNumber(n, { minimumFractionDigits: 0 }, i18n.language);
  const fmtMoney = (n) => fmtCurrency(n, 'BRL', i18n.language);
  const fmt4 = (n) => fmtNumber(n, { minimumFractionDigits: 4, maximumFractionDigits: 4 }, i18n.language);
  const stockUnitOf = (mp) => {
    if (mp.stock_id) { const s = (stocks || []).find(x => x.id === mp.stock_id); if (s && s.unit) return s.unit; }
    return 'kg';
  };
  const liveLotOf = (mp) => {
    if (mp.stock_id) { const s = (stocks || []).find(x => x.id === mp.stock_id); if (s && s.lot) return s.lot; }
    return mp.lot;
  };
  const stockUnitPriceOf = (mp) => {
    if (mp.stock_id) { const s = (stocks || []).find(x => x.id === mp.stock_id); if (s) return s.unit_price || 0; }
    return 0;
  };

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
        const opNum = editingPkg.op_number;
        if (editingPkg.order_id) {
          await base44.entities.Order.update(editingPkg.order_id, { client_order: clientOrder.trim() }).catch(() => {});
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
    setViewContainers(containers.filter(c => c.op_number === p.op_number));
    setShowView(true);
  };

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">📊 {t('production.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('production.list.subtitle', { count: productions.length })}</p>
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 flex flex-col overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
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
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t('production.list.finishDateFrom')}</span>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-9 text-xs" />
            <span>{t('production.list.finishDateUntil')}</span>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-9 text-xs" />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-blue-500 underline text-xs">{t('common.clear')}</button>
            )}
          </div>
        </div>

        {/* Scrollable Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
          ) : (
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-gray-50">
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
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-accent/30">
                    <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>{p.op_number}</td>
                    <td className="px-4 py-2.5 text-sm">{p.end_time ? fmtDate(p.end_time, undefined, i18n.language) : t('common.notAvailable')}</td>
                    <td className="px-4 py-2.5 font-medium text-sm">{p.product}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{p.client}</td>
                    <td className="px-4 py-2.5 text-sm">{p.lot}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-sm">{fmt(p.volume)}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">
                      {(() => {
                        const opContainers = containers.filter(c => c.op_number === p.op_number);
                        if (opContainers.length > 0) {
                          if (opContainers.length > 1) {
                            return t('production.packaging.loadUnits', { count: String(opContainers.length).padStart(2, '0') });
                          }
                          return opContainers.map(c => c.container_number).filter(Boolean).join(', ') || t('common.notAvailable');
                        }
                        return p.packaging_type || p.packaging_info || t('common.notAvailable');
                      })()}
                    </td>
                    <td className="px-4 py-2.5 text-center"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-2.5 text-center">
                      <InvoiceToggle
                        invoiced={p.invoiced}
                        onToggle={async () => {
                          await base44.entities.Production.update(p.id, { invoiced: !p.invoiced });
                          load();
                        }}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openView(p)} className="p-1 rounded hover:bg-muted"><Eye className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        <button onClick={() => { setEditingPkg(p); setPkgValue(p.packaging_info || p.packaging_type || ''); setUnitPrice(p.unit_price || ''); setClientOrder(p.client_order || ''); setShowEditPkg(true); }} className="p-1 rounded hover:bg-muted"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        {canCancel(p.status) && (
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
        <div className="px-4 py-3 border-t border-border flex items-center gap-6 text-xs text-muted-foreground">
          <span>{t('production.list.totalOps', { count: totalOPs })}</span>
          <span>{t('production.list.activeOps', { count: activeOPs })}</span>
          <span>{t('production.list.finishedVolume', { volume: fmt(totalVol) })}</span>
        </div>
      </div>

      {/* View Dialog */}
      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{viewing?.op_number} · {viewing?.product}</DialogTitle></DialogHeader>
          {viewing && (
            <div>
              <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                <div><p className="text-xs text-muted-foreground">{t('production.opNumber')}</p><p className="font-bold" style={{ color: '#2575D1' }}>{viewing.op_number}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('common.lot')}</p><p className="font-medium">{viewing.lot}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('production.list.finishDate')}</p><p className="font-medium">{viewing.end_time ? fmtDateTime(viewing.end_time, undefined, i18n.language) : t('common.notAvailable')}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('common.product')}</p><p className="font-bold">{viewing.product}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('common.client')}</p><p className="font-medium">{viewing.client}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('common.volume')}</p><p className="font-medium">{fmtVolume(viewing.volume, 'L', i18n.language)}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('common.mass')}</p><p className="font-bold">{fmtMass(viewing.mass, 'kg', i18n.language)}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('production.list.revision')}</p><p className="font-medium">{viewing.recipe_revision}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('production.fields.priority')}</p><p className="font-medium">{translatePriority(viewing.priority)}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('production.list.stage')}</p><StatusBadge status={viewing.status} /></div>
                <div><p className="text-xs text-muted-foreground">{t('production.fields.unitPrice')}</p><p className="font-bold" style={{ color: '#2575D1' }}>{t('production.list.unitPricePerKg', { price: fmtCurrency(viewing.unit_price || 0, 'BRL', i18n.language) })}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('production.fields.totalValue')}</p><p className="font-bold">{fmtMoney(viewing.total_value)}</p></div>
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
                  {parseArr(viewing.raw_materials_used).map((m, i) => {
                    const unit = stockUnitOf(m);
                    return (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs" style={{ color: '#2575D1' }}>{m.mp_code}</td>
                      <td className="px-3 py-2">{m.mp_name}</td>
                      <td className="px-3 py-2">{liveLotOf(m) || t('common.notAvailable')}</td>
                      <td className="px-3 py-2 text-right">{fmt(m.qty_fiscal)} {unit}</td>
                      <td className="px-3 py-2 text-right font-medium">{fmt(m.qty_operational)} kg</td>
                    </tr>
                    );
                  })}
                  {(() => {
                    const mps = parseArr(viewing.raw_materials_used);
                    const units = mps.map(stockUnitOf);
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

              {/* Análise de Custos (somente na tela, não consta no PDF) */}
              {(() => {
                const mps = parseArr(viewing.raw_materials_used);
                const mpCostRows = mps.map(m => {
                  const price = stockUnitPriceOf(m);
                  const qty = m.qty_fiscal || 0;
                  return { name: m.mp_name, unit: stockUnitOf(m), price, qty, cost: price * qty };
                });
                const totalMpCost = mpCostRows.reduce((s, r) => s + r.cost, 0);
                const recipe = (recipes || []).find(r => r.product_name === viewing.product);
                const productPrice = recipe?.price || viewing.unit_price || 0;
                const mass = viewing.mass || 0;
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

              {viewContainers.length > 0 ? (
                <>
                  <h4 className="text-sm font-semibold mb-2">{t('production.list.packagedContainers')}</h4>
                  <table className="w-full text-sm border rounded-lg overflow-hidden">
                    <thead><tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                      <th className="px-3 py-2 text-left">{t('production.list.packagingNumber')}</th>
                      <th className="px-3 py-2 text-left">{t('common.type')}</th>
                      <th className="px-3 py-2 text-right">{t('production.packaging.volume')}</th>
                      <th className="px-3 py-2 text-right">{t('production.packaging.netWeight')}</th>
                      <th className="px-3 py-2 text-right">{t('production.packaging.grossWeight')}</th>
                    </tr></thead>
                    <tbody>
                      {viewContainers.map((c, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2 font-medium">{c.container_number || t('common.notAvailable')}</td>
                          <td className="px-3 py-2">{c.type || t('common.notAvailable')}</td>
                          <td className="px-3 py-2 text-right">{fmt(c.volume)}</td>
                          <td className="px-3 py-2 text-right">{fmt(c.net_weight)}</td>
                          <td className="px-3 py-2 text-right">{fmt(c.gross_weight)}</td>
                        </tr>
                      ))}
                      <tr className="border-t bg-muted/50 font-bold" style={{ color: '#2575D1' }}>
                        <td colSpan={2} className="px-3 py-2">{t('production.checklist.total').toUpperCase()}</td>
                        <td className="px-3 py-2 text-right">{fmt(viewContainers.reduce((s, c) => s + (c.volume || 0), 0))} L</td>
                        <td className="px-3 py-2 text-right">{fmt(viewContainers.reduce((s, c) => s + (c.net_weight || 0), 0))} kg</td>
                        <td className="px-3 py-2 text-right">{fmt(viewContainers.reduce((s, c) => s + (c.gross_weight || 0), 0))} kg</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              ) : (viewing.packaging_info || viewing.packaging_type) ? (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold mb-2">{t('production.list.suggestedPackaging')}</h4>
                  <p className="text-sm bg-muted/50 rounded-lg px-3 py-2 font-medium">{viewing.packaging_info || viewing.packaging_type}</p>
                </div>
              ) : null}

              {/* Tempos de Produção */}
              {(() => {
                const p = viewing;
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
            </div>
          )}
          <div className="flex justify-between mt-4">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => generateProductionPDF(viewing, viewContainers, stocks)} className="gap-2">
                <FileText className="w-4 h-4" /> {t('production.actions.generatePdf')}
              </Button>
              {viewing?.public_token && (
                <Button variant="outline" onClick={() => { setQrToken(viewing.public_token); setQrLabel(`${viewing.op_number} · ${viewing.product} · ${t('common.lot')} ${viewing.lot}`); setShowQr(true); }} className="gap-2">
                  <QrCode className="w-4 h-4" /> {t('production.list.qrCode')}
                </Button>
              )}
            </div>
            <Button variant="outline" onClick={() => setShowView(false)}>{t('buttons.close')}</Button>
          </div>
        </DialogContent>
      </Dialog>

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
    </div>
  );
}
