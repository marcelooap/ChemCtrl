import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext } from 'react-router-dom';
import { Search, Eye, Pencil, Truck, FileText, Printer, Loader2, Plus, ArrowUpRight, History, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { generateBoletaPDF, generateVasilhamesReportPDF } from '@/lib/pdfReports';
import { printContainerLabel } from '@/lib/labelprint';
import { usePermissions } from '@/lib/rbac/PermissionProvider';
import { ensureProductionPublicToken } from '@/lib/ensurePublicToken';
import { zeroOutTankaStock } from '@/lib/tankUtils';
import { PACKAGING_TYPES } from '@/lib/packagingTypes';
import { fmtDate, fmtNumber } from '@/i18n/formatters';
import AddTankDialog from '@/components/vasilhames/AddTankDialog';
import HistoryDialog from '@/components/vasilhames/HistoryDialog';
import FractionalBadge from '@/components/production/FractionalBadge';
import { productionOfContainer, containerDisplayVolume, containerDisplayNetWeight, containerDisplayGrossWeight } from '@/lib/fractionalSupply';

const CONTAINER_STATUS_KEYS = {
  'No Pátio': 'containers.status.yard',
  Expedido: 'containers.status.shipped',
};

const parseArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);

// Finds the transfer (transbordo) related to a container, whether it's an origin or a destination.
const findTransferForContainer = (container, transfers) => {
  if (!container || !transfers) return null;
  // Destination: created from a transbordo, op_number === transfer_number
  if (container.op_number && container.op_number.startsWith('TB')) {
    const t = transfers.find(tr => tr.transfer_number === container.op_number);
    if (t) return { transfer: t, role: 'destino' };
  }
  // Origin: its id appears in origins[].container_id
  const asOrigin = transfers.find(tr => {
    const origins = parseArr(tr.origins);
    return origins.some(o => o.container_id === container.id);
  });
  if (asOrigin) return { transfer: asOrigin, role: 'origem' };
  return null;
};

export default function Vasilhames() {
  const { t, i18n } = useTranslation();
  const { user, isReadOnly } = useOutletContext();
  const { hasPermission } = usePermissions();
  const canCreate = !isReadOnly && hasPermission('containers.create');
  const canEdit = !isReadOnly && hasPermission('containers.edit');
  const canDeleteContainer = !isReadOnly && hasPermission('containers.delete');
  const { data: containers, loading, reload: load } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-updated_date', 500));
  const { data: productions } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 500));
  const { data: transfers } = useRealtimeEntity('Transfer', () => base44.entities.Transfer.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [showView, setShowView] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDepart, setShowDepart] = useState(false);
  const [showAddTank, setShowAddTank] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [departDate, setDepartDate] = useState(new Date().toISOString().split('T')[0]);
  const [departItem, setDepartItem] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingDepart, setSavingDepart] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const { toast } = useToast();

  const na = t('common.notAvailable');

  const translateContainerStatus = useCallback((status) => {
    const key = CONTAINER_STATUS_KEYS[status];
    return key ? t(key) : status;
  }, [t]);

  const canDelete = canDeleteContainer;

  const clients = Array.from(new Set(containers.map(c => c.client).filter(Boolean))).sort();

  const filtered = containers.filter(c => {
    const q = search.toLowerCase().trim();
    const fractionalKeywords = new Set([
      'fracionado',
      'frac',
      'fractional',
      (t('production.fractional.badgeContainer') || '').toLowerCase().trim(),
      (t('production.fractional.badge') || '').toLowerCase().trim(),
    ].filter(Boolean));
    const isFractionalKeyword = q && fractionalKeywords.has(q);
    let matchSearch;
    if (!q) {
      matchSearch = true;
    } else if (isFractionalKeyword) {
      const prod = productionOfContainer(c, productions || []);
      matchSearch = !!prod?.fractional_supply && c.status === 'No Pátio';
    } else {
      matchSearch = [c.product, c.client, c.container_number, c.barril_number, c.lot].some(v => (v || '').toLowerCase().includes(q));
    }
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    const matchClient = clientFilter === 'all' || c.client === clientFilter;
    return matchSearch && matchStatus && matchClient;
  });

  const productCodeOf = (c) => {
    const r = (recipes || []).find(rc => rc.product_name === c.product);
    return (r && r.code) || c.product;
  };

  const resolveRecipeForContainer = (container, production) => {
    if (production?.recipe_id) {
      const byId = (recipes || []).find((r) => r.id === production.recipe_id);
      if (byId) return byId;
    }
    return (recipes || []).find((r) => r.product_name === container.product);
  };

  const handlePrintLabel = async (container) => {
    try {
      const production = (productions || []).find(
        (p) => p.id === container.production_id || p.op_number === container.op_number,
      );
      const recipe = resolveRecipeForContainer(container, production);
      const publicToken = await ensureProductionPublicToken(production);
      await printContainerLabel(container, recipe?.validity_days, publicToken);
    } catch (err) {
      toast({ title: t('errors.saveFailed'), description: err.message, variant: 'destructive' });
    }
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id));
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(c => next.delete(c.id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(c => next.add(c.id));
        return next;
      });
    }
  };

  const selectedContainers = containers.filter(c => selected.has(c.id));

  const enviarDados = () => {
    const productIds = new Set(selectedContainers.map(productCodeOf));
    if (productIds.size > 1) {
      toast({
        title: t('containers.vasilhames.validationTitle'),
        description: t('containers.vasilhames.validationSameProduct'),
        variant: 'destructive',
      });
      return;
    }
    setSending(true);
    try {
      const recipe = (recipes || []).find(rc => rc.product_name === selectedContainers[0].product);
      generateVasilhamesReportPDF(selectedContainers, recipe);
      toast({ title: t('containers.messages.reportGenerated'), description: t('containers.messages.reportExported', { count: selectedContainers.length }) });
    } catch (err) {
      toast({ title: t('containers.vasilhames.reportError'), description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const fmt = (n) => fmtNumber(n || 0, { minimumFractionDigits: 3, maximumFractionDigits: 3 }, i18n.language);
  const fmtWeight = (n) => fmtNumber(n || 0, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, i18n.language);
  const fmtFractionalVolume = (n) => {
    const rounded = Math.round(n || 0);
    return fmtNumber(rounded, { minimumFractionDigits: 3, maximumFractionDigits: 3 }, i18n.language);
  };
  const prodOf = (c) => productionOfContainer(c, productions);
  const fmtRegId = (n) => n != null ? String(n).padStart(2, '0') : na;

  const saveEdit = async () => {
    const updates = { ...editing };
    if (editing.departure_date) {
      updates.status = 'Expedido';
    } else {
      updates.status = 'No Pátio';
    }
    setSavingEdit(true);
    try {
      await base44.entities.Container.update(editing.id, updates);
      if ((editing.type || '').toLowerCase().includes('tank') && editing.container_number) {
        await zeroOutTankaStock(editing.container_number);
      }
      setShowEdit(false); load();
      toast({ title: t('containers.messages.updated') });
    } catch (err) {
      toast({ title: t('errors.saveFailed'), description: err.message, variant: 'destructive' });
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDepart = async () => {
    setSavingDepart(true);
    try {
      await base44.entities.Container.update(departItem.id, { status: 'Expedido', departure_date: departDate });
      setShowDepart(false); load();
      toast({ title: t('containers.messages.departRegistered') });
    } catch (err) {
      toast({ title: t('containers.messages.departError'), description: err.message, variant: 'destructive' });
    } finally {
      setSavingDepart(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await base44.entities.Container.delete(deleteTarget.id);
      toast({ title: t('containers.messages.deleted') });
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast({ title: t('containers.messages.deleteError'), description: err.message, variant: 'destructive' });
    }
  };

  const statusBadge = (s) => {
    const c = { 'No Pátio': 'bg-amber-100 text-amber-700', Expedido: 'bg-green-100 text-green-700' };
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c[s] || 'bg-muted'}`}>{translateContainerStatus(s)}</span>;
  };

  const noPatioCount = containers.filter(c => c.status === 'No Pátio').length;
  const noPatioVolume = containers
    .filter(c => c.status === 'No Pátio')
    .reduce((s, c) => s + containerDisplayVolume(c, productions), 0);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">{t('containers.vasilhames.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('containers.vasilhames.subtitle', { count: containers.length })}</p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowAddTank(true)} style={{ background: '#2575D1' }} className="text-white hover:opacity-90">
            <Plus className="w-4 h-4 mr-2" /> {t('containers.actions.addTank')}
          </Button>
        )}
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="shrink-0 p-4 border-b border-border flex items-center gap-3">
          <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder={t('containers.vasilhames.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32"><SelectValue placeholder={t('common.all')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.all')}</SelectItem>
              <SelectItem value="No Pátio">{t('containers.status.yard')}</SelectItem>
              <SelectItem value="Expedido">{t('containers.status.shipped')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder={t('containers.fields.client')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('containers.vasilhames.allClients')}</SelectItem>
              {clients.map(cl => <SelectItem key={cl} value={cl}>{cl}</SelectItem>)}
            </SelectContent>
          </Select>
          {selected.size > 0 && (
            <Button onClick={enviarDados} disabled={sending} className="text-white" style={{ background: '#2575D1' }}>
              {sending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('containers.vasilhames.generating')}</> : <><FileText className="w-4 h-4 mr-2" /> {t('containers.vasilhames.sendData', { count: selected.size })}</>}
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowHistory(true)} className="gap-2 ml-auto shrink-0">
            <History className="w-4 h-4" /> {t('containers.actions.history')}
          </Button>
        </div>

        {loading ? <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div> : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10"><tr className="border-b border-border bg-muted/50/50">
                <th className="px-3 py-3 text-center w-10"><Checkbox checked={allFilteredSelected} onCheckedChange={toggleSelectAll} aria-label={t('containers.vasilhames.selectAll')} /></th>
                <th className="px-4 py-3 text-left">{t('quality.ensaios.table.id')}</th>
                <th className="px-4 py-3 text-left">{t('production.opNumber')}</th>
                <th className="px-4 py-3 text-left">{t('containers.fields.plateNumber')}</th>
                <th className="px-4 py-3 text-left">{t('containers.fields.barrelNumber')}</th>
                <th className="px-4 py-3 text-left">{t('containers.fields.product')}</th>
                <th className="px-4 py-3 text-left">{t('containers.fields.client')}</th>
                <th className="px-4 py-3 text-left">{t('quality.fields.lot')}</th>
                <th className="px-4 py-3 text-right">{t('containers.fields.volume')} (L)</th>
                <th className="px-4 py-3 text-center">{t('containers.fields.status')}</th>
                <th className="px-4 py-3 text-left">{t('containers.vasilhames.departureDate')}</th>
                <th className="px-4 py-3 text-center">{t('common.actions')}</th>
              </tr></thead>
              <tbody>
                {filtered.map(c => {
                  const prod = prodOf(c);
                  return (
                  <tr key={c.id} className={`border-b border-border hover:bg-accent/30 ${selected.has(c.id) ? 'bg-blue-50/40' : ''}`}>
                    <td className="px-3 py-2.5 text-center"><Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggleSelect(c.id)} aria-label={t('containers.vasilhames.selectItem', { label: c.container_number || c.id })} /></td>
                    <td className="px-4 py-2.5 text-sm font-bold text-muted-foreground">{fmtRegId(c.registration_id)}</td>
                    <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>{c.op_number || <span className="text-muted-foreground">{t('containers.vasilhames.manual')}</span>}</td>
                    <td className="px-4 py-2.5 text-sm font-medium">
                      <span className="inline-flex items-center gap-1">
                        {c.container_number}
                        {(() => {
                          const rel = findTransferForContainer(c, transfers);
                          if (!rel) return null;
                          return (
                            <ArrowUpRight
                              className="w-3.5 h-3.5"
                              style={{ color: '#4B0082' }}
                              title={rel.role === 'origem' ? t('containers.vasilhames.transferOrigin') : t('containers.vasilhames.transferDest')}
                            />
                          );
                        })()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-sm font-medium">{c.barril_number || na}</td>
                    <td className="px-4 py-2.5 text-sm">{c.product}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{c.client}</td>
                    <td className="px-4 py-2.5 text-sm">{c.lot}</td>
                    <td className="px-4 py-2.5 text-right text-sm font-medium">
                      <span className="inline-flex items-center justify-end gap-1">
                        {prod?.fractional_supply ? fmtFractionalVolume(prod.volume_apontado) : fmt(c.volume)}
                        <FractionalBadge production={prod} variant="container" />
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">{statusBadge(c.status)}</td>
                    <td className="px-4 py-2.5 text-sm">{c.departure_date ? fmtDate(c.departure_date, undefined, i18n.language) : na}</td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => handlePrintLabel(c)} className="p-1 rounded hover:bg-muted" title={t('containers.vasilhames.printLabel')}><Printer className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        <button onClick={() => { setViewing(c); setShowView(true); }} className="p-1 rounded hover:bg-muted"><Eye className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        {canEdit && <button onClick={() => { setEditing({ ...c }); setShowEdit(true); }} className="p-1 rounded hover:bg-muted"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button>}
                        {canDelete && <button onClick={() => setDeleteTarget(c)} className="p-1 rounded hover:bg-red-50" title={t('containers.vasilhames.delete')}><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>}
                        {canEdit && c.status === 'No Pátio' && <button onClick={() => { setDepartItem(c); setDepartDate(new Date().toISOString().split('T')[0]); setShowDepart(true); }} className="p-1 rounded hover:bg-muted"><Truck className="w-3.5 h-3.5 text-green-600" /></button>}
                      </div>
                    </td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
        )}
        <div className="shrink-0 px-4 py-3 border-t border-border flex items-center gap-6 text-xs text-muted-foreground">
          <span>{t('containers.vasilhames.yardCount')}: <strong>{noPatioCount}</strong></span>
          <span>{t('containers.vasilhames.yardVolume')}: <strong>{fmt(noPatioVolume)} L</strong></span>
          <span>{t('containers.vasilhames.displayed')}: {filtered.length}</span>
          {selected.size > 0 && (
            <>
              <span className="font-semibold" style={{ color: '#2575D1' }}>{t('containers.vasilhames.selected')}: {selected.size}</span>
              <button onClick={() => setSelected(new Set())} className="text-blue-500 underline">{t('containers.vasilhames.clearSelection')}</button>
            </>
          )}
        </div>
      </div>

      {/* View */}
      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t('containers.vasilhames.viewTitle')}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-5">
              <div className="flex items-center gap-4 p-4 rounded-lg bg-blue-50">
                <div className="flex-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('containers.fields.plateNumber')}</p>
                  <p className="text-lg font-bold mt-0.5">{viewing.container_number || na}</p>
                </div>
                <div className="w-px h-12 bg-border" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('containers.fields.barrelNumber')}</p>
                  <p className="text-lg font-bold mt-0.5">{viewing.barril_number || na}</p>
                </div>
                <div className="w-px h-12 bg-border" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('containers.fields.registrationId')}</p>
                  <p className="text-lg font-bold mt-0.5 text-primary">{fmtRegId(viewing.registration_id)}</p>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{t('containers.vasilhames.opData')}</h4>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm bg-muted/50/50 rounded-lg p-4">
                  <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">{t('production.opNumber')}</span><span className="font-bold" style={{ color: '#2575D1' }}>{viewing.op_number || na}</span></div>
                  <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">{t('quality.fields.lot')}</span><span className="font-medium">{viewing.lot || na}</span></div>
                  <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">{t('containers.fields.product')}</span><span className="font-bold text-right">{viewing.product || na}</span></div>
                  <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">{t('containers.fields.client')}</span><span className="font-medium text-right">{viewing.client || na}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">{t('containers.fields.status')}</span>{statusBadge(viewing.status)}</div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">{t('containers.vasilhames.departureDate')}</span><span className="font-medium">{viewing.departure_date ? fmtDate(viewing.departure_date, undefined, i18n.language) : na}</span></div>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{t('containers.vasilhames.packagingData')}</h4>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">{t('containers.vasilhames.type')}</p><p className="font-bold">{viewing.type || na}</p></div>
                  <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">{t('containers.fields.volume')} (L)</p><p className="font-bold text-base inline-flex items-center gap-1" style={{ color: '#2575D1' }}>{prodOf(viewing)?.fractional_supply ? fmtFractionalVolume(prodOf(viewing).volume_apontado) : fmt(containerDisplayVolume(viewing, productions))}<FractionalBadge production={prodOf(viewing)} variant="container" /></p></div>
                  <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">{t('containers.vasilhames.tare')}</p><p className="font-medium">{fmt(viewing.tare)}</p></div>
                  <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">{t('containers.fields.netWeight')} (kg)</p><p className="font-bold text-base text-green-700">{fmtWeight(containerDisplayNetWeight(viewing, productions, recipes))}</p></div>
                  <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">{t('containers.fields.grossWeight')} (kg)</p><p className="font-bold text-base">{fmtWeight(containerDisplayGrossWeight(viewing, productions, recipes))}</p></div>
                  <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">{t('containers.vasilhames.minTest')}</p><p className="font-medium">{viewing.min_test_date ? fmtDate(viewing.min_test_date, undefined, i18n.language) : na}</p></div>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{t('containers.vasilhames.logistics')}</h4>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm bg-muted/50/50 rounded-lg p-4">
                  <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">{t('containers.fields.seals')}</span><span className="font-medium text-right">{viewing.seals || na}</span></div>
                  <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">{t('containers.vasilhames.sling')}</span><span className="font-medium">{viewing.sling || na}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">{t('containers.vasilhames.gps')}</span><span className="font-medium">{viewing.gps || na}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">{t('common.responsible')}</span><span className="font-medium">{viewing.operator || na}</span></div>
                </div>
              </div>

              {(() => {
                const rel = findTransferForContainer(viewing, transfers);
                if (!rel) return null;
                const { transfer, role } = rel;
                const origins = parseArr(transfer.origins);
                const dests = parseArr(transfer.destinations);
                return (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1 h-4 rounded bg-purple-600" />
                      <h4 className="text-xs font-bold uppercase tracking-wide text-purple-700">{t('containers.transfer.title')}</h4>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                        {role === 'origem' ? t('containers.transferPage.roles.origin') : t('containers.transferPage.roles.destination')}
                      </span>
                    </div>
                    <div className="bg-muted/50/50 rounded-lg p-4 space-y-3 text-sm">
                      <div className="grid grid-cols-3 gap-3 pb-2 border-b border-border">
                        <div><p className="text-xs text-muted-foreground">{t('containers.transferPage.table.record')}</p><p className="font-bold" style={{ color: '#7C3AED' }}>{transfer.transfer_number || na}</p></div>
                        <div><p className="text-xs text-muted-foreground">{t('common.date')}</p><p className="font-medium">{transfer.date ? fmtDate(transfer.date, undefined, i18n.language) : na}</p></div>
                        <div><p className="text-xs text-muted-foreground">{t('common.type')}</p><p className="font-medium">{dests[0]?.type || transfer.destination_type || na}</p></div>
                      </div>
                      {origins.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2">{t('containers.vasilhames.originPackaging')}</p>
                          <div className="space-y-1.5">
                            {origins.map((o, i) => (
                              <div key={i} className="flex items-center gap-3 text-xs bg-card rounded px-3 py-1.5 border border-border">
                                <span className="font-semibold" style={{ color: '#2575D1' }}>{o.container_number || na}</span>
                                <span className="text-muted-foreground">{o.barril_number || na}</span>
                                <span className="text-muted-foreground">{t('quality.fields.lot')}: {o.lot || na}</span>
                                <span className="ml-auto font-medium">{t('containers.vasilhames.volumeWithdrawn')}: {fmt(o.volume_used)} L</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {dests.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2">{t('containers.vasilhames.destinations')}</p>
                          <div className="space-y-1.5">
                            {dests.map((d, i) => (
                              <div key={i} className="flex items-center gap-3 text-xs bg-card rounded px-3 py-1.5 border border-border">
                                <span className="font-semibold" style={{ color: '#2575D1' }}>{d.placa || na}</span>
                                <span className="text-muted-foreground">{d.barril || na}</span>
                                <span className="text-muted-foreground">{d.packaging_type || d.type || na}</span>
                                <span className="ml-auto font-medium">{t('containers.fields.volume')}: {fmt(d.volume)} L</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          <div className="flex justify-between mt-4 pt-4 border-t">
            <Button variant="outline" onClick={() => generateBoletaPDF(viewing)} className="gap-2">
              <FileText className="w-4 h-4" /> {t('containers.actions.generateBoleta')}
            </Button>
            <Button variant="outline" onClick={() => setShowView(false)}>{t('buttons.close')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t('containers.vasilhames.editTitle', { product: editing?.product })}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('containers.fields.plateNumber')}</label>
                <Input value={editing.container_number || ''} onChange={e => setEditing({ ...editing, container_number: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('containers.fields.barrelNumber')}</label>
                <Input value={editing.barril_number || ''} onChange={e => setEditing({ ...editing, barril_number: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('containers.vasilhames.type')}</label>
                <Select value={editing.type || ''} onValueChange={v => setEditing({ ...editing, type: v })}>
                  <SelectTrigger><SelectValue placeholder={t('common.selectOption')} /></SelectTrigger>
                  <SelectContent>
                    {PACKAGING_TYPES.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('quality.fields.lot')}</label>
                <Input value={editing.lot || ''} onChange={e => setEditing({ ...editing, lot: e.target.value })} placeholder={t('containers.vasilhames.lotPlaceholder')} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('containers.fields.volume')} (L)</label>
                <Input type="number" value={editing.volume || ''} onChange={e => setEditing({ ...editing, volume: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('containers.fields.seals')}</label>
                <Input value={editing.seals || ''} onChange={e => setEditing({ ...editing, seals: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('containers.vasilhames.tare')}</label>
                <Input type="number" value={editing.tare || ''} onChange={e => setEditing({ ...editing, tare: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('containers.vasilhames.sling')}</label>
                <Input value={editing.sling || ''} onChange={e => setEditing({ ...editing, sling: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('containers.vasilhames.gps')}</label>
                <Input value={editing.gps || ''} onChange={e => setEditing({ ...editing, gps: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground">{t('containers.vasilhames.minTestDate')}</label>
                <Input type="date" value={editing.min_test_date || ''} onChange={e => setEditing({ ...editing, min_test_date: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground">{t('containers.vasilhames.departureDateField')}</label>
                <Input type="date" value={editing.departure_date || ''} onChange={e => setEditing({ ...editing, departure_date: e.target.value })} />
                <p className="text-xs text-muted-foreground mt-1">{t('containers.vasilhames.departureHint')}</p>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowEdit(false)} disabled={savingEdit}>{t('buttons.cancel')}</Button>
            <Button onClick={saveEdit} disabled={savingEdit} style={{ background: '#2575D1', color: 'white' }}>
              {savingEdit ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('common.saving')}</> : t('quality.coaPage.saveChanges')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Depart */}
      <Dialog open={showDepart} onOpenChange={setShowDepart}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>{t('containers.vasilhames.departTitle')}</DialogTitle></DialogHeader>
          <div><label className="text-xs font-medium text-muted-foreground">{t('containers.vasilhames.departureDateField')}</label><Input type="date" value={departDate} onChange={e => setDepartDate(e.target.value)} /></div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowDepart(false)} disabled={savingDepart}>{t('buttons.cancel')}</Button>
            <Button onClick={confirmDepart} disabled={savingDepart} style={{ background: '#2575D1', color: 'white' }}>
              {savingDepart ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('containers.vasilhames.confirming')}</> : t('containers.vasilhames.confirmDepart')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Adicionar Tanque */}
      <AddTankDialog open={showAddTank} onOpenChange={setShowAddTank} onSaved={load} />

      {/* Histórico */}
      <HistoryDialog
        open={showHistory}
        onOpenChange={setShowHistory}
        containers={containers}
        transfers={transfers}
        productions={productions}
        recipes={recipes}
      />

      <ConfirmDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={t('containers.vasilhames.deleteTitle')}
        message={t('containers.vasilhames.deleteMessage', {
          plate: deleteTarget?.container_number || '',
          barrel: deleteTarget?.barril_number ? t('containers.vasilhames.deleteBarrelSuffix', { barrel: deleteTarget.barril_number }) : '',
        })}
        confirmLabel={t('buttons.delete')}
        confirmColor="#DC2626"
        onConfirm={confirmDelete} />
    </div>
  );
}
