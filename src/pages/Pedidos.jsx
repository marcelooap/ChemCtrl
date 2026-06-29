import React, { useState, useEffect, useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Pencil, AlertTriangle, Eye, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import OrderDetailsDialog from '@/components/pedidos/OrderDetailsDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import moment from 'moment';

const emptyOrder = { date: new Date().toISOString().split('T')[0], product: '', client: '', requester: '', client_order: '', volume_ordered: '', volume_produced: '', volume_pending: '', expected_date: '', status: 'Pendente', observations: '' };

export default function Pedidos() {
  const { isReadOnly } = useOutletContext();
  const { data: rawOrders, loading, reload: loadOrders } = useRealtimeEntity('Order', () => base44.entities.Order.list('-created_date', 500));
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500));
  const { data: productions } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailOrder, setDetailOrder] = useState(null);
  const [form, setForm] = useState(emptyOrder);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const { toast } = useToast();

  // Compute derived order statuses from production data (recomputed automatically on any realtime change)
  const orders = useMemo(() => {
    return rawOrders.map(order => {
      const linkedOPs = productions.filter(p => p.order_id === order.id);
      const openOPs = linkedOPs.filter(p => !['Finalizado', 'Cancelado'].includes(p.status));
      const totalProduced = linkedOPs.reduce((s, p) => s + (p.volume || 0), 0);

      let newStatus = order.status;
      if (order.status === 'Parcial') newStatus = 'Em produção';
      if (order.status !== 'Finalizado') {
        if (openOPs.length > 0) {
          newStatus = 'Em produção';
        } else if (linkedOPs.length > 0 && totalProduced >= (order.volume_ordered || 0)) {
          newStatus = 'Finalizado';
        } else {
          newStatus = 'Pendente';
        }
      }
      return {
        ...order,
        status: newStatus,
        volume_produced: totalProduced,
        volume_pending: (order.volume_ordered || 0) - totalProduced,
      };
    });
  }, [rawOrders, productions]);

  // Sync derived statuses back to DB (only when different) — guarded to avoid loops
  const lastSyncRef = useRef('');
  useEffect(() => {
    const updates = orders
      .filter(o => o.status !== rawOrders.find(r => r.id === o.id)?.status || (o.volume_produced || 0) !== (rawOrders.find(r => r.id === o.id)?.volume_produced || 0) || (o.volume_pending || 0) !== (rawOrders.find(r => r.id === o.id)?.volume_pending || 0))
      .map(o => ({ id: o.id, status: o.status, volume_produced: o.volume_produced, volume_pending: o.volume_pending }));
    const syncKey = updates.map(u => `${u.id}:${u.status}:${u.volume_produced}`).join('|');
    if (updates.length > 0 && syncKey !== lastSyncRef.current) {
      lastSyncRef.current = syncKey;
      base44.entities.Order.bulkUpdate(updates).catch(() => {});
    }
  }, [orders, rawOrders]);

  const load = () => { loadOrders(); };

  const filtered = orders.filter(o => {
    const q = search.toLowerCase();
    const matchSearch = !q || [o.order_number, o.product, o.client, o.requester].some(v => (v || '').toLowerCase().includes(q));
    const matchStatus = statusFilter === 'all' || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const openOrders = orders.filter(o => o.status !== 'Finalizado');
  const totalPendingVol = openOrders.reduce((s, o) => s + (o.volume_pending || 0), 0);

  const openNew = () => { setEditing(null); setForm({ ...emptyOrder }); setShowForm(true); };
  const openEdit = (o) => {
    setEditing(o);
    setForm({ ...o, date: o.date ? o.date.split('T')[0] : '', volume_ordered: o.volume_ordered || '', volume_produced: o.volume_produced || '', volume_pending: o.volume_pending || '' });
    setShowForm(true);
  };
  const openDetails = (o) => { setDetailOrder(o); setShowDetails(true); };

  const handleProductChange = (productName) => {
    const recipe = recipes.find(r => r.product_name === productName);
    setForm(prev => ({ ...prev, product: productName, client: recipe?.client || prev.client }));
  };

  const save = async () => {
    const volOrdered = parseFloat(form.volume_ordered) || 0;
    const baseData = { ...form, date: form.date ? new Date(form.date).toISOString() : new Date().toISOString(), volume_ordered: volOrdered };
    if (!baseData.product || !baseData.volume_ordered) { toast({ title: 'Preencha produto e volume', variant: 'destructive' }); return; }
    try {
      if (editing) {
        const data = { ...baseData };
        delete data.volume_produced;
        delete data.volume_pending;
        delete data.status;
        await base44.entities.Order.update(editing.id, data);
      } else {
        const data = { ...baseData, volume_produced: 0, volume_pending: volOrdered, status: 'Pendente' };
        const count = orders.length + 1;
        data.order_number = `PD${String(count).padStart(2, '0')}`;
        await base44.entities.Order.create(data);
      }
      setShowForm(false);
      load();
      toast({ title: editing ? 'Pedido atualizado' : 'Novo pedido registrado' });
    } catch (err) {
      toast({ title: 'Erro ao salvar pedido', description: err.message, variant: 'destructive' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await base44.entities.Order.delete(deleteTarget.id);
      toast({ title: 'Pedido excluído' });
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast({ title: 'Erro ao excluir pedido', description: err.message, variant: 'destructive' });
    }
  };

  const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 });

  const StatusBadge = ({ status }) => {
    const c = { Pendente: 'bg-amber-100 text-amber-700', 'Em produção': 'bg-blue-100 text-blue-700', Finalizado: 'bg-green-100 text-green-700' };
    return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${c[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>;
  };

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      {/* Fixed Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#1A1A2E' }}>📋 Pedidos de Produção</h1>
          <p className="text-sm text-muted-foreground">{orders.length} pedido(s) registrado(s)</p>
        </div>
        {!isReadOnly && (
          <Button onClick={openNew} style={{ background: '#2575D1' }} className="text-white hover:opacity-90">
            <Plus className="w-4 h-4 mr-2" /> Novo Pedido
          </Button>
        )}
      </div>

      {/* Card: fixed search, scrollable table, fixed footer */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar por ID, produto, cliente..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Todos os status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="Pendente">Pendente</SelectItem>
              <SelectItem value="Em produção">Em produção</SelectItem>
              <SelectItem value="Finalizado">Finalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Scrollable Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" /></div>
          ) : (
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-gray-50">
                  <th className="px-4 py-3 text-left">ID</th>
                  <th className="px-4 py-3 text-left">Data</th>
                  <th className="px-4 py-3 text-left">Solicitante</th>
                  <th className="px-4 py-3 text-left">Produto</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Ped. Cliente</th>
                  <th className="px-4 py-3 text-right">Volume (L)</th>
                  <th className="px-4 py-3 text-right">Vol. Produzido</th>
                  <th className="px-4 py-3 text-right">Vol. Pendente</th>
                  <th className="px-4 py-3 text-left">Prev. Atend.</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => {
                  const isLate = o.status !== 'Finalizado' && o.expected_date && moment(o.expected_date).isBefore(moment());
                  return (
                    <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>{o.order_number}</td>
                      <td className="px-4 py-2.5 text-sm">{o.date ? moment(o.date).format('DD/MM/YYYY') : '—'}</td>
                      <td className="px-4 py-2.5 text-sm">{o.requester}</td>
                      <td className="px-4 py-2.5 font-medium text-sm">{o.product}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{o.client}</td>
                      <td className="px-4 py-2.5 text-sm">{o.client_order || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-sm">{fmt(o.volume_ordered)} L</td>
                      <td className="px-4 py-2.5 text-right font-bold text-sm text-green-600">{fmt(o.volume_produced)} L</td>
                      <td className="px-4 py-2.5 text-right font-bold text-sm text-amber-600">{fmt(o.volume_pending)} L</td>
                      <td className="px-4 py-2.5 text-sm">
                        <span className={isLate ? 'text-red-600 font-medium' : ''}>
                          {isLate && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                          {o.expected_date ? moment(o.expected_date).format('DD/MM/YYYY') : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center"><StatusBadge status={o.status} /></td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openDetails(o)} className="p-1 rounded hover:bg-gray-100" title="Visualizar">
                            <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                          {!isReadOnly && <button onClick={() => openEdit(o)} className="p-1 rounded hover:bg-gray-100" title="Editar">
                            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>}
                          {!isReadOnly && <button onClick={() => setDeleteTarget(o)} className="p-1 rounded hover:bg-red-50" title="Excluir">
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
        <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-6 text-xs text-muted-foreground">
          <span>Total de pedidos: {orders.length}</span>
          <span>Pedidos em aberto: {openOrders.length}</span>
          <span>Volume pendente total: <strong>{fmt(totalPendingVol)} L</strong></span>
        </div>
      </div>

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar Pedido · ${editing.order_number}` : 'Novo Pedido de Produção'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">Data *</label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Solicitante *</label><Input value={form.requester} onChange={e => setForm({ ...form, requester: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Produto *</label>
                <Select value={form.product} onValueChange={handleProductChange}>
                  <SelectTrigger><SelectValue placeholder="Selecione um produto..." /></SelectTrigger>
                  <SelectContent>
                    {recipes.map(r => <SelectItem key={r.id} value={r.product_name}>{r.product_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><label className="text-xs font-medium text-muted-foreground">Cliente</label><Input value={form.client} readOnly className="bg-gray-50" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">Pedido do Cliente</label><Input value={form.client_order} onChange={e => setForm({ ...form, client_order: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Volume (L) *</label><Input type="number" value={form.volume_ordered} onChange={e => setForm({ ...form, volume_ordered: e.target.value })} /></div>
            </div>

            <div><label className="text-xs font-medium text-muted-foreground">Data Prevista para Atendimento *</label><Input type="date" value={form.expected_date} onChange={e => setForm({ ...form, expected_date: e.target.value })} /></div>
            <div><label className="text-xs font-medium text-muted-foreground">Observação</label><textarea className="w-full border rounded-md px-3 py-2 text-sm" rows={2} value={form.observations || ''} onChange={e => setForm({ ...form, observations: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={save} style={{ background: '#2575D1' }} className="text-white">
              {editing ? 'Salvar Alterações' : 'Registrar Pedido'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order Details Dialog */}
      <OrderDetailsDialog open={showDetails} onOpenChange={setShowDetails} order={detailOrder} productions={productions} />

      {/* Delete Confirmation */}
      <ConfirmDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Excluir Pedido"
        message={`Tem certeza que deseja excluir o pedido ${deleteTarget?.order_number}? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        confirmColor="#DC2626"
        onConfirm={confirmDelete} />
    </div>
  );
}
