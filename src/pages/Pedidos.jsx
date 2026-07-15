import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Pencil, AlertTriangle, Eye, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ProductCombobox from '@/components/ui/ProductCombobox';
import { useToast } from '@/components/ui/use-toast';
import OrderDetailsDialog from '@/components/pedidos/OrderDetailsDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import moment from 'moment';
import { fmtDate, fmtNumber } from '@/i18n/formatters';
import { translateOrderStatus } from '@/i18n/domainMaps';
import { matchesClient } from '@/lib/permissions';
import { usePermissions } from '@/lib/rbac/PermissionProvider';

const emptyOrder = { date: new Date().toISOString().split('T')[0], product: '', client: '', requester: '', client_order: '', volume_ordered: '', volume_produced: '', volume_pending: '', expected_date: '', status: 'Pendente', observations: '' };

/** Tolerância em litros para fechar pedido (float / arredondamento de UI). */
const VOLUME_EPS = 0.05;

const toNum = (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Pedido atendido: volume pendente ≈ 0 ou produzido ≥ pedido. */
const isOrderFullyProduced = (volumeOrdered, volumeProduced, volumePending) => {
  const ordered = toNum(volumeOrdered);
  if (ordered <= 0) return false;
  const produced = toNum(volumeProduced);
  const pending = toNum(volumePending);
  return pending <= VOLUME_EPS || produced >= ordered - VOLUME_EPS;
};

export default function Pedidos() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { isReadOnly } = useOutletContext();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('orders.create');
  const canEdit = hasPermission('orders.edit');
  const canDelete = hasPermission('orders.delete');
  const { data: rawOrders, loading, reload: loadOrders } = useRealtimeEntity('Order', () => base44.entities.Order.list('-created_date', 500));
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500));
  const { data: productions } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState(() => searchParams.get('client') || '');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailOrder, setDetailOrder] = useState(null);
  const [form, setForm] = useState(emptyOrder);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Compute derived order statuses from production data (recomputed automatically on any realtime change)
  const orders = useMemo(() => {
    return rawOrders.map(order => {
      const orderId = String(order.id);
      const linkedOPs = productions.filter(p => p.order_id != null && String(p.order_id) === orderId);
      const openOPs = linkedOPs.filter(p => !['Finalizado', 'Cancelado'].includes(p.status));
      const activeOPs = linkedOPs.filter(p => p.status !== 'Cancelado');
      const opProduced = activeOPs.reduce((s, p) => s + toNum(p.volume), 0);
      const volumeOrdered = toNum(order.volume_ordered);
      // Usa o maior entre soma das OPs e valor já gravado no pedido (evita regressão se OPs
      // não linkarem / lista de productions truncada) e respeita volume_pending já zerado no DB.
      const dbProduced = toNum(order.volume_produced);
      const dbPending = order.volume_pending == null || order.volume_pending === ''
        ? null
        : toNum(order.volume_pending);
      const totalProduced = Math.max(opProduced, dbProduced);
      let volumePending = Math.max(0, volumeOrdered - totalProduced);
      if (dbPending != null && dbPending <= VOLUME_EPS && volumeOrdered > 0) {
        volumePending = 0;
      }
      const fullyProduced = isOrderFullyProduced(volumeOrdered, totalProduced, volumePending);

      let newStatus = order.status === 'Parcial' ? 'Em produção' : order.status;
      // Sempre força Finalizado quando o volume foi atendido — inclusive após a data prevista
      if (fullyProduced) {
        newStatus = 'Finalizado';
      } else if (newStatus === 'Finalizado' || newStatus === 'Atrasado') {
        // Status inconsistente no DB: recalcula a partir das OPs
        if (openOPs.length > 0 || totalProduced > 0) newStatus = 'Em produção';
        else newStatus = 'Pendente';
      } else if (openOPs.length > 0 || totalProduced > 0) {
        newStatus = 'Em produção';
      } else {
        newStatus = 'Pendente';
      }

      return {
        ...order,
        status: newStatus,
        volume_produced: totalProduced,
        volume_pending: volumePending,
      };
    });
  }, [rawOrders, productions]);

  // Sync derived statuses back to DB (only when different) — guarded to avoid loops
  const lastSyncRef = useRef('');
  useEffect(() => {
    const updates = orders
      .filter(o => {
        const raw = rawOrders.find(r => r.id === o.id);
        if (!raw) return false;
        return (
          o.status !== raw.status
          || toNum(o.volume_produced) !== toNum(raw.volume_produced)
          || toNum(o.volume_pending) !== toNum(raw.volume_pending)
        );
      })
      .map(o => ({ id: o.id, status: o.status, volume_produced: o.volume_produced, volume_pending: o.volume_pending }));
    const syncKey = updates.map(u => `${u.id}:${u.status}:${u.volume_produced}:${u.volume_pending}`).join('|');
    if (updates.length > 0 && syncKey !== lastSyncRef.current) {
      lastSyncRef.current = syncKey;
      base44.entities.Order.bulkUpdate(updates).catch(() => {});
    }
  }, [orders, rawOrders]);

  const load = () => { loadOrders(); };

  const isOrderLate = (o) => {
    if (isOrderFullyProduced(o.volume_ordered, o.volume_produced, o.volume_pending)) return false;
    if (o.status === 'Finalizado') return false;
    if (toNum(o.volume_pending) <= VOLUME_EPS) return false;
    return Boolean(
      o.expected_date
      && moment(o.expected_date, 'YYYY-MM-DD').endOf('day').isBefore(moment())
    );
  };

  const getDisplayStatus = (o) => {
    // Regra de UI: volume atendido → Finalizado (nunca Atrasado), mesmo após a prev. atendimento
    if (isOrderFullyProduced(o.volume_ordered, o.volume_produced, o.volume_pending)) {
      return 'Finalizado';
    }
    if (o.status === 'Finalizado') return 'Finalizado';
    return isOrderLate(o) ? 'Atrasado' : o.status;
  };

  const clientOptions = useMemo(() => {
    const map = new Map();
    const add = (raw) => {
      const trimmed = (raw || '').trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (!map.has(key)) map.set(key, trimmed);
    };
    rawOrders.forEach(o => add(o.client));
    (recipes || []).forEach(r => add(r.client));
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [rawOrders, recipes]);

  useEffect(() => {
    if (!clientFilter || clientOptions.length === 0) return;
    const match = clientOptions.find(c => c.toLowerCase() === clientFilter.toLowerCase());
    if (match && match !== clientFilter) setClientFilter(match);
  }, [clientOptions, clientFilter]);

  const filtered = orders.filter(o => {
    const q = search.toLowerCase();
    const matchSearch = !q || [o.order_number, o.product, o.client, o.requester].some(v => (v || '').toLowerCase().includes(q));
    const displayStatus = getDisplayStatus(o);
    const matchStatus = statusFilter === 'all' || displayStatus === statusFilter;
    const matchClient = !clientFilter || matchesClient(o, clientFilter);
    return matchSearch && matchStatus && matchClient;
  });

  const openOrders = orders.filter(o =>
    o.status !== 'Finalizado'
    && !isOrderFullyProduced(o.volume_ordered, o.volume_produced, o.volume_pending)
  );
  const totalPendingVol = openOrders.reduce((s, o) => s + (o.volume_pending || 0), 0);

  const openNew = () => { setEditing(null); setForm({ ...emptyOrder }); setShowForm(true); };
  const openEdit = (o) => {
    setEditing(o);
    setForm({
      ...o,
      date: o.date ? o.date.split('T')[0] : '',
      expected_date: o.expected_date ? String(o.expected_date).split('T')[0] : '',
      volume_ordered: o.volume_ordered || '',
      volume_produced: o.volume_produced || '',
      volume_pending: o.volume_pending || '',
    });
    setShowForm(true);
  };
  const openDetails = (o) => { setDetailOrder(o); setShowDetails(true); };

  const handleProductChange = (productName) => {
    const recipe = recipes.find(r => r.product_name === productName);
    setForm(prev => ({ ...prev, product: productName, client: recipe?.client || prev.client }));
  };

  const save = async () => {
    const volOrdered = parseFloat(form.volume_ordered) || 0;
    const baseData = {
      ...form,
      date: form.date ? new Date(form.date).toISOString() : new Date().toISOString(),
      expected_date: form.expected_date || null,
      volume_ordered: volOrdered,
    };
    if (!baseData.product || !baseData.volume_ordered) { toast({ title: t('orders.messages.fillRequired'), variant: 'destructive' }); return; }
    setSaving(true);
    try {
      if (editing) {
        const data = { ...baseData };
        delete data.volume_produced;
        delete data.volume_pending;
        delete data.status;
        await base44.entities.Order.update(editing.id, data);

        // Mantém client_order sincronizado nas OPs vinculadas (campo denormalizado)
        const nextClientOrder = data.client_order ?? '';
        const prevClientOrder = editing.client_order ?? '';
        if (String(nextClientOrder) !== String(prevClientOrder)) {
          await base44.entities.Production.updateMany(
            { order_id: editing.id },
            { client_order: nextClientOrder }
          ).catch(() => {});
        }
      } else {
        const data = { ...baseData, volume_produced: 0, volume_pending: volOrdered, status: 'Pendente' };
        const count = orders.length + 1;
        data.order_number = `PD${String(count).padStart(2, '0')}`;
        await base44.entities.Order.create(data);
      }
      setShowForm(false);
      load();
      toast({ title: editing ? t('success.updated') : t('success.created') });
    } catch (err) {
      toast({ title: t('errors.saveFailed'), description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await base44.entities.Order.delete(deleteTarget.id);
      toast({ title: t('success.deleted') });
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast({ title: t('errors.deleteFailed'), description: err.message, variant: 'destructive' });
    }
  };

  const StatusBadge = ({ status }) => {
    const c = {
      Pendente: 'bg-amber-100 text-amber-700',
      'Em produção': 'bg-blue-100 text-blue-700',
      Finalizado: 'bg-green-100 text-green-700',
      Atrasado: 'bg-red-100 text-red-700',
    };
    return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${c[status] || 'bg-muted text-foreground'}`}>{translateOrderStatus(status)}</span>;
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Fixed Header */}
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">📋 {t('orders.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('orders.subtitle', { count: orders.length })}</p>
        </div>
        {canCreate && (
          <Button onClick={openNew} style={{ background: '#2575D1' }} className="text-white hover:opacity-90">
            <Plus className="w-4 h-4 mr-2" /> {t('orders.newOrder')}
          </Button>
        )}
      </div>

      {/* Card: fixed search, scrollable table, fixed footer */}
      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="shrink-0 p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-md min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder={t('orders.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={clientFilter || 'all'} onValueChange={v => setClientFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder={t('orders.allClients')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('orders.allClients')}</SelectItem>
              {clientOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder={t('orders.allStatuses')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('orders.allStatuses')}</SelectItem>
              <SelectItem value="Pendente">{t('orders.status.pending')}</SelectItem>
              <SelectItem value="Em produção">{t('orders.status.inProduction')}</SelectItem>
              <SelectItem value="Atrasado">{t('orders.status.late')}</SelectItem>
              <SelectItem value="Finalizado">{t('orders.status.finished')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Scrollable Table */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
          ) : (
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left">{t('orders.table.id')}</th>
                  <th className="px-4 py-3 text-left">{t('orders.table.date')}</th>
                  <th className="px-4 py-3 text-left">{t('orders.table.requester')}</th>
                  <th className="px-4 py-3 text-left">{t('orders.table.product')}</th>
                  <th className="px-4 py-3 text-left">{t('orders.table.client')}</th>
                  <th className="px-4 py-3 text-left">{t('orders.table.clientOrder')}</th>
                  <th className="px-4 py-3 text-right">{t('orders.table.volume')}</th>
                  <th className="px-4 py-3 text-right">{t('orders.table.volumeProduced')}</th>
                  <th className="px-4 py-3 text-right">{t('orders.table.volumePending')}</th>
                  <th className="px-4 py-3 text-left">{t('orders.table.expectedDate')}</th>
                  <th className="px-4 py-3 text-center">{t('orders.table.status')}</th>
                  <th className="px-4 py-3 text-center">{t('orders.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => {
                  const isLate = isOrderLate(o);
                  const displayStatus = getDisplayStatus(o);
                  return (
                    <tr key={o.id} className="border-b border-border hover:bg-accent/30">
                      <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>{o.order_number}</td>
                      <td className="px-4 py-2.5 text-sm">{o.date ? fmtDate(o.date) : t('common.notAvailable')}</td>
                      <td className="px-4 py-2.5 text-sm">{o.requester}</td>
                      <td className="px-4 py-2.5 font-medium text-sm">{o.product}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{o.client}</td>
                      <td className="px-4 py-2.5 text-sm">{o.client_order || t('common.notAvailable')}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-sm">{fmtNumber(o.volume_ordered)} L</td>
                      <td className="px-4 py-2.5 text-right font-bold text-sm text-green-600">{fmtNumber(o.volume_produced)} L</td>
                      <td className="px-4 py-2.5 text-right font-bold text-sm text-amber-600">{fmtNumber(o.volume_pending)} L</td>
                      <td className="px-4 py-2.5 text-sm">
                        <span className={isLate ? 'text-red-600 font-medium' : ''}>
                          {isLate && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                          {o.expected_date ? fmtDate(o.expected_date) : t('common.notAvailable')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center"><StatusBadge status={displayStatus} /></td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openDetails(o)} className="p-1 rounded hover:bg-muted" title={t('buttons.view')}>
                            <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                          {canEdit && <button onClick={() => openEdit(o)} className="p-1 rounded hover:bg-muted" title={t('buttons.edit')}>
                            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>}
                          {canDelete && <button onClick={() => setDeleteTarget(o)} className="p-1 rounded hover:bg-red-50" title={t('buttons.delete')}>
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Fixed Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-border flex items-center gap-6 text-xs text-muted-foreground">
          <span>{t('orders.footer.total')}: {orders.length}</span>
          <span>{t('orders.footer.open')}: {openOrders.length}</span>
          <span>{t('orders.footer.pendingVolume')}: <strong>{fmtNumber(totalPendingVol)} L</strong></span>
        </div>
      </div>

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t('orders.editOrder', { number: editing.order_number }) : t('orders.newOrderTitle')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">{t('orders.form.date')} *</label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">{t('orders.form.requester')} *</label><Input value={form.requester} onChange={e => setForm({ ...form, requester: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('orders.form.product')} *</label>
                <ProductCombobox
                  value={form.product}
                  onChange={handleProductChange}
                  options={recipes.map(r => ({ value: r.product_name, label: r.product_name }))}
                  placeholder={t('orders.form.productPlaceholder')}
                />
              </div>
              <div><label className="text-xs font-medium text-muted-foreground">{t('orders.form.client')}</label><Input value={form.client} readOnly className="bg-muted/50" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">{t('orders.form.clientOrder')}</label><Input value={form.client_order} onChange={e => setForm({ ...form, client_order: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">{t('orders.form.volume')} *</label><Input type="number" value={form.volume_ordered} onChange={e => setForm({ ...form, volume_ordered: e.target.value })} /></div>
            </div>

            <div><label className="text-xs font-medium text-muted-foreground">{t('orders.form.expectedDate')} *</label><Input type="date" value={form.expected_date} onChange={e => setForm({ ...form, expected_date: e.target.value })} /></div>
            <div><label className="text-xs font-medium text-muted-foreground">{t('orders.form.observations')}</label><textarea className="w-full border rounded-md px-3 py-2 text-sm" rows={2} value={form.observations || ''} onChange={e => setForm({ ...form, observations: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>{t('buttons.cancel')}</Button>
            <Button onClick={save} disabled={saving} style={{ background: '#2575D1' }} className="text-white">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('common.saving')}</> : editing ? t('orders.form.saveChanges') : t('orders.form.register')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order Details Dialog */}
      <OrderDetailsDialog open={showDetails} onOpenChange={setShowDetails} order={detailOrder} productions={productions} />

      {/* Delete Confirmation */}
      <ConfirmDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={t('orders.deleteConfirm.title')}
        message={t('orders.deleteConfirm.message', { number: deleteTarget?.order_number })}
        confirmLabel={t('buttons.delete')}
        confirmColor="#DC2626"
        onConfirm={confirmDelete} />
    </div>
  );
}
