import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Eye, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import FieldLabel from '@/components/transbordo/FieldLabel';
import DestinationBlock from '@/components/transbordo/DestinationBlock';
import TransferViewDialog from '@/components/transbordo/TransferViewDialog';
import ProductCombobox from '@/components/ui/ProductCombobox';
import { fmtDate, fmtNumber } from '@/i18n/formatters';
import {
  applyProportionalOriginReduction,
  createOriginsFromSlices,
  ensureContainerHasOrigin,
  sliceOriginsForWithdrawal,
} from '@/lib/containerOrigins';

const emptyDest = () => ({
  type: 'Transbordo', placa: '', barril: '', volume: 0, mass: 0,
  packaging_type: '', seals: '', sling: '', gps: '', min_test_date: '',
  driver: '', tare: 0, net_weight: 0, gross_weight: 0
});

const emptyOrigin = () => ({ container_id: '', container_number: '', barril_number: '', lot: '', volume_used: 0, remaining_stock: 0 });

const parseArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);

const TRANSFER_TYPE_KEYS = {
  Transbordo: 'containers.transferPage.types.transfer',
  Expedição: 'containers.transferPage.types.expedition',
};

export default function Transbordo() {
  const { t, i18n } = useTranslation();
  const { user } = useOutletContext();
  const { data: transfers, loading, reload: load } = useRealtimeEntity('Transfer', () => base44.entities.Transfer.list('-created_date', 500));
  const { data: allContainers } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [viewTransfer, setViewTransfer] = useState(null);
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0], product: '', client: '',
    observations: '',
    origins: [emptyOrigin()],
    destinations: [emptyDest()]
  });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const na = t('common.notAvailable');

  const fmt = useCallback((n) => fmtNumber(n || 0, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, i18n.language), [i18n.language]);
  const fmt3 = useCallback((n) => fmtNumber(n || 0, { minimumFractionDigits: 3, maximumFractionDigits: 3 }, i18n.language), [i18n.language]);

  const translateTransferType = useCallback((type) => {
    if (!type || type === '—') return na;
    const key = TRANSFER_TYPE_KEYS[type];
    return key ? t(key) : type;
  }, [t, na]);

  const containers = useMemo(() => allContainers.filter(c => c.status === 'No Pátio'), [allContainers]);

  const filtered = transfers.filter(item => {
    const q = search.toLowerCase();
    const dests = parseArr(item.destinations);
    const destinoText = dests.map(d => d.placa || '').join(' ');
    const matchesSearch = !q || [item.product, item.client, item.transfer_number, destinoText].some(v => (v || '').toLowerCase().includes(q));
    const tDate = item.date ? new Date(item.date) : null;
    const matchesStart = !startDate || (tDate && tDate >= new Date(startDate));
    const matchesEnd = !endDate || (tDate && tDate <= new Date(endDate + 'T23:59:59'));
    const tipo = dests.length > 0 ? (dests[0].type || item.destination_type || '') : (item.destination_type || '');
    const matchesType = typeFilter === 'all' || tipo === typeFilter;
    return matchesSearch && matchesStart && matchesEnd && matchesType;
  });

  const stats = useMemo(() => {
    let totalVol = 0, totalMass = 0, expeditions = 0, transbordos = 0;
    filtered.forEach(item => {
      const dests = parseArr(item.destinations);
      const totalVolT = dests.reduce((s, d) => s + (d.volume || 0), 0) || item.volume || 0;
      const tDensity = recipes.find(r => r.product_name === item.product)?.density || 0;
      totalVol += totalVolT;
      totalMass += Math.round(totalVolT * tDensity);
      const tipo = dests.length > 0 ? (dests[0].type || item.destination_type || '') : (item.destination_type || '');
      if (tipo === 'Expedição') expeditions++;
      if (tipo === 'Transbordo') transbordos++;
    });
    return { totalVol, totalMass, expeditions, transbordos, count: filtered.length };
  }, [filtered, recipes]);

  const productOptions = useMemo(() => {
    const prods = new Set();
    containers.forEach(c => { if (c.product) prods.add(c.product); });
    return Array.from(prods).sort();
  }, [containers]);

  const productContainers = useMemo(() => {
    if (!form.product) return [];
    return containers.filter(c => c.product === form.product);
  }, [containers, form.product]);

  const productDensity = useMemo(() => {
    const recipe = recipes.find(r => r.product_name === form.product);
    return recipe?.density || 0;
  }, [recipes, form.product]);

  const originsVolume = useMemo(() => {
    return form.origins.reduce((s, o) => s + (parseFloat(o.volume_used) || 0), 0);
  }, [form.origins]);

  const handleProductSelect = (product) => {
    setForm(prev => ({
      ...prev,
      product,
      client: containers.find(c => c.product === product)?.client || '',
      origins: [emptyOrigin()],
      destinations: [emptyDest()]
    }));
  };

  const handleOriginSelect = (idx, containerId) => {
    const c = containers.find(ct => ct.id === containerId);
    if (!c) return;
    const origins = [...form.origins];
    origins[idx] = {
      container_id: containerId,
      container_number: c.container_number || '',
      barril_number: c.barril_number || '',
      lot: c.lot || '',
      volume_used: 0,
      remaining_stock: c.volume || 0
    };
    setForm(prev => ({ ...prev, origins }));
  };

  const updateOrigin = (idx, field, value) => {
    const origins = [...form.origins];
    if (field === 'volume_used') {
      const vol = parseFloat(value) || 0;
      const c = containers.find(ct => ct.id === origins[idx].container_id);
      if (c) {
        origins[idx].remaining_stock = (c.volume || 0) - vol;
      }
      origins[idx].volume_used = vol;
    } else {
      origins[idx][field] = value;
    }
    setForm(prev => ({ ...prev, origins }));
  };

  const updateDest = (idx, field, value) => {
    const destinations = [...form.destinations];
    destinations[idx] = { ...destinations[idx], [field]: value };
    setForm(prev => ({ ...prev, destinations }));
  };

  const addDestination = () => {
    setForm(prev => ({ ...prev, destinations: [...prev.destinations, emptyDest()] }));
  };

  const removeDestination = (idx) => {
    setForm(prev => ({ ...prev, destinations: prev.destinations.filter((_, i) => i !== idx) }));
  };

  const save = async () => {
    if (!form.product) { toast({ title: t('containers.transferPage.messages.selectProduct'), variant: 'destructive' }); return; }
    if (form.origins.length === 0 || !form.origins[0].container_id) { toast({ title: t('containers.transferPage.messages.addOrigin'), variant: 'destructive' }); return; }
    if (form.destinations.length === 0) { toast({ title: t('containers.transferPage.messages.addDestination'), variant: 'destructive' }); return; }

    setSaving(true);
    try {
      const isSingle = form.destinations.length === 1;
      const dests = form.destinations.map(d => {
        const vol = Math.round(isSingle ? originsVolume : (parseFloat(d.volume) || 0));
        const mass = Math.round(vol * productDensity);
        const tare = parseFloat(d.tare) || 0;
        return {
          ...d,
          volume: vol,
          mass,
          net_weight: mass,
          gross_weight: mass + tare,
        };
      });

      const transferNumber = `TB${String(transfers.length + 1).padStart(2, '0')}`;

      const data = {
        ...form,
        transfer_number: transferNumber,
        operator: user?.nome || user?.full_name || user?.email || '',
        date: new Date(form.date).toISOString(),
        origins: form.origins,
        destinations: dests,
      };
      await base44.entities.Transfer.create(data);

      const originSlicesByContainer = {};
      const operatorName = user?.nome || user?.full_name || user?.email || '';

      for (const o of form.origins) {
        if (!o.container_id) continue;
        const c = containers.find(ct => ct.id === o.container_id);
        if (!c) continue;
        const withdrawn = parseFloat(o.volume_used) || 0;
        const newVolume = Math.max(0, (c.volume || 0) - withdrawn);
        const updates = { volume: newVolume };
        if (newVolume === 0) {
          updates.status = 'Expedido';
          updates.departure_date = new Date().toISOString().split('T')[0];
          updates.is_fractional = false;
        } else if (withdrawn > 0) {
          updates.is_fractional = true;
        }

        await ensureContainerHasOrigin(base44.entities, c, operatorName);
        const ensured = await base44.entities.ContainerOrigin.filter({ container_id: o.container_id });
        originSlicesByContainer[o.container_id] = sliceOriginsForWithdrawal(ensured, withdrawn);

        if (withdrawn > 0) {
          await applyProportionalOriginReduction(base44.entities, ensured, o.container_id, withdrawn);
        }

        const recipe = recipes.find(r => r.product_name === form.product);
        const dens = parseFloat(recipe?.density) || 0;
        if (dens > 0) {
          const tare = parseFloat(c.tare) || 0;
          updates.net_weight = Math.round(newVolume * dens);
          updates.gross_weight = Math.round(newVolume * dens + tare);
        }

        await base44.entities.Container.update(o.container_id, updates);
      }

      const allContainersList = await base44.entities.Container.list('-created_date', 500);
      let maxRegId = 0;
      allContainersList.forEach(c => { if (c.registration_id != null && c.registration_id > maxRegId) maxRegId = c.registration_id; });
      const firstOriginContainer = form.origins[0]?.container_id
        ? containers.find(ct => ct.id === form.origins[0].container_id)
        : null;
      const originProductionId = firstOriginContainer?.production_id || '';

      const mergedDestSlices = [];
      for (const o of form.origins) {
        const slices = originSlicesByContainer[o.container_id] || [];
        for (const s of slices) mergedDestSlices.push({ ...s });
      }
      const mergedByKey = new Map();
      for (const s of mergedDestSlices) {
        const key = `${s.production_id || ''}|${s.op_number || ''}|${s.lot || ''}`;
        const prev = mergedByKey.get(key);
        if (!prev) mergedByKey.set(key, { ...s });
        else {
          prev.volume = (parseFloat(prev.volume) || 0) + (parseFloat(s.volume) || 0);
          prev.initial_volume = prev.volume;
        }
      }
      const destOriginSlices = Array.from(mergedByKey.values());

      for (const d of dests) {
        if (d.type === 'Transbordo') {
          maxRegId += 1;
          const created = await base44.entities.Container.create({
            production_id: originProductionId,
            op_number: transferNumber,
            container_number: d.placa || '',
            barril_number: d.barril || '',
            registration_id: maxRegId,
            product: form.product,
            client: form.client || '',
            lot: form.origins[0]?.lot || '',
            type: d.packaging_type || '',
            volume: d.volume || 0,
            tare: parseFloat(d.tare) || 0,
            net_weight: d.net_weight || 0,
            gross_weight: d.gross_weight || 0,
            seals: d.seals || '',
            sling: d.sling || '',
            gps: d.gps || '',
            min_test_date: d.min_test_date || '',
            operator: operatorName,
            status: 'No Pátio',
            is_fractional: false,
          });

          if (created?.id && destOriginSlices.length > 0) {
            const destVol = parseFloat(d.volume) || 0;
            const slicesTotal = destOriginSlices.reduce((s, x) => s + (parseFloat(x.volume) || 0), 0);
            let scaled = destOriginSlices;
            if (slicesTotal > 0 && Math.abs(slicesTotal - destVol) > 0.001) {
              const ratio = destVol / slicesTotal;
              scaled = destOriginSlices.map((x) => ({
                ...x,
                volume: Math.round(((parseFloat(x.volume) || 0) * ratio) * 1000) / 1000,
                initial_volume: Math.round(((parseFloat(x.volume) || 0) * ratio) * 1000) / 1000,
              }));
            }
            await createOriginsFromSlices(base44.entities, created.id, scaled, operatorName);
          } else if (created?.id) {
            await createOriginsFromSlices(base44.entities, created.id, [{
              production_id: originProductionId || null,
              op_number: firstOriginContainer?.op_number || null,
              lot: form.origins[0]?.lot || null,
              volume: d.volume || 0,
              initial_volume: d.volume || 0,
            }], operatorName);
          }
        }
      }

      setShowForm(false); load();
      toast({ title: t('containers.transferPage.messages.registered') });
      setForm({
        date: new Date().toISOString().split('T')[0], product: '', client: '',
        observations: '',
        origins: [emptyOrigin()],
        destinations: [emptyDest()]
      });
    } catch (err) {
      toast({ title: t('containers.transferPage.messages.registerError'), description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      <div className="flex-1 flex flex-col bg-card rounded-xl shadow-sm border border-border overflow-hidden min-h-0">
        <div className="shrink-0 p-4 border-b border-border flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">🔄 {t('containers.transfer.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('containers.transferPage.subtitle', { filtered: filtered.length, total: transfers.length })}</p>
          </div>
          <Button onClick={() => setShowForm(true)} style={{ background: '#2575D1' }} className="text-white shrink-0 hover:opacity-90">
            <Plus className="w-4 h-4 mr-2" /> {t('containers.transferPage.newTransfer')}
          </Button>
        </div>

        <div className="shrink-0 p-4 border-b border-border flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder={t('common.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="w-40">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('containers.transferPage.startDate')}</label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div className="w-40">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('containers.transferPage.endDate')}</label>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <div className="w-40">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('common.type')}</label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="Transbordo">{t('containers.transferPage.types.transfer')}</SelectItem>
                <SelectItem value="Expedição">{t('containers.transferPage.types.expedition')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(search || startDate || endDate || typeFilter !== 'all') && (
            <Button onClick={() => { setSearch(''); setStartDate(''); setEndDate(''); setTypeFilter('all'); }} variant="outline" size="sm" className="text-xs">
              {t('common.clearFilters')}
            </Button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {loading ? <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div> : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{t('containers.transferPage.empty')}</div>
          ) : (
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10"><tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left">{t('containers.transferPage.table.record')}</th><th className="px-4 py-3 text-left">{t('common.type')}</th><th className="px-4 py-3 text-left">{t('common.date')}</th><th className="px-4 py-3 text-left">{t('containers.fields.product')}</th>
                <th className="px-4 py-3 text-left">{t('containers.fields.client')}</th><th className="px-4 py-3 text-left">{t('quality.fields.lot')}</th><th className="px-4 py-3 text-right">{t('containers.transferPage.table.totalVolume')}</th><th className="px-4 py-3 text-left">{t('containers.transferPage.table.destination')}</th><th className="px-4 py-3 text-left">{t('containers.transferPage.table.driver')}</th><th className="px-4 py-3 text-center">{t('common.actions')}</th>
              </tr></thead>
              <tbody>
                {filtered.map((item) => {
                  const dests = parseArr(item.destinations);
                  const originsArr = parseArr(item.origins);
                  const totalVol = dests.reduce((s, d) => s + (d.volume || 0), 0) || item.volume || 0;
                  const tipo = dests.length > 0 ? (dests[0].type || item.destination_type || '—') : (item.destination_type || '—');
                  const lotTotals = {};
                  originsArr.forEach(o => { const k = o.lot || ''; lotTotals[k] = (lotTotals[k] || 0) + (parseFloat(o.volume_used) || 0); });
                  let majorityLot = '', maxLotVol = -1;
                  Object.keys(lotTotals).forEach(k => { if (lotTotals[k] > maxLotVol) { maxLotVol = lotTotals[k]; majorityLot = k; } });
                  const lote = majorityLot || na;
                  const isTransbordo = tipo === 'Transbordo';
                  const isExpedicao = tipo === 'Expedição';
                  const motorista = isExpedicao
                    ? ((dests[0]?.driver || item.driver)?.trim() || '—')
                    : '-';
                  let destinoLabel;
                  if (dests.length === 0) {
                    destinoLabel = na;
                  } else if (isTransbordo && dests.length > 1) {
                    destinoLabel = t('containers.transferPage.loadUnits', { count: dests.length });
                  } else {
                    destinoLabel = dests.map(d => d.placa || na).filter(Boolean).join(', ');
                  }
                  return (
                    <tr key={item.id} className="border-b border-border hover:bg-accent/30">
                      <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>{item.transfer_number || na}</td>
                      <td className="px-4 py-2.5 text-sm">{translateTransferType(tipo)}</td>
                      <td className="px-4 py-2.5 text-sm">{fmtDate(item.date, undefined, i18n.language)}</td>
                      <td className="px-4 py-2.5 font-medium text-sm">{item.product}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{item.client}</td>
                      <td className="px-4 py-2.5 text-sm">{lote}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-sm">{fmt(totalVol)}</td>
                      <td className="px-4 py-2.5 text-sm font-medium">{destinoLabel}</td>
                      <td className="px-4 py-2.5 text-sm">{motorista}</td>
                      <td className="px-4 py-2.5 text-center">
                        <button onClick={() => setViewTransfer(item)} className="p-1 rounded hover:bg-muted"><Eye className="w-3.5 h-3.5 text-muted-foreground" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="shrink-0 border-t border-border bg-muted/50 px-4 py-1.5">
          <div className="flex items-center justify-between text-xs flex-wrap gap-2">
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground">{t('containers.transferPage.footer.records')}: <span className="font-bold">{stats.count}</span></span>
              <span className="text-muted-foreground">{t('containers.transferPage.footer.totalVolume')}: <span className="font-bold" style={{ color: '#2575D1' }}>{fmt(stats.totalVol)} L</span></span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground">{t('containers.transferPage.footer.transfers')}: <span className="font-bold text-blue-600">{stats.transbordos}</span></span>
              <span className="text-muted-foreground">{t('containers.transferPage.footer.expeditions')}: <span className="font-bold text-green-600">{stats.expeditions}</span></span>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-base font-semibold">{t('containers.transferPage.formTitle')}</DialogTitle></DialogHeader>
          <div className="grid gap-5">
            <div>
              <h4 className="text-sm font-bold mb-3" style={{ color: '#2A5A95' }}>{t('containers.transferPage.generalData')}</h4>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <FieldLabel>{t('containers.transferPage.dateRequired')}</FieldLabel>
                  <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
                <div>
                  <FieldLabel>{t('containers.transferPage.productRequired')}</FieldLabel>
                  <ProductCombobox
                    value={form.product}
                    onChange={handleProductSelect}
                    options={productOptions.map(p => ({ value: p, label: p }))}
                    placeholder={t('containers.transferPage.productPlaceholder')}
                  />
                </div>
                <div>
                  <FieldLabel>{t('containers.transferPage.clientAuto')}</FieldLabel>
                  <Input value={form.client} readOnly className="bg-muted/50 text-sm" placeholder={t('containers.transferPage.auto')} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div className="col-span-2">
                  <FieldLabel>{t('common.observations')}</FieldLabel>
                  <Input value={form.observations} onChange={e => setForm({ ...form, observations: e.target.value })} placeholder={t('common.observations') + '...'} />
                </div>
                <div>
                  <FieldLabel>{t('containers.transferPage.operatorAuto')}</FieldLabel>
                  <Input value={user?.nome || user?.full_name || user?.email || ''} readOnly className="bg-muted/50 text-sm" />
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold" style={{ color: '#2A5A95' }}>{t('containers.transferPage.originsTitle')}</h4>
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setForm(prev => ({ ...prev, origins: [...prev.origins, emptyOrigin()] }))}>
                  <Plus className="w-3 h-3 mr-1" /> {t('containers.transferPage.addOrigin')}
                </Button>
              </div>
              {form.origins.map((o, idx) => (
                <div key={idx} className="grid grid-cols-4 gap-3 border rounded-lg p-3 mb-2">
                  <div>
                    <FieldLabel>{t('containers.transferPage.container')}</FieldLabel>
                    <Select value={o.container_id} onValueChange={v => handleOriginSelect(idx, v)}>
                      <SelectTrigger className="text-sm"><SelectValue placeholder={t('containers.transferPage.selectContainer')} /></SelectTrigger>
                      <SelectContent>
                        {productContainers.map(c => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.container_number || na} - {c.barril_number || na}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel>{t('containers.transferPage.lotAuto')}</FieldLabel>
                    <Input value={o.lot} readOnly className="bg-muted/50 text-sm" placeholder={t('containers.transferPage.auto')} />
                  </div>
                  <div>
                    <FieldLabel>{t('containers.transferPage.volumeWithdrawn')}</FieldLabel>
                    <Input type="number" value={o.volume_used || ''} onChange={e => updateOrigin(idx, 'volume_used', e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <FieldLabel>{t('containers.transferPage.remainingStock')}</FieldLabel>
                    <Input value={fmt3(o.remaining_stock)} readOnly className="bg-muted/50 text-sm font-semibold" style={{ color: o.remaining_stock < 0 ? '#EF4444' : '#065F46' }} />
                  </div>
                </div>
              ))}
              {form.origins.length > 1 && (
                <Button variant="ghost" size="sm" className="text-xs text-red-500" onClick={() => setForm(prev => ({ ...prev, origins: prev.origins.slice(0, -1) }))}>
                  <Trash2 className="w-3 h-3 mr-1" /> {t('containers.transferPage.removeLastOrigin')}
                </Button>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold" style={{ color: '#2A5A95' }}>{t('containers.transferPage.destinationTitle')}</h4>
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={addDestination}>
                  <Plus className="w-3 h-3 mr-1" /> {t('containers.transferPage.addDestination')}
                </Button>
              </div>
              {form.destinations.map((d, idx) => (
                <DestinationBlock
                  key={idx}
                  dest={d}
                  idx={idx}
                  total={form.destinations.length}
                  originsVolume={originsVolume}
                  productDensity={productDensity}
                  onUpdate={updateDest}
                  onRemove={removeDestination}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-border">
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>{t('buttons.cancel')}</Button>
            <Button onClick={save} disabled={saving} style={{ background: '#1B5E9C', color: 'white' }}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('containers.transferPage.registering')}</> : t('containers.transferPage.register')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {viewTransfer && (
        <TransferViewDialog
          transfer={viewTransfer}
          density={recipes.find(r => r.product_name === viewTransfer.product)?.density || 0}
          recipeCode={recipes.find(r => r.product_name === viewTransfer.product)?.code || ''}
          containers={allContainers}
          onClose={() => setViewTransfer(null)}
        />
      )}
    </div>
  );
}
