import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@industrializacao/api/base44Client';
import { useRealtimeEntity } from '@industrializacao/hooks/useRealtimeEntity';
import { Plus, Cylinder, Eye, Search, Loader2 } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/components/ui/select';
import { useToast } from '@shared/components/ui/use-toast';
import ConfirmDialog from '@industrializacao/components/ConfirmDialog';
import TankViewDialog from '@industrializacao/components/vasilhames/TankViewDialog';
import { fmtNumber } from '@/i18n/formatters';

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
  if (p.includes('sisbrax') && p.includes('ace') && p.includes('75')) return '#86EFAC';
  if (p.includes('acido') && p.includes('acet') && p.includes('glacial')) return '#15803D';
  return null;
}

export default function Tankagem() {
  const { t, i18n } = useTranslation();
  const { data: tanks, loading, reload: load } = useRealtimeEntity('Tank', () => base44.entities.Tank.list('-created_date', 500));
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500));
  const { data: stockEntries } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 500));
  const { data: containers } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [viewTank, setViewTank] = useState(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: '', client: '' });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const na = t('common.notAvailable');

  const fmt = useCallback((n) => fmtNumber(n || 0, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, i18n.language), [i18n.language]);

  const clientOptions = useMemo(() => {
    const clients = new Map();
    recipes.forEach(r => { if (r.client && !clients.has(r.client)) clients.set(r.client, true); });
    tanks.forEach(item => { if (item.client && !clients.has(item.client)) clients.set(item.client, true); });
    stockEntries.forEach(s => { if (s.client && !clients.has(s.client)) clients.set(s.client, true); });
    return Array.from(clients.keys());
  }, [recipes, tanks, stockEntries]);

  const tanksWithData = useMemo(() => {
    return tanks.map(tank => {
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

  const filteredTanks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tanksWithData;
    return tanksWithData.filter((tank) => {
      const haystack = [
        tank.name,
        tank.client,
        tank.latest_product,
        tank.computed_lot,
        ...(tank.computed_products || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [tanksWithData, search]);

  const tanksByClient = useMemo(() => {
    const groups = {};
    filteredTanks.forEach(item => {
      const client = item.client || t('containers.tankagePage.noClient');
      if (!groups[client]) groups[client] = [];
      groups[client].push(item);
    });
    return groups;
  }, [filteredTanks, t]);

  const totalVolume = filteredTanks.reduce((s, item) => s + (item.current_volume || 0), 0);
  const totalCapacity = filteredTanks.reduce((s, item) => s + (item.capacity || 26000), 0);

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', client: '' });
    setShowForm(true);
  };

  const openEdit = (item) => {
    setViewTank(null);
    setEditing(item);
    setForm({ name: item.name || '', client: item.client || '' });
    setShowForm(true);
  };

  const openDelete = (item) => {
    setViewTank(null);
    setDeleteTarget(item);
  };

  const save = async () => {
    if (!form.name || !form.client) {
      toast({ title: t('containers.tankagePage.form.required'), variant: 'destructive' });
      return;
    }
    const data = { name: form.name, client: form.client };
    setSaving(true);
    try {
      if (editing) {
        await base44.entities.Tank.update(editing.id, data);
      } else {
        await base44.entities.Tank.create(data);
      }
      setShowForm(false);
      load();
      toast({ title: editing ? t('containers.tankagePage.messages.updated') : t('containers.tankagePage.messages.created') });
    } catch (err) {
      toast({ title: t('errors.saveFailed'), description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await base44.entities.Tank.delete(deleteTarget.id);
    setDeleteTarget(null);
    load();
    toast({ title: t('containers.tankagePage.messages.deleted') });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">🛢 {t('containers.tankage.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('containers.tankagePage.subtitle', {
              count: filteredTanks.length,
              used: fmt(totalVolume),
              capacity: fmt(totalCapacity),
            })}
          </p>
        </div>
        <Button onClick={openNew} style={{ background: '#2575D1' }} className="text-white">
          <Plus className="w-4 h-4 mr-2" /> {t('containers.tankagePage.registerTank')}
        </Button>
      </div>

      {tanks.length > 0 && (
        <div className="shrink-0 relative mb-4 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t('containers.tankagePage.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white"
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" />
          </div>
        ) : tanks.length === 0 ? (
          <div className="bg-card rounded-xl shadow-sm border border-border p-8 text-center">
            <Cylinder className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-lg font-medium text-muted-foreground">{t('containers.tankagePage.emptyTitle')}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('containers.tankagePage.emptyHint')}</p>
          </div>
        ) : filteredTanks.length === 0 ? (
          <div className="bg-card rounded-xl shadow-sm border border-border p-8 text-center">
            <Search className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-lg font-medium text-muted-foreground">{t('containers.tankagePage.emptyFilterTitle')}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('containers.tankagePage.emptyFilterHint')}</p>
          </div>
        ) : (
          <div className="bg-card rounded-xl shadow-sm border border-border p-6">
            <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-4">{t('containers.tankagePage.overviewTitle')}</h2>
            {Object.entries(tanksByClient).map(([client, clientTanks]) => {
              const clientColor = getClientColor(client);
              return (
                <div key={client} className="mb-6 last:mb-0">
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b" style={{ borderColor: clientColor + '33' }}>
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: clientColor }} />
                    <h3 className="text-sm font-bold" style={{ color: clientColor }}>{client}</h3>
                    <span className="text-xs text-muted-foreground">{t('containers.tankagePage.tankCount', { count: clientTanks.length, volume: fmt(clientTanks.reduce((s, item) => s + (item.current_volume || 0), 0)) })}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
                    {clientTanks.map(tank => {
                      const fillPercent = Math.min(100, ((tank.current_volume || 0) / (tank.capacity || 26000)) * 100);
                      const productColor = getProductColor(tank.latest_product) || clientColor;
                      return (
                        <div key={tank.id} className="flex flex-col items-center group">
                          <div className="relative" style={{ width: 100 }}>
                            <div className="h-7 rounded-t-full border-2 border-b-0 border-border bg-muted" />
                            <div className="relative h-52 border-2 border-t-0 overflow-hidden border-border bg-muted/50">
                              <div className="absolute bottom-0 left-0 right-0 transition-all duration-700" style={{ height: `${fillPercent}%`, backgroundColor: productColor, opacity: 0.85 }} />
                              {fillPercent > 3 && <div className="absolute left-0 right-0 border-t-2 border-white/40" style={{ bottom: `${fillPercent}%` }} />}
                              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <p className={`text-sm font-bold text-center px-1 ${fillPercent > 15 ? 'text-white drop-shadow' : 'text-foreground'}`}>{fmt(tank.current_volume)} L</p>
                                <p className={`text-xs ${fillPercent > 15 ? 'text-white/90' : 'text-muted-foreground'}`}>{fillPercent.toFixed(1)}%</p>
                              </div>
                            </div>
                            <div className="h-3 rounded-b-full border-2 border-t-0 border-border bg-muted" />
                          </div>
                          <div className="text-center mt-2 w-full">
                            <p className="font-bold text-sm">{tank.name}</p>
                            <p className="text-xs font-medium truncate">{tank.latest_product || na}</p>
                            {tank.computed_lot && <p className="text-xs text-muted-foreground">{t('quality.fields.lot')}: {tank.computed_lot}</p>}
                            <p className="text-xs text-muted-foreground mt-0.5">{t('containers.tankagePage.capacityShort')}: {fmt(tank.capacity)} L</p>
                            <button
                              type="button"
                              onClick={() => setViewTank(tank)}
                              className="mt-2 inline-flex items-center justify-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md border border-border hover:bg-muted transition-colors"
                              title={t('containers.tankagePage.viewTank')}
                              aria-label={t('containers.tankagePage.viewTank')}
                            >
                              <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                              {t('containers.tankagePage.viewTank')}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? t('containers.tankagePage.form.editTitle') : t('containers.tankagePage.form.registerTitle')}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('containers.tankagePage.form.nameLabel')}</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t('containers.tankagePage.form.namePlaceholder')} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('containers.fields.client')} *</label>
              <Select value={form.client} onValueChange={v => setForm({ ...form, client: v })}>
                <SelectTrigger><SelectValue placeholder={t('containers.tankagePage.form.clientPlaceholder')} /></SelectTrigger>
                <SelectContent>
                  {clientOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>{t('buttons.cancel')}</Button>
            <Button onClick={save} disabled={saving} style={{ background: '#2575D1' }} className="text-white">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('common.saving')}</> : editing ? t('buttons.save') : t('buttons.register')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <TankViewDialog
        tank={viewTank}
        open={!!viewTank}
        onOpenChange={(open) => { if (!open) setViewTank(null); }}
        onEdit={openEdit}
        onDelete={openDelete}
        fmt={fmt}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t('containers.tankagePage.deleteTitle')}
        message={t('containers.tankagePage.deleteMessage', { name: deleteTarget?.name })}
        onConfirm={confirmDelete}
        confirmLabel={t('containers.tankagePage.deleteConfirm')}
        confirmColor="#DC2626"
      />
    </div>
  );
}
