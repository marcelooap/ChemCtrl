import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@industrializacao/api/base44Client';
import { useRealtimeEntity } from '@industrializacao/hooks/useRealtimeEntity';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Plus, Search, Eye, Pencil, Trash2, ArrowLeftRight, Loader2, Printer, Download, Package, FileText } from 'lucide-react';
import MovimentacaoEstoqueDialog from '@industrializacao/components/estoque/MovimentacaoEstoqueDialog';
import MovimentacaoFiscalViewDialog from '@industrializacao/components/estoque/MovimentacaoFiscalViewDialog';
import { exportEstoqueMPToExcel } from '@industrializacao/lib/exportEstoqueMP';
import RawMaterialViewDialog from '@industrializacao/components/estoque/RawMaterialViewDialog';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import Combobox from '@shared/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/components/ui/select';
import { Switch } from '@shared/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { useToast } from '@shared/components/ui/use-toast';
import ConfirmDialog from '@industrializacao/components/ConfirmDialog';
import moment from 'moment';
import { fmtNumber, fmtCurrency, fmtMass, fmtDateTime } from '@/i18n/formatters';
import { translateStockDestination } from '@/i18n/domainMaps';
import { calcPackagingQty } from '@industrializacao/lib/stockUtils';
import { usePermissions } from '@industrializacao/lib/rbac/PermissionProvider';
import { useDebouncedValue } from '@industrializacao/hooks/useDebouncedValue';
import { ensureRawMaterialStockPublicToken } from '@industrializacao/lib/ensurePublicToken';
import { printRawMaterialLabel } from '@industrializacao/lib/labelprint';

const VIEW_TAB_CLASS =
  'gap-2 px-5 py-2.5 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md';

const DEST_COLORS = {
  'Perda em Processo': 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  'Retorno de MP Não Aplicada': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300',
};

const emptyItem = { mp_name: '', mp_code: '', client: '', lot: '', supplier: '', unit: 'kg', unit_price: '', entry_date: new Date().toISOString().split('T')[0], manufacture_date: '', expiry_date: '', initial_stock: '', current_stock: '', density: '', observations: '', tank_storage: false, tank_entries: [], packaging_type: '', packaging_capacity: '', packaging_quantity: 0, status_wms: false };

const parseArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);

/** Volume atual da tanka (mesma regra da tela Tankagem), opcionalmente excluindo um registro de MP. */
function computeTankCurrentVolume(tankName, stockEntries, containers, excludeStockId) {
  if (!tankName) return 0;

  const tankContainers = (containers || []).filter((c) => {
    const isTank = (c.type || '').toLowerCase().includes('tank');
    return isTank && c.container_number === tankName && c.status === 'No Pátio';
  });

  if (tankContainers.length > 0) {
    return tankContainers.reduce((sum, c) => sum + (c.volume || 0), 0);
  }

  let volume = 0;
  (stockEntries || []).forEach((s) => {
    if (excludeStockId && s.id === excludeStockId) return;
    if (!s.tank_storage) return;
    const entries = parseArr(s.tank_entries);
    if (entries.length) {
      entries.forEach((te) => {
        if (te.tank_name === tankName && te.volume) volume += te.volume;
      });
    } else if (s.tank_name === tankName && s.tank_volume) {
      volume += s.tank_volume;
    }
  });
  return volume;
}

const CONFERENCE_TOLERANCE = 0.01;

export default function Estoque() {
  const { t, i18n } = useTranslation();
  const { user, isReadOnly } = useOutletContext();
  const { hasPermission } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const canCreate = !isReadOnly && hasPermission('raw_material_stock.create');
  const canEdit = !isReadOnly && hasPermission('raw_material_stock.edit');
  const canDelete = !isReadOnly && hasPermission('raw_material_stock.delete');
  const parseTankEntries = (i) => ({ ...i, tank_entries: parseArr(i.tank_entries) });
  const parseRawMaterials = (r) => ({ ...r, raw_materials: parseArr(r.raw_materials) });
  const { data: items, loading, reload: load, setData: setItems } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 500), [], parseTankEntries);
  const { data: movements, loading: loadingMovements, reload: loadMovements } = useRealtimeEntity(
    'StockMovement',
    () => base44.entities.StockMovement.list('-movement_date', 1000),
  );
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500), [], parseRawMaterials);
  const { data: tanks } = useRealtimeEntity('Tank', () => base44.entities.Tank.list('-created_date', 500));
  const { data: containers } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const [viewMode, setViewMode] = useState('estoque');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [stockFilter, setStockFilter] = useState('todas');
  const [typeFilter, setTypeFilter] = useState('todos');
  const [clientFilter, setClientFilter] = useState('todos');
  const [showForm, setShowForm] = useState(false);
  const [showView, setShowView] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [form, setForm] = useState(emptyItem);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteMovementTarget, setDeleteMovementTarget] = useState(null);
  const [viewingMovement, setViewingMovement] = useState(null);
  const [showMovimentacao, setShowMovimentacao] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const highlightRef = useRef(null);
  const { toast } = useToast();
  const isFiscalView = viewMode === 'fiscal';

  const reloadAfterMovement = () => {
    load();
    loadMovements();
  };

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
      setForm(prev => {
        const nextClient = selected.client || prev.client;
        const nextDensity = selected.density || prev.density;
        const clientChanged = (nextClient || '').trim() !== (prev.client || '').trim();
        return {
          ...prev,
          mp_name: selected.mp_name || prev.mp_name,
          mp_code: selected.mp_code || prev.mp_code,
          client: nextClient,
          density: nextDensity,
          tank_entries: (prev.tank_entries || []).map((entry) => {
            const vol = parseFloat(entry.volume) || 0;
            return {
              ...entry,
              tank_name: clientChanged ? '' : entry.tank_name,
              mass: Math.round((parseFloat(nextDensity) || 0) * vol),
            };
          }),
        };
      });
    }
  };

  const clientOptions = useMemo(() => {
    const set = new Set();
    items.forEach(i => { if (i.client && i.client.trim()) set.add(i.client.trim()); });
    movements.forEach(m => { if (m.client && m.client.trim()) set.add(m.client.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [items, movements]);

  const filtered = items.filter(i => {
    const q = debouncedSearch.toLowerCase();
    const matchesSearch = !q || [i.mp_name, i.mp_code, i.client, i.lot, i.supplier].some(v => (v || '').toLowerCase().includes(q));
    const hasStock = (i.current_stock || 0) > 0;
    const matchesFilter = stockFilter === 'todas' || (stockFilter === 'com_saldo' && hasStock) || (stockFilter === 'sem_saldo' && !hasStock);
    const matchesClient = clientFilter === 'todos' || (i.client || '') === clientFilter;
    return matchesSearch && matchesFilter && matchesClient;
  });

  const filteredMovements = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return (movements || []).filter((m) => {
      const matchesSearch = !q || [m.mp_name, m.mp_code, m.client, m.lot, m.entry_id, m.destination]
        .some((v) => (v || '').toLowerCase().includes(q));
      const matchesClient = clientFilter === 'todos' || (m.client || '') === clientFilter;
      const matchesType = typeFilter === 'todos' || m.destination === typeFilter;
      return matchesSearch && matchesClient && matchesType;
    });
  }, [movements, debouncedSearch, clientFilter, typeFilter]);

  const totalQty = filtered.reduce((s, i) => s + (i.current_stock || 0), 0);
  const totalCost = filtered.reduce((s, i) => s + (i.current_stock || 0) * (i.unit_price || 0), 0);
  const totalPackages = filtered.reduce((s, i) => s + calcPackagingQty(i.current_stock, i.packaging_capacity), 0);
  const totalMovedQty = filteredMovements.reduce((s, m) => s + (m.quantity || 0), 0);

  const openNew = () => { setEditing(null); setForm({ ...emptyItem }); setShowForm(true); };
  const openEdit = (item) => { setEditing(item); setForm({ ...item, tank_entries: item.tank_entries || (item.tank_name ? [{ tank_name: item.tank_name, volume: item.tank_volume, mass: item.tank_mass }] : []) }); setShowForm(true); };
  const openView = (item) => { setViewing(item); setShowView(true); };

  const handlePrintLabel = async (item) => {
    try {
      const publicToken = await ensureRawMaterialStockPublicToken(item);
      if (publicToken && !item.public_token) {
        setItems((prev) =>
          (prev || []).map((e) => (e.id === item.id ? { ...e, public_token: publicToken } : e))
        );
      }
      await printRawMaterialLabel({ ...item, public_token: publicToken }, publicToken);
    } catch (err) {
      toast({ title: t('errors.saveFailed'), description: err.message, variant: 'destructive' });
    }
  };

  const addTankEntry = () => setForm(prev => ({ ...prev, tank_entries: [...(prev.tank_entries || []), { tank_name: '', volume: '', mass: 0 }] }));
  const updateTankEntry = (idx, patch) => setForm(prev => ({ ...prev, tank_entries: (prev.tank_entries || []).map((e, i) => i === idx ? { ...e, ...patch } : e) }));
  const removeTankEntry = (idx) => setForm(prev => ({ ...prev, tank_entries: (prev.tank_entries || []).filter((_, i) => i !== idx) }));

  const clientTanks = useMemo(() => {
    const client = (form.client || '').trim();
    if (!client) return [];
    return (tanks || []).filter((tank) => (tank.client || '').trim() === client);
  }, [tanks, form.client]);

  // Conferência sempre usa Estoque Inicial (= quantidade da nota).
  const usesVolumeConference = (form.unit || '').toLowerCase() === 'l';
  const conferenceUnit = usesVolumeConference ? 'L' : 'kg';
  const initialStockQty = parseFloat(form.initial_stock) || 0;
  const tankConferenceTotal = useMemo(() => {
    return (form.tank_entries || []).reduce((sum, entry) => {
      if (usesVolumeConference) return sum + (parseFloat(entry.volume) || 0);
      return sum + (parseFloat(entry.mass) || 0);
    }, 0);
  }, [form.tank_entries, usesVolumeConference]);
  const tankConferenceDiff = tankConferenceTotal - initialStockQty;
  const tankConferenceStatus =
    Math.abs(tankConferenceDiff) <= CONFERENCE_TOLERANCE
      ? 'match'
      : tankConferenceDiff > 0
        ? 'over'
        : 'under';

  // Ao editar, o cálculo de qtd. de embalagens usa o saldo atual;
  // ao criar, usa o estoque inicial (que também é o saldo atual no momento).
  const stockForPackaging = () => editing ? (parseFloat(form.current_stock) || 0) : (parseFloat(form.initial_stock) || 0);

  const save = async () => {
    const initialStock = parseFloat(form.initial_stock) || 0;
    const packagingCapacity = parseFloat(form.packaging_capacity) || 0;
    const data = { ...form, unit_price: parseFloat(form.unit_price) || 0, initial_stock: initialStock, current_stock: editing ? (parseFloat(form.current_stock) || 0) : initialStock, density: parseFloat(form.density) || 0, entry_date: form.entry_date || null, packaging_capacity: packagingCapacity, packaging_quantity: calcPackagingQty(stockForPackaging(), packagingCapacity), status_wms: editing ? !!form.status_wms : false, tank_entries: form.tank_storage ? (form.tank_entries || []).filter(te => te.tank_name).map(te => ({ tank_name: te.tank_name, volume: parseFloat(te.volume) || 0, mass: te.mass || 0 })) : [] };
    if (!data.mp_name) { toast({ title: t('rawMaterialStock.messages.mpRequired'), variant: 'destructive' }); return; }
    if (form.tank_storage) {
      const allocated = (data.tank_entries || []).reduce((sum, entry) => {
        if (usesVolumeConference) return sum + (entry.volume || 0);
        return sum + (entry.mass || 0);
      }, 0);
      if (allocated - initialStock > CONFERENCE_TOLERANCE) {
        toast({
          title: t('rawMaterialStock.messages.tankConferenceExceeded'),
          description: t('rawMaterialStock.messages.tankConferenceExceededDetail', {
            allocated: fmtNumber(allocated),
            initialStock: fmtNumber(initialStock),
            unit: conferenceUnit,
          }),
          variant: 'destructive',
        });
        return;
      }
    }
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

  const openMovementView = (movement) => setViewingMovement(movement);

  const removeMovement = (movement) => setDeleteMovementTarget(movement);

  const confirmDeleteMovement = async () => {
    if (!deleteMovementTarget) return;
    const movement = deleteMovementTarget;
    const qty = parseFloat(movement.quantity) || 0;
    const stock = items.find((s) => s.id === movement.stock_id);

    if (stock && qty > 0) {
      const restoredBalance = (parseFloat(stock.current_stock) || 0) + qty;
      const patch = { current_stock: restoredBalance };
      if (stock.packaging_capacity) {
        patch.packaging_quantity = calcPackagingQty(restoredBalance, stock.packaging_capacity);
      }
      await base44.entities.RawMaterialStock.update(stock.id, patch);
    }

    await base44.entities.StockMovement.delete(movement.id);
    setDeleteMovementTarget(null);
    reloadAfterMovement();
    toast({
      title: t('success.deleted'),
      description: stock && qty > 0
        ? t('rawMaterialStock.fiscalDelete.restored', {
            qty: fmtNumber(qty),
            unit: movement.unit || stock.unit || '',
            entryId: stock.entry_id || movement.entry_id || '',
          })
        : undefined,
    });
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

  const handleToggleWms = async (item, newValue) => {
    if (!canEdit) return;
    setItems((prev) =>
      prev.map((e) => (e.id === item.id ? { ...e, status_wms: newValue } : e))
    );
    try {
      await base44.entities.RawMaterialStock.update(item.id, { status_wms: newValue });
    } catch (err) {
      setItems((prev) =>
        prev.map((e) => (e.id === item.id ? { ...e, status_wms: item.status_wms } : e))
      );
      toast({ title: t('errors.saveFailed'), description: err?.message, variant: 'destructive' });
    }
  };

  useEffect(() => {
    const id = searchParams.get('id');
    if (!id || loading) return;
    const match = items.find((i) => i.id === id);
    if (!match) return;
    setViewMode('estoque');
    setHighlightId(id);
    setSearch('');
    setStockFilter('todas');
    setClientFilter('todos');
    const next = new URLSearchParams(searchParams);
    next.delete('id');
    setSearchParams(next, { replace: true });
  }, [searchParams, loading, items, setSearchParams]);

  useEffect(() => {
    if (!highlightId || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(timer);
  }, [highlightId, filtered]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Fixed Header */}
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">⚗ {t('rawMaterialStock.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {isFiscalView
              ? t('rawMaterialStock.fiscalSubtitle', { count: movements.length })
              : t('rawMaterialStock.subtitle', { count: items.length })}
          </p>
        </div>
        <div className="flex gap-2">
          {!isFiscalView && (
            <Button onClick={handleExportExcel} disabled={exporting} className="bg-green-600 text-white hover:bg-green-700">
              {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />} {t('rawMaterialStock.exportExcel')}
            </Button>
          )}
          {isFiscalView && canEdit && (
            <Button onClick={() => setShowMovimentacao(true)} style={{ background: '#2575D1' }} className="text-white hover:opacity-90">
              <ArrowLeftRight className="w-4 h-4 mr-2" /> {t('rawMaterialStock.movement')}
            </Button>
          )}
          {!isFiscalView && canCreate && (
            <Button onClick={openNew} style={{ background: '#2575D1' }} className="text-white hover:opacity-90">
              <Plus className="w-4 h-4 mr-2" /> {t('rawMaterialStock.newItem')}
            </Button>
          )}
        </div>
      </div>

      <div className="shrink-0 mb-3">
        <Tabs value={viewMode} onValueChange={setViewMode}>
          <TabsList className="h-auto p-1.5 gap-1 bg-muted/80 border border-border shadow-sm">
            <TabsTrigger value="estoque" className={VIEW_TAB_CLASS}>
              <Package className="w-4 h-4" />
              {t('rawMaterialStock.views.stock')}
            </TabsTrigger>
            <TabsTrigger value="fiscal" className={VIEW_TAB_CLASS}>
              <FileText className="w-4 h-4" />
              {t('rawMaterialStock.views.fiscalMovement')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Card: fixed search, scrollable table, fixed footer */}
      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="shrink-0 p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={isFiscalView ? t('rawMaterialStock.fiscalSearchPlaceholder') : t('rawMaterialStock.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {!isFiscalView ? (
            <Select value={stockFilter} onValueChange={setStockFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">{t('rawMaterialStock.filters.all')}</SelectItem>
                <SelectItem value="com_saldo">{t('rawMaterialStock.filters.withBalance')}</SelectItem>
                <SelectItem value="sem_saldo">{t('rawMaterialStock.filters.withoutBalance')}</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">{t('rawMaterialStock.filters.allTypes')}</SelectItem>
                <SelectItem value="Perda em Processo">{t('rawMaterialStock.destinations.processLoss')}</SelectItem>
                <SelectItem value="Retorno de MP Não Aplicada">{t('rawMaterialStock.destinations.unusedReturn')}</SelectItem>
              </SelectContent>
            </Select>
          )}
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
          {isFiscalView ? (
            loadingMovements ? (
              <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
            ) : filteredMovements.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">{t('rawMaterialStock.viewDialog.noMovements')}</p>
            ) : (
              <table className="w-full chemctrl-table">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.table.reg')}</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold">{t('common.date')}</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.table.code')}</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.fiscalTable.product')}</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.table.client')}</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.table.lot')}</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold">{t('common.quantity')}</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.fiscalTable.unit')}</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.fiscalTable.type')}</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold">{t('rawMaterialStock.table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMovements.map((m) => (
                    <tr key={m.id} className="border-b border-border hover:bg-accent/30">
                      <td className="px-4 py-2.5 text-sm font-medium text-primary">{m.entry_id || '—'}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground whitespace-nowrap">
                        {fmtDateTime(m.movement_date, undefined, i18n.language)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-sm text-muted-foreground">{m.mp_code || '—'}</td>
                      <td className="px-4 py-2.5 font-medium text-sm text-foreground">{m.mp_name || '—'}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{m.client || t('common.notAvailable')}</td>
                      <td className="px-4 py-2.5 font-mono text-sm text-muted-foreground">{m.lot || t('common.notAvailable')}</td>
                      <td className="px-4 py-2.5 text-right text-sm font-semibold text-red-600 dark:text-red-400">
                        -{fmtNumber(m.quantity)}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{m.unit || '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${DEST_COLORS[m.destination] || 'bg-muted text-foreground'}`}>
                          {translateStockDestination(m.destination)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => openMovementView(m)}
                            className="p-1.5 rounded hover:bg-accent"
                            title={t('buttons.view')}
                          >
                            <Eye className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                          </button>
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => removeMovement(m)}
                              className="p-1.5 rounded hover:bg-accent"
                              title={t('buttons.delete')}
                            >
                              <Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-400" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : loading ? (
            <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
          ) : (
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.table.reg')}</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.table.code')}</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold">{t('rawMaterialStock.table.name')}</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold">{t('rawMaterialStock.table.statusWms')}</th>
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
                  const isHighlighted = highlightId === item.id;
                  return (
                    <tr
                      key={item.id}
                      ref={isHighlighted ? highlightRef : undefined}
                      className={`border-b border-border hover:bg-accent/30 ${isHighlighted ? 'bg-primary/10 ring-2 ring-inset ring-primary' : ''}`}
                      style={{ opacity: zeroStock ? 0.45 : 1 }}
                    >
                       <td className="px-4 py-2.5 text-sm font-medium text-primary">{item.entry_id || `#${idx + 1}`}</td>
                       <td className="px-4 py-2.5 font-mono text-sm text-muted-foreground">{item.mp_code}</td>
                       <td className="px-4 py-2.5 font-medium text-sm text-foreground">{item.mp_name}</td>
                       <td className="px-4 py-2.5 text-center">
                         <div className="inline-flex items-center justify-center gap-2">
                           <Switch
                             checked={!!item.status_wms}
                             onCheckedChange={(checked) => handleToggleWms(item, checked)}
                             disabled={!canEdit}
                             className={
                               item.status_wms
                                 ? 'data-[state=checked]:bg-green-400'
                                 : 'data-[state=unchecked]:bg-orange-300'
                             }
                             title={item.status_wms ? t('rawMaterialStock.wms.okHint') : t('rawMaterialStock.wms.nokHint')}
                           />
                           <span
                             className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                               item.status_wms
                                 ? 'bg-green-100 text-green-700'
                                 : 'bg-orange-100 text-orange-700'
                             }`}
                           >
                             {item.status_wms ? t('rawMaterialStock.wms.ok') : t('rawMaterialStock.wms.nok')}
                           </span>
                         </div>
                       </td>
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
                           <button onClick={() => handlePrintLabel(item)} className="p-1.5 rounded hover:bg-accent" title={t('rawMaterialStock.printLabel')}><Printer className="w-4 h-4 text-muted-foreground hover:text-foreground" /></button>
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
          {isFiscalView ? (
            <>
              <span>{t('rawMaterialStock.footer.movementsShown')}: {filteredMovements.length}</span>
              <span>{t('rawMaterialStock.footer.totalMoved')}: <strong className="text-red-600">-{fmtNumber(totalMovedQty)}</strong> {t('rawMaterialStock.footer.mixedUnits')}</span>
            </>
          ) : (
            <>
              <span>{t('rawMaterialStock.footer.itemsShown')}: {filtered.length}</span>
              <span>{t('rawMaterialStock.footer.totalStock')}: <strong>{fmtNumber(totalQty)}</strong> {t('rawMaterialStock.footer.mixedUnits')}</span>
              <span>{t('rawMaterialStock.footer.packagingQty')}: <strong>{fmtNumber(totalPackages)}</strong></span>
              <span>{t('rawMaterialStock.footer.totalCost')}: <strong style={{ color: '#16a34a' }}>{fmtCurrency(totalCost)}</strong></span>
            </>
          )}
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
              <div><label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.client')}</label><Input value={form.client} onChange={e => {
                const nextClient = e.target.value;
                setForm(prev => ({
                  ...prev,
                  client: nextClient,
                  tank_entries: (prev.tank_entries || []).map((entry) => ({ ...entry, tank_name: '' })),
                }));
              }} placeholder={t('rawMaterialStock.form.autoFill')} /></div>
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
            <div className="flex items-center justify-between gap-3 p-4 border rounded-lg bg-muted/30">
              <div>
                <p className="text-sm font-medium">{t('rawMaterialStock.form.tankStorage')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t('rawMaterialStock.form.tankStorageHint')}</p>
              </div>
              <Switch
                checked={form.tank_storage || false}
                onCheckedChange={(checked) => setForm({
                  ...form,
                  tank_storage: checked,
                  tank_entries: checked
                    ? (form.tank_entries && form.tank_entries.length > 0 ? form.tank_entries : [{ tank_name: '', volume: '', mass: 0 }])
                    : [],
                })}
              />
            </div>
            {form.tank_storage && (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-100 dark:border-blue-900 space-y-3">
                {(form.tank_entries || []).map((entry, idx) => {
                  const currentVolume = computeTankCurrentVolume(entry.tank_name, items, containers, editing?.id);
                  const entryVolume = parseFloat(entry.volume) || 0;
                  const finalVolume = currentVolume + entryVolume;
                  return (
                    <div key={idx} className="grid grid-cols-2 gap-3 pb-3 border-b border-blue-100 dark:border-blue-900 last:border-0 last:pb-0">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.tank')} *</label>
                        <Select
                          value={entry.tank_name || ''}
                          onValueChange={(v) => updateTankEntry(idx, { tank_name: v })}
                          disabled={!form.client}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={form.client ? t('rawMaterialStock.form.selectTank') : t('rawMaterialStock.form.selectClientFirst')} />
                          </SelectTrigger>
                          <SelectContent>
                            {clientTanks.length === 0 ? (
                              <SelectItem value="__none" disabled>
                                {form.client
                                  ? t('rawMaterialStock.form.noTanksForClient')
                                  : t('rawMaterialStock.form.selectClientFirst')}
                              </SelectItem>
                            ) : (
                              clientTanks.map((tank) => (
                                <SelectItem key={tank.id} value={tank.name}>{tank.name}</SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.volume')}</label>
                        <Input
                          type="number"
                          step="0.001"
                          value={entry.volume || ''}
                          onChange={(e) => {
                            const vol = parseFloat(e.target.value) || 0;
                            const mass = Math.round((parseFloat(form.density) || 0) * vol);
                            updateTankEntry(idx, { volume: e.target.value === '' ? '' : vol, mass });
                          }}
                        />
                        {entry.tank_name && (
                          <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
                            {t('rawMaterialStock.form.tankCurrentVolume')}:{' '}
                            <span className="font-semibold text-foreground">{fmtNumber(currentVolume)} L</span>
                            {' → '}
                            {t('rawMaterialStock.form.tankFinalVolume')}:{' '}
                            <span className="font-semibold text-blue-700 dark:text-blue-400">{fmtNumber(finalVolume)} L</span>
                          </p>
                        )}
                      </div>
                      <div className="col-span-2 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          {t('rawMaterialStock.form.massCalc', {
                            mass: fmtMass(entry.mass || 0),
                            density: form.density || 0,
                            volume: entry.volume || 0,
                          })}
                        </span>
                        <button type="button" onClick={() => removeTankEntry(idx)} className="text-red-500 hover:text-red-700 font-medium">{t('buttons.remove')}</button>
                      </div>
                    </div>
                  );
                })}
                <div
                  className={`rounded-md border px-3 py-2 text-xs ${
                    tankConferenceStatus === 'match'
                      ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300'
                      : tankConferenceStatus === 'over'
                        ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
                        : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
                  }`}
                >
                  <p className="font-semibold mb-0.5">{t('rawMaterialStock.form.tankConference')}</p>
                  <p>
                    {t('rawMaterialStock.form.tankConferenceSummary', {
                      allocated: fmtNumber(tankConferenceTotal),
                      initialStock: fmtNumber(initialStockQty),
                      unit: conferenceUnit,
                    })}
                  </p>
                  <p className="mt-0.5">
                    {tankConferenceStatus === 'match'
                      ? t('rawMaterialStock.form.tankConferenceMatch')
                      : tankConferenceStatus === 'over'
                        ? t('rawMaterialStock.form.tankConferenceOver', {
                            diff: fmtNumber(Math.abs(tankConferenceDiff)),
                            unit: conferenceUnit,
                          })
                        : t('rawMaterialStock.form.tankConferenceUnder', {
                            diff: fmtNumber(Math.abs(tankConferenceDiff)),
                            unit: conferenceUnit,
                          })}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={addTankEntry} className="w-full border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/40">
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
      <MovimentacaoFiscalViewDialog
        movement={viewingMovement}
        stock={viewingMovement ? items.find((s) => s.id === viewingMovement.stock_id) : null}
        open={!!viewingMovement}
        onOpenChange={(open) => { if (!open) setViewingMovement(null); }}
      />
      {/* Movimentação Dialog */}
      <MovimentacaoEstoqueDialog
        open={showMovimentacao}
        onOpenChange={setShowMovimentacao}
        stocks={items}
        onSuccess={reloadAfterMovement}
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
      <ConfirmDialog
        open={!!deleteMovementTarget}
        onOpenChange={(open) => { if (!open) setDeleteMovementTarget(null); }}
        title={t('rawMaterialStock.fiscalDelete.title')}
        message={t('rawMaterialStock.fiscalDelete.message', {
          type: translateStockDestination(deleteMovementTarget?.destination),
          qty: fmtNumber(deleteMovementTarget?.quantity),
          unit: deleteMovementTarget?.unit || '',
          product: deleteMovementTarget?.mp_name || '',
          entryId: deleteMovementTarget?.entry_id || '',
        })}
        onConfirm={confirmDeleteMovement}
        confirmLabel={t('rawMaterialStock.fiscalDelete.confirm')}
        confirmColor="#DC2626"
      />
    </div>
  );
}
