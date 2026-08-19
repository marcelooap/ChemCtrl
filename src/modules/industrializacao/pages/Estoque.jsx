import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@industrializacao/api/base44Client';
import { useRealtimeEntity } from '@industrializacao/hooks/useRealtimeEntity';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Plus, Search, Eye, Pencil, Trash2, ArrowLeftRight, Loader2, Printer, Download, Package, FileText } from 'lucide-react';
import MovimentacaoEstoqueDialog from '@industrializacao/components/estoque/MovimentacaoEstoqueDialog';
import MovimentacaoFiscalViewDialog from '@industrializacao/components/estoque/MovimentacaoFiscalViewDialog';
import MpEntryCard from '@industrializacao/components/estoque/MpEntryCard';
import { exportEstoqueMPToExcel } from '@industrializacao/lib/exportEstoqueMP';
import RawMaterialViewDialog from '@industrializacao/components/estoque/RawMaterialViewDialog';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/components/ui/select';
import { Switch } from '@shared/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { useToast } from '@shared/components/ui/use-toast';
import ConfirmDialog from '@industrializacao/components/ConfirmDialog';
import moment from 'moment';
import { fmtNumber, fmtCurrency, fmtDateTime } from '@/i18n/formatters';
import { translateStockDestination } from '@/i18n/domainMaps';
import { calcPackagingQty } from '@industrializacao/lib/stockUtils';
import {
  createEmptyMpItem,
  parseJsonArray,
  buildMpStockPayload,
  validateMpStockForm,
} from '@industrializacao/lib/mpStockForm';
import { usePermissions } from '@industrializacao/lib/rbac/PermissionProvider';
import { useDebouncedValue } from '@industrializacao/hooks/useDebouncedValue';
import { allocateMpEntryIdsFromList } from '@industrializacao/lib/allocateMpEntryId';
import { printRawMaterialLabel } from '@industrializacao/lib/labelprint';

const VIEW_TAB_CLASS =
  'gap-2 px-5 py-2.5 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md';

const DEST_COLORS = {
  'Perda em Processo': 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  'Retorno de MP Não Aplicada': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300',
};

export default function Estoque() {
  const { t, i18n } = useTranslation();
  const { user, isReadOnly } = useOutletContext();
  const { hasPermission } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const canCreate = !isReadOnly && hasPermission('raw_material_stock.create');
  const canEdit = !isReadOnly && hasPermission('raw_material_stock.edit');
  const canDelete = !isReadOnly && hasPermission('raw_material_stock.delete');
  const parseTankEntries = (i) => ({ ...i, tank_entries: parseJsonArray(i.tank_entries) });
  const parseRawMaterials = (r) => ({ ...r, raw_materials: parseJsonArray(r.raw_materials) });
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
  const [forms, setForms] = useState([createEmptyMpItem()]);
  const [collapsedMp, setCollapsedMp] = useState({});
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

  const clientOptions = useMemo(() => {
    const set = new Set();
    items.forEach(i => { if (i.client && i.client.trim()) set.add(i.client.trim()); });
    movements.forEach(m => { if (m.client && m.client.trim()) set.add(m.client.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [items, movements]);

  const filtered = items.filter(i => {
    const q = debouncedSearch.toLowerCase();
    const matchesSearch = !q || [i.mp_name, i.mp_code, i.client, i.lot, i.supplier, i.nota_fiscal].some(v => (v || '').toLowerCase().includes(q));
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

  const openNew = () => {
    setEditing(null);
    setForms([createEmptyMpItem()]);
    setCollapsedMp({});
    setShowForm(true);
  };
  const openEdit = (item) => {
    setEditing(item);
    setForms([{
      ...createEmptyMpItem(),
      ...item,
      nota_fiscal: item.nota_fiscal || '',
      tank_entries: item.tank_entries || (item.tank_name ? [{ tank_name: item.tank_name, volume: item.tank_volume, mass: item.tank_mass }] : []),
    }]);
    setCollapsedMp({});
    setShowForm(true);
  };
  const openView = (item) => { setViewing(item); setShowView(true); };

  const updateForm = (index, next) => {
    setForms((prev) => prev.map((f, i) => (i === index ? next : f)));
  };

  const addMpForm = () => {
    setCollapsedMp(Object.fromEntries(forms.map((_, i) => [i, true])));
    setForms((prev) => [
      ...prev,
      { ...createEmptyMpItem(), entry_date: prev[0]?.entry_date || createEmptyMpItem().entry_date },
    ]);
  };

  const removeMpForm = (index) => {
    setForms((prev) => prev.filter((_, i) => i !== index));
    setCollapsedMp((prev) => {
      const next = {};
      Object.keys(prev).forEach((key) => {
        const i = Number(key);
        if (i < index) next[i] = prev[i];
        else if (i > index) next[i - 1] = prev[i];
      });
      return next;
    });
  };

  const toggleMpCollapse = (index) => {
    setCollapsedMp((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const handlePrintLabel = async (item) => {
    try {
      const publicToken = await ensureRawMaterialStockPublicToken(item);
      if (publicToken && !item.public_token) {
        setItems((prev) =>
          (prev || []).map((e) => (e.id === item.id ? { ...e, public_token: publicToken } : e))
        );
      }
      await printRawMaterialLabel({ ...item, public_token: publicToken }, publicToken, {
        clienteNome: item.client,
        contexto: 'industrializacao',
      });
    } catch (err) {
      toast({ title: t('errors.saveFailed'), description: err.message, variant: 'destructive' });
    }
  };

  const save = async () => {
    const multi = !editing && forms.length > 1;
    for (let i = 0; i < forms.length; i += 1) {
      const error = validateMpStockForm(forms[i], {
        t,
        fmtNumber,
        index: multi ? i + 1 : undefined,
      });
      if (error) {
        if (multi) setCollapsedMp((prev) => ({ ...prev, [i]: false }));
        toast({ title: error.title, description: error.description, variant: 'destructive' });
        return;
      }
    }

    setSaving(true);
    try {
      if (editing) {
        const form = forms[0];
        const data = buildMpStockPayload(form, { isEditing: true });
        await base44.entities.RawMaterialStock.update(editing.id, data);
        const newLot = (form.lot || '').trim();
        const oldLot = (editing.lot || '').trim();
        if (newLot !== oldLot) {
          try {
            const allProductions = await base44.entities.Production.list('-created_date', 500);
            for (const prod of allProductions) {
              const mps = parseJsonArray(prod.raw_materials_used);
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
        const rows = forms.map((form, i) => {
          const data = buildMpStockPayload(form, { isEditing: false });
          delete data.id;
          return data;
        });
        const entryIds = allocateMpEntryIdsFromList(items, rows.length);
        rows.forEach((data, i) => {
          data.entry_id = entryIds[i];
        });
        if (rows.length === 1) {
          await base44.entities.RawMaterialStock.create(rows[0]);
        } else {
          await base44.entities.RawMaterialStock.bulkCreate(rows);
        }
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
          <div className="space-y-3">
            {forms.map((mpForm, i) => (
              <MpEntryCard
                key={i}
                form={mpForm}
                index={i}
                collapsed={!!collapsedMp[i]}
                showChrome={!editing && forms.length > 1}
                canRemove={!editing && forms.length > 1}
                onChange={(next) => updateForm(i, next)}
                onToggleCollapse={() => toggleMpCollapse(i)}
                onRemove={() => removeMpForm(i)}
                mpOptions={mpOptions}
                tanks={tanks}
                stockItems={items}
                containers={containers}
                editingId={editing?.id}
                pendingItems={forms.filter((_, j) => j !== i)}
                isEditing={!!editing}
              />
            ))}
            {!editing && (
              <Button
                type="button"
                variant="outline"
                onClick={addMpForm}
                className="w-full border-dashed gap-2"
              >
                <Plus className="w-4 h-4" />
                {t('rawMaterialStock.form.addMp')}
              </Button>
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
