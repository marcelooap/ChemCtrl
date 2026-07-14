import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Eye, Pencil, Trash2, ArrowLeftRight, Loader2 } from 'lucide-react';
import MovimentacaoEstoqueDialog from '@/components/estoque/MovimentacaoEstoqueDialog';
import { exportEstoqueMPToExcel } from '@/lib/exportEstoqueMP';
import { Download } from 'lucide-react';
import RawMaterialViewDialog from '@/components/estoque/RawMaterialViewDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Combobox from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import moment from 'moment';
import { fmtNumber, fmtCurrency, fmtMass } from '@/i18n/formatters';
import { calcPackagingQty } from '@/lib/stockUtils';
import { usePermissions } from '@/lib/rbac/PermissionProvider';

const emptyItem = { mp_name: '', mp_code: '', client: '', lot: '', supplier: '', unit: 'kg', unit_price: '', entry_date: new Date().toISOString().split('T')[0], manufacture_date: '', expiry_date: '', initial_stock: '', current_stock: '', density: '', observations: '', tank_storage: false, tank_entries: [], packaging_type: '', packaging_capacity: '', packaging_quantity: 0 };

const parseArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);

export default function Estoque() {
  const { t } = useTranslation();
  const { user, isReadOnly } = useOutletContext();
  const { hasPermission } = usePermissions();
  const canCreate = !isReadOnly && hasPermission('raw_material_stock.create');
  const canEdit = !isReadOnly && hasPermission('raw_material_stock.edit');
  const canDelete = !isReadOnly && hasPermission('raw_material_stock.delete');
  const parseTankEntries = (i) => ({ ...i, tank_entries: parseArr(i.tank_entries) });
  const parseRawMaterials = (r) => ({ ...r, raw_materials: parseArr(r.raw_materials) });
  const { data: items, loading, reload: load } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 500), [], parseTankEntries);
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500), [], parseRawMaterials);
  const { data: tanks } = useRealtimeEntity('Tank', () => base44.entities.Tank.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('todas');
  const [clientFilter, setClientFilter] = useState('todos');
  const [showForm, setShowForm] = useState(false);
  const [showView, setShowView] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [form, setForm] = useState(emptyItem);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showMovimentacao, setShowMovimentacao] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const mpOptions = useMemo(() => {
    const map = new Map();
    recipes.forEach(r => {
      (r.raw_materials || []).forEach(mp => {
        const key = (mp.mp_code || mp.mp_name || '').trim();
        if (key && !map.has(key)) {
          map.set(key, { mp_code: mp.mp_code || '', mp_name: mp.mp_name || '', client: r.client || '', density: mp.mp_density || null });
        }
      });
    });
    return Array.from(map.values()).map(mp => ({
      value: mp.mp_code || mp.mp_name,
      label: `${mp.mp_code}${mp.mp_code ? ' — ' : ''}${mp.mp_name}`,
      item: mp,
    }));
  }, [recipes]);

  const handleMPSelect = (selected) => {
    if (selected) {
      setForm(prev => ({
        ...prev,
        mp_name: selected.mp_name || prev.mp_name,
        mp_code: selected.mp_code || prev.mp_code,
        client: selected.client || prev.client,
        density: selected.density || prev.density,
      }));
    }
  };

  const clientOptions = useMemo(() => {
    const set = new Set();
    items.forEach(i => { if (i.client && i.client.trim()) set.add(i.client.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [items]);

  const filtered = items.filter(i => {
    const q = search.toLowerCase();
    const matchesSearch = !q || [i.mp_name, i.mp_code, i.client, i.lot, i.supplier].some(v => (v || '').toLowerCase().includes(q));
    const hasStock = (i.current_stock || 0) > 0;
    const matchesFilter = stockFilter === 'todas' || (stockFilter === 'com_saldo' && hasStock) || (stockFilter === 'sem_saldo' && !hasStock);
    const matchesClient = clientFilter === 'todos' || (i.client || '') === clientFilter;
    return matchesSearch && matchesFilter && matchesClient;
  });

  const totalQty = filtered.reduce((s, i) => s + (i.current_stock || 0), 0);
  const totalCost = filtered.reduce((s, i) => s + (i.current_stock || 0) * (i.unit_price || 0), 0);
  const totalPackages = filtered.reduce((s, i) => s + calcPackagingQty(i.current_stock, i.packaging_capacity), 0);

  const openNew = () => { setEditing(null); setForm({ ...emptyItem }); setShowForm(true); };
  const openEdit = (item) => { setEditing(item); setForm({ ...item, tank_entries: item.tank_entries || (item.tank_name ? [{ tank_name: item.tank_name, volume: item.tank_volume, mass: item.tank_mass }] : []) }); setShowForm(true); };
  const openView = (item) => { setViewing(item); setShowView(true); };

  const addTankEntry = () => setForm(prev => ({ ...prev, tank_entries: [...(prev.tank_entries || []), { tank_name: '', volume: '', mass: 0 }] }));
  const updateTankEntry = (idx, patch) => setForm(prev => ({ ...prev, tank_entries: (prev.tank_entries || []).map((e, i) => i === idx ? { ...e, ...patch } : e) }));
  const removeTankEntry = (idx) => setForm(prev => ({ ...prev, tank_entries: (prev.tank_entries || []).filter((_, i) => i !== idx) }));

  // Ao editar, o cálculo de qtd. de embalagens usa o saldo atual;
  // ao criar, usa o estoque inicial (que também é o saldo atual no momento).
  const stockForPackaging = () => editing ? (parseFloat(form.current_stock) || 0) : (parseFloat(form.initial_stock) || 0);

  const save = async () => {
    const initialStock = parseFloat(form.initial_stock) || 0;
    const packagingCapacity = parseFloat(form.packaging_capacity) || 0;
    const data = { ...form, unit_price: parseFloat(form.unit_price) || 0, initial_stock: initialStock, current_stock: editing ? (parseFloat(form.current_stock) || 0) : initialStock, density: parseFloat(form.density) || 0, entry_date: form.entry_date || null, packaging_capacity: packagingCapacity, packaging_quantity: calcPackagingQty(stockForPackaging(), packagingCapacity), tank_entries: form.tank_storage ? (form.tank_entries || []).filter(te => te.tank_name).map(te => ({ tank_name: te.tank_name, volume: parseFloat(te.volume) || 0, mass: te.mass || 0 })) : [] };
    if (!data.mp_name) { toast({ title: t('rawMaterialStock.messages.mpRequired'), variant: 'destructive' }); return; }
    setSaving(true);
    try {
      if (editing) {
        await base44.entities.RawMaterialStock.update(editing.id, data);
        // Sincronizar lote alterado em todas as Produções que utilizam esta MP
        const newLot = (form.lot || '').trim();
        const oldLot = (editing.lot || '').trim();
        if (newLot !== oldLot) {
          try {
            const allProductions = await base44.entities.Production.list('-created_date', 500);
            for (const prod of allProductions) {
              const mps = parseArr(prod.raw_materials_used);
              let changed = false;
              for (const mp of mps) {
                if (mp.stock_id === editing.id && (mp.lot || '') !== newLot) {
                  mp.lot = newLot;
                  changed = true;
                }
              }
              if (changed) {
                await base44.entities.Production.update(prod.id, { raw_materials_used: mps });
              }
            }
          } catch (_e) {}
        }
      } else {
        const count = items.length + 1;
        data.entry_id = `MP${String(count).padStart(3, '0')}`;
        await base44.entities.RawMaterialStock.create(data);
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

  const remove = (item) => { setDeleteTarget(item); };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await base44.entities.RawMaterialStock.delete(deleteTarget.id);
    setDeleteTarget(null);
    load();
    toast({ title: t('success.deleted') });
  };

  const handleExportExcel = async () => {
    if (!filtered.length) { toast({ title: t('rawMaterialStock.messages.noItemsExport'), variant: 'destructive' }); return; }
    setExporting(true);
    try {
      await exportEstoqueMPToExcel(filtered);
      toast({ title: t('success.exported') });
    } catch (err) {
      toast({ title: t('errors.exportFailed'), description: err.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const getStatus = (item) => {
    if (!item.expiry_date) return null;
    if (moment(item.expiry_date).isBefore(moment())) return 'expired';
    return 'valid';
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Fixed Header */}
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">⚗ {t('rawMaterialStock.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('rawMaterialStock.subtitle', { count: items.length })}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleExportExcel} disabled={exporting} className="bg-green-600 text-white hover:bg-green-700">
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />} {t('rawMaterialStock.exportExcel')}
          </Button>
          {canEdit && (
            <Button onClick={() => setShowMovimentacao(true)} variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50">
              <ArrowLeftRight className="w-4 h-4 mr-2" /> {t('rawMaterialStock.movement')}
            </Button>
          )}
          {canCreate && (
            <Button onClick={openNew} style={{ background: '#2575D1' }} className="text-white hover:opacity-90">
              <Plus className="w-4 h-4 mr-2" /> {t('rawMaterialStock.newItem')}
            </Button>
          )}
        </div>
      </div>

      {/* Card: fixed search, scrollable table, fixed footer */}
      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="shrink-0 p-4 border-b border-border flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder={t('rawMaterialStock.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={stockFilter} onValueChange={setStockFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">{t('rawMaterialStock.filters.all')}</SelectItem>
              <SelectItem value="com_saldo">{t('rawMaterialStock.filters.withBalance')}</SelectItem>
              <SelectItem value="sem_saldo">{t('rawMaterialStock.filters.withoutBalance')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder={t('common.client')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t('rawMaterialStock.filters.allClients')}</SelectItem>
              {clientOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Scrollable Table */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
          ) : (
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.table.reg')}</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.table.code')}</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.table.name')}</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.table.client')}</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.table.lot')}</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold">{t('rawMaterialStock.table.currentBalance')}</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold">{t('rawMaterialStock.table.unitPrice')}</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold">{t('rawMaterialStock.table.totalCost')}</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold">{t('rawMaterialStock.table.status')}</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold">{t('rawMaterialStock.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, idx) => {
                  const zeroStock = (item.current_stock || 0) === 0;
                  const status = getStatus(item);
                  return (
                    <tr key={item.id} className="border-b border-border hover:bg-accent/30" style={{ opacity: zeroStock ? 0.45 : 1 }}>
                       <td className="px-4 py-2.5 text-sm font-medium text-primary">{item.entry_id || `#${idx + 1}`}</td>
                       <td className="px-4 py-2.5 font-mono text-sm text-muted-foreground">{item.mp_code}</td>
                       <td className="px-4 py-2.5 font-medium text-sm text-foreground">{item.mp_name}</td>
                       <td className="px-4 py-2.5 text-sm text-muted-foreground">{item.client || t('common.notAvailable')}</td>
                       <td className="px-4 py-2.5 font-mono text-sm text-muted-foreground">{item.lot || t('common.notAvailable')}</td>
                       <td className="px-4 py-2.5 text-right text-sm text-foreground">
                         <span className="font-medium">{fmtNumber(item.current_stock)}</span>{' '}
                         <span className="font-medium">{item.unit}</span>
                       </td>
                       <td className="px-4 py-2.5 text-right text-sm text-foreground">{(item.unit_price || 0).toFixed(4)}</td>
                       <td className="px-4 py-2.5 text-right text-sm font-semibold text-green-600 dark:text-green-400">{fmtCurrency((item.current_stock || 0) * (item.unit_price || 0))}</td>
                       <td className="px-4 py-2.5 text-center">
                         {status === null ? (
                           <span className="text-sm text-muted-foreground">{t('common.notAvailable')}</span>
                         ) : status === 'expired' ? (
                           <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700">{t('rawMaterialStock.status.expired')}</span>
                         ) : (
                           <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-600 text-white dark:bg-green-700">{t('rawMaterialStock.status.valid')}</span>
                         )}
                       </td>
                       <td className="px-4 py-2.5 text-center">
                         <div className="flex items-center justify-center gap-1">
                           <button onClick={() => openView(item)} className="p-1.5 rounded hover:bg-accent"><Eye className="w-4 h-4 text-muted-foreground hover:text-foreground" /></button>
                           {canEdit && <button onClick={() => openEdit(item)} className="p-1.5 rounded hover:bg-accent"><Pencil className="w-4 h-4 text-muted-foreground hover:text-foreground" /></button>}
                           {canDelete && <button onClick={() => remove(item)} className="p-1.5 rounded hover:bg-accent"><Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-400" /></button>}
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
          <span>{t('rawMaterialStock.footer.itemsShown')}: {filtered.length}</span>
          <span>{t('rawMaterialStock.footer.totalStock')}: <strong>{fmtNumber(totalQty)}</strong> {t('rawMaterialStock.footer.mixedUnits')}</span>
          <span>{t('rawMaterialStock.footer.packagingQty')}: <strong>{fmtNumber(totalPackages)}</strong></span>
          <span>{t('rawMaterialStock.footer.totalCost')}: <strong style={{ color: '#16a34a' }}>{fmtCurrency(totalCost)}</strong></span>
        </div>
      </div>

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t('rawMaterialStock.editItem', { id: editing.entry_id || '' }) : t('rawMaterialStock.newItemReg', { reg: String(items.length + 1).padStart(3, '0') })}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div><label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.entryDate')} *</label><Input type="date" value={form.entry_date} onChange={e => setForm({ ...form, entry_date: e.target.value })} /></div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.rawMaterial')} * <span className="text-muted-foreground/60">{t('rawMaterialStock.form.selectOrType')}</span></label>
              <Combobox value={form.mp_name} onValueChange={v => setForm({ ...form, mp_name: v })} options={mpOptions} placeholder={t('rawMaterialStock.form.mpPlaceholder')} onSelect={handleMPSelect} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.code')}</label><Input value={form.mp_code} onChange={e => setForm({ ...form, mp_code: e.target.value })} placeholder={t('rawMaterialStock.form.autoFill')} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.name')}</label><Input value={form.mp_name} onChange={e => setForm({ ...form, mp_name: e.target.value })} placeholder={t('rawMaterialStock.form.autoFill')} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.client')}</label><Input value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} placeholder={t('rawMaterialStock.form.autoFill')} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.lot')}</label><Input value={form.lot} onChange={e => setForm({ ...form, lot: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.supplier')}</label><Input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.unitPrice')}</label><Input type="number" step="0.0001" value={form.unit_price} onChange={e => setForm({ ...form, unit_price: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.manufactureDate')}</label><Input type="date" value={form.manufacture_date} onChange={e => setForm({ ...form, manufacture_date: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.expiryDate')}</label><Input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.initialStock')} *</label><Input type="number" value={form.initial_stock} onChange={e => setForm({ ...form, initial_stock: e.target.value })} /></div>
              {editing && (
                <div><label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.currentBalance')}</label><Input type="number" value={form.current_stock} onChange={e => setForm({ ...form, current_stock: e.target.value })} /></div>
              )}
              {!editing && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.unit')} *</label>
                  <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kg">{t('common.units.kg')}</SelectItem>
                      <SelectItem value="L">{t('common.units.L')}</SelectItem>
                      <SelectItem value="gal">gal</SelectItem>
                      <SelectItem value="lb">lb</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {form.density > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.density')}</label>
                <Input value={`${form.density} g/mL`} readOnly className="bg-muted/50 text-blue-700 font-semibold" />
              </div>
            )}
            <div className="border-t pt-3 mt-1">
              <p className="text-xs font-semibold text-muted-foreground mb-2">{t('rawMaterialStock.form.packaging')}</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.packagingType')}</label>
                  <Select value={form.packaging_type || ''} onValueChange={v => setForm({ ...form, packaging_type: v })}>
                    <SelectTrigger><SelectValue placeholder={t('rawMaterialStock.form.selectOption')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="One Way (IBC)">{t('rawMaterialStock.packagingTypes.oneWayIbc')}</SelectItem>
                      <SelectItem value="Bombona">{t('rawMaterialStock.packagingTypes.canister')}</SelectItem>
                      <SelectItem value="Tambor">{t('rawMaterialStock.packagingTypes.drum')}</SelectItem>
                      <SelectItem value="Sacaria">{t('rawMaterialStock.packagingTypes.bag')}</SelectItem>
                      <SelectItem value="Contentor">{t('rawMaterialStock.packagingTypes.container')}</SelectItem>
                      <SelectItem value="Tankagem">{t('rawMaterialStock.packagingTypes.tankage')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.capacity')}</label>
                  <Input type="number" step="0.001" value={form.packaging_capacity || ''} onChange={e => setForm({ ...form, packaging_capacity: e.target.value })} placeholder={t('rawMaterialStock.form.capacityPlaceholder')} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.packagingQty')}</label>
                  <Input value={calcPackagingQty(stockForPackaging(), form.packaging_capacity)} readOnly className="bg-muted/50 font-semibold" />
                </div>
              </div>
            </div>
            <div><label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.observations')}</label><textarea className="w-full border rounded-md px-3 py-2 text-sm" rows={2} value={form.observations || ''} onChange={e => setForm({ ...form, observations: e.target.value })} placeholder={t('rawMaterialStock.form.notesPlaceholder')} /></div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={form.tank_storage || false} onChange={e => setForm({ ...form, tank_storage: e.target.checked, tank_entries: e.target.checked ? (form.tank_entries && form.tank_entries.length > 0 ? form.tank_entries : [{ tank_name: '', volume: '', mass: 0 }]) : [] })} className="rounded" />
              <div>
                <p className="text-sm font-medium">{t('rawMaterialStock.form.tankStorage')}</p>
                <p className="text-xs text-muted-foreground">{t('rawMaterialStock.form.tankStorageHint')}</p>
              </div>
            </div>
            {form.tank_storage && (
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 space-y-3">
                {(form.tank_entries || []).map((entry, idx) => (
                  <div key={idx} className="grid grid-cols-2 gap-3 pb-3 border-b border-blue-100 last:border-0 last:pb-0">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.tank')} *</label>
                      <Select value={entry.tank_name || ''} onValueChange={v => updateTankEntry(idx, { tank_name: v })}>
                        <SelectTrigger><SelectValue placeholder={t('rawMaterialStock.form.selectTank')} /></SelectTrigger>
                        <SelectContent>
                          {tanks.map(tank => <SelectItem key={tank.id} value={tank.name}>{tank.name} — {tank.client}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.volume')}</label>
                      <Input type="number" step="0.001" value={entry.volume || ''} onChange={e => {
                        const vol = parseFloat(e.target.value) || 0;
                        const mass = Math.round((parseFloat(form.density) || 0) * vol);
                        updateTankEntry(idx, { volume: vol, mass });
                      }} />
                    </div>
                    <div className="col-span-2 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{t('rawMaterialStock.form.massCalc', { mass: fmtMass(entry.mass || 0), density: form.density || 0, volume: entry.volume || 0 })}</span>
                      <button type="button" onClick={() => removeTankEntry(idx)} className="text-red-500 hover:text-red-700 font-medium">{t('buttons.remove')}</button>
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addTankEntry} className="w-full border-blue-200 text-blue-600 hover:bg-blue-50">
                  <Plus className="w-4 h-4 mr-1" /> {t('rawMaterialStock.form.addTank')}
                </Button>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>{t('buttons.cancel')}</Button>
            <Button onClick={save} disabled={saving} style={{ background: '#2575D1' }} className="text-white">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('common.saving')}</> : editing ? t('rawMaterialStock.form.saveChanges') : t('buttons.register')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <RawMaterialViewDialog item={viewing} open={showView} onOpenChange={setShowView} />
      {/* Movimentação Dialog */}
      <MovimentacaoEstoqueDialog
        open={showMovimentacao}
        onOpenChange={setShowMovimentacao}
        stocks={items}
        onSuccess={load}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t('rawMaterialStock.deleteConfirm.title')}
        message={t('rawMaterialStock.deleteConfirm.message', { name: deleteTarget?.mp_name, lot: deleteTarget?.lot || t('common.notAvailable') })}
        onConfirm={confirmDelete}
        confirmLabel={t('rawMaterialStock.deleteConfirm.confirm')}
        confirmColor="#DC2626"
      />
    </div>
  );
}
