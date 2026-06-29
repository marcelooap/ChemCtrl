import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { Plus, Cylinder, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';

const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const CLIENT_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
];

function getClientColor(client) {
  if (!client) return '#6B7280';
  let hash = 0;
  for (let i = 0; i < client.length; i++) {
    hash = client.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CLIENT_COLORS[Math.abs(hash) % CLIENT_COLORS.length];
}

function getProductColor(product) {
  if (!product) return null;
  const p = product.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (p.includes('sisbrax') && p.includes('ace') && p.includes('75')) return '#86EFAC'; // verde claro
  if (p.includes('acido') && p.includes('acet') && p.includes('glacial')) return '#15803D'; // verde escuro
  return null;
}

const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export default function Tankagem() {
  const { data: tanks, loading, reload: load } = useRealtimeEntity('Tank', () => base44.entities.Tank.list('-created_date', 500));
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500));
  const { data: stockEntries } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 500));
  const { data: containers } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState({ name: '', client: '' });
  const { toast } = useToast();

  const clientOptions = useMemo(() => {
    const clients = new Map();
    recipes.forEach(r => { if (r.client && !clients.has(r.client)) clients.set(r.client, true); });
    tanks.forEach(t => { if (t.client && !clients.has(t.client)) clients.set(t.client, true); });
    stockEntries.forEach(s => { if (s.client && !clients.has(s.client)) clients.set(s.client, true); });
    return Array.from(clients.keys());
  }, [recipes, tanks, stockEntries]);

  const tanksWithData = useMemo(() => {
    return tanks.map(tank => {
      // Check if there's a vasilhame (container) of type "Tankagem" assigned to this tanka.
      // If so, the container takes precedence — only its volume/product is shown,
      // and the MP stock for this tanka should have been zeroed out.
      const tankContainers = containers.filter(c => {
        const isTank = (c.type || '').toLowerCase().includes('tank');
        return isTank && c.container_number === tank.name && c.status === 'No Pátio';
      });

      if (tankContainers.length > 0) {
        let volume = 0;
        let latestLot = tank.lot || '';
        let latestDate = 0;
        let latestProduct = tank.product || '';
        const products = new Set();

        tankContainers.forEach(c => {
          if (c.volume) volume += c.volume;
          if (c.product) products.add(c.product);
          const d = new Date(c.created_date || 0).getTime();
          if (d > latestDate) { latestDate = d; latestLot = c.lot || latestLot; latestProduct = c.product || latestProduct; }
        });

        return { ...tank, current_volume: volume, computed_lot: latestLot, computed_products: Array.from(products), latest_product: latestProduct };
      }

      // No container — use MP stock entries
      let volume = 0;
      let latestLot = tank.lot || '';
      let latestDate = 0;
      const products = new Set();
      let latestProduct = tank.product || '';

      stockEntries.forEach(s => {
        if (!s.tank_storage) return;
        const entries = parseArr(s.tank_entries);
        if (entries.length) {
          entries.forEach(te => {
            if (te.tank_name === tank.name && te.volume) {
              volume += te.volume;
              if (s.mp_name) products.add(s.mp_name);
              const d = new Date(s.created_date || s.entry_date || 0).getTime();
              if (d > latestDate) { latestDate = d; latestLot = s.lot || latestLot; latestProduct = s.mp_name || latestProduct; }
            }
          });
        }
        if (!entries.length && s.tank_name === tank.name && s.tank_volume) {
          volume += s.tank_volume;
          if (s.mp_name) products.add(s.mp_name);
          const d = new Date(s.created_date || s.entry_date || 0).getTime();
          if (d > latestDate) { latestDate = d; latestLot = s.lot || latestLot; latestProduct = s.mp_name || latestProduct; }
        }
      });

      return { ...tank, current_volume: volume, computed_lot: latestLot, computed_products: Array.from(products), latest_product: latestProduct };
    });
  }, [tanks, stockEntries, containers]);

  const tanksByClient = useMemo(() => {
    const groups = {};
    tanksWithData.forEach(t => {
      const client = t.client || 'Sem cliente';
      if (!groups[client]) groups[client] = [];
      groups[client].push(t);
    });
    return groups;
  }, [tanksWithData]);

  const totalVolume = tanksWithData.reduce((s, t) => s + (t.current_volume || 0), 0);
  const totalCapacity = tanksWithData.reduce((s, t) => s + (t.capacity || 26000), 0);

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', client: '' });
    setShowForm(true);
  };

  const openEdit = (t) => {
    setEditing(t);
    setForm({ name: t.name || '', client: t.client || '' });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name || !form.client) {
      toast({ title: 'Preencha o nome da Tanka e o cliente', variant: 'destructive' });
      return;
    }
    const data = {
      name: form.name,
      client: form.client,
    };
    if (editing) {
      await base44.entities.Tank.update(editing.id, data);
    } else {
      await base44.entities.Tank.create(data);
    }
    setShowForm(false);
    load();
    toast({ title: editing ? 'Tanka atualizada' : 'Tanka cadastrada' });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await base44.entities.Tank.delete(deleteTarget.id);
    setDeleteTarget(null);
    load();
    toast({ title: 'Tanka excluída' });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#1A1A2E' }}>🛢 Tankagem</h1>
          <p className="text-sm text-muted-foreground">{tanks.length} tanka(s) · {fmt(totalVolume)} L em uso de {fmt(totalCapacity)} L</p>
        </div>
        <Button onClick={openNew} style={{ background: '#2575D1' }} className="text-white">
          <Plus className="w-4 h-4 mr-2" /> Cadastrar Tanka
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" />
        </div>
      ) : tanks.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
          <Cylinder className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-lg font-medium text-muted-foreground">Nenhuma tanka cadastrada</p>
          <p className="text-sm text-muted-foreground mt-1">Clique em "Cadastrar Tanka" para começar.</p>
        </div>
      ) : (
        <>
          {/* Silo View — grouped by client */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
            <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-4">Visão Geral — Silos por Cliente</h2>
            {Object.entries(tanksByClient).map(([client, clientTanks]) => {
              const clientColor = getClientColor(client);
              return (
                <div key={client} className="mb-6 last:mb-0">
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b" style={{ borderColor: clientColor + '33' }}>
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: clientColor }} />
                    <h3 className="text-sm font-bold" style={{ color: clientColor }}>{client}</h3>
                    <span className="text-xs text-muted-foreground">{clientTanks.length} tanka(s) · {fmt(clientTanks.reduce((s, t) => s + (t.current_volume || 0), 0))} L</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
                    {clientTanks.map(tank => {
                      const fillPercent = Math.min(100, ((tank.current_volume || 0) / (tank.capacity || 26000)) * 100);
                      const productColor = getProductColor(tank.latest_product) || clientColor;
                      return (
                        <div key={tank.id} className="flex flex-col items-center">
                          <div className="relative" style={{ width: 100 }}>
                            <div className="h-7 rounded-t-full border-2 border-b-0" style={{ borderColor: '#cbd5e1', background: '#f1f5f9' }} />
                            <div className="relative h-52 border-2 border-t-0 overflow-hidden" style={{ borderColor: '#cbd5e1', background: '#f8fafc' }}>
                              <div className="absolute bottom-0 left-0 right-0 transition-all duration-700" style={{ height: `${fillPercent}%`, backgroundColor: productColor, opacity: 0.85 }} />
                              {fillPercent > 3 && <div className="absolute left-0 right-0 border-t-2 border-white/40" style={{ bottom: `${fillPercent}%` }} />}
                              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <p className="text-sm font-bold text-center px-1" style={{ color: fillPercent > 15 ? 'white' : '#1A1A2E', textShadow: fillPercent > 15 ? '0 1px 3px rgba(0,0,0,0.4)' : 'none' }}>{fmt(tank.current_volume)} L</p>
                                <p className="text-xs" style={{ color: fillPercent > 15 ? 'rgba(255,255,255,0.9)' : '#9CA3AF' }}>{fillPercent.toFixed(1)}%</p>
                              </div>
                            </div>
                            <div className="h-3 rounded-b-full border-2 border-t-0" style={{ borderColor: '#cbd5e1', background: '#f1f5f9' }} />
                          </div>
                          <div className="text-center mt-2 w-full">
                            <p className="font-bold text-sm" style={{ color: '#1A1A2E' }}>{tank.name}</p>
                             <p className="text-xs font-medium truncate" style={{ color: '#1A1A2E' }}>{tank.latest_product || '—'}</p>
                            {tank.computed_lot && <p className="text-xs text-muted-foreground">Lote: {tank.computed_lot}</p>}
                            <p className="text-xs text-muted-foreground mt-0.5">Cap: {fmt(tank.capacity)} L</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detailed Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full chemctrl-table">
                <thead><tr className="border-b border-gray-50 bg-gray-50/50">
                  <th className="px-4 py-3 text-left">Tanka</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Produto(s)</th>
                  <th className="px-4 py-3 text-left">Lote</th>
                  <th className="px-4 py-3 text-right">Volume Atual (L)</th>
                  <th className="px-4 py-3 text-right">Capacidade (L)</th>
                  <th className="px-4 py-3 text-center">Ocupação</th>
                  <th className="px-4 py-3 text-center">Ações</th>
                </tr></thead>
                <tbody>
                  {tanksWithData.map(tank => {
                    const fillPercent = Math.min(100, ((tank.current_volume || 0) / (tank.capacity || 26000)) * 100);
                    const clientColor = getClientColor(tank.client);
                    return (
                      <tr key={tank.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-bold text-sm" style={{ color: '#1A1A2E' }}>{tank.name}</td>
                        <td className="px-4 py-3 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: clientColor }} />
                            {tank.client || '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: '#1A1A2E' }}>{tank.latest_product || '—'}</td>
                        <td className="px-4 py-3 text-sm font-mono">{tank.computed_lot || '—'}</td>
                        <td className="px-4 py-3 text-right text-sm font-bold" style={{ color: '#1A1A2E' }}>{fmt(tank.current_volume)}</td>
                        <td className="px-4 py-3 text-right text-sm text-muted-foreground">{fmt(tank.capacity)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden min-w-[60px]">
                              <div className="h-full rounded-full transition-all" style={{ width: `${fillPercent}%`, backgroundColor: clientColor }} />
                            </div>
                            <span className="text-xs font-medium text-muted-foreground w-10 text-right">{fillPercent.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => openEdit(tank)} className="p-1.5 rounded hover:bg-gray-100"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button>
                            <button onClick={() => setDeleteTarget(tank)} className="p-1.5 rounded hover:bg-gray-100"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Register/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Editar Tanka' : 'Cadastrar Tanka'}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Nome da Tanka *</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: TANKA 01" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Cliente *</label>
              <Select value={form.client} onValueChange={v => setForm({ ...form, client: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
                <SelectContent>
                  {clientOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={save} style={{ background: '#2575D1' }} className="text-white">{editing ? 'Salvar' : 'Cadastrar'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Excluir Tanka"
        message={`Tem certeza que deseja excluir a tanka "${deleteTarget?.name}"?\n\nEsta ação não pode ser desfeita.`}
        onConfirm={confirmDelete}
        confirmLabel="Sim, excluir"
        confirmColor="#DC2626"
      />
    </div>
  );
}
