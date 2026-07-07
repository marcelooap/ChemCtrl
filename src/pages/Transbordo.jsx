import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Eye, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import moment from 'moment';
import FieldLabel from '@/components/transbordo/FieldLabel';
import DestinationBlock from '@/components/transbordo/DestinationBlock';
import TransferViewDialog from '@/components/transbordo/TransferViewDialog';
import ProductCombobox from '@/components/ui/ProductCombobox';
import { generateTransferPDF } from '@/lib/pdfReports';

const emptyDest = () => ({
  type: 'Transbordo', placa: '', barril: '', volume: 0, mass: 0,
  packaging_type: '', seals: '', sling: '', gps: '', min_test_date: '',
  driver: '', tare: 0, net_weight: 0, gross_weight: 0
});

const emptyOrigin = () => ({ container_id: '', container_number: '', barril_number: '', lot: '', volume_used: 0, remaining_stock: 0 });

const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 });
const fmt3 = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 });
const parseArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);

export default function Transbordo() {
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

  const containers = useMemo(() => allContainers.filter(c => c.status === 'No Pátio'), [allContainers]);

  const filtered = transfers.filter(t => {
    const q = search.toLowerCase();
    const dests = parseArr(t.destinations);
    const destinoText = dests.map(d => d.placa || '').join(' ');
    const matchesSearch = !q || [t.product, t.client, t.transfer_number, destinoText].some(v => (v || '').toLowerCase().includes(q));
    const tDate = t.date ? moment(t.date) : null;
    const matchesStart = !startDate || (tDate && tDate.isSameOrAfter(moment(startDate), 'day'));
    const matchesEnd = !endDate || (tDate && tDate.isSameOrBefore(moment(endDate), 'day'));
    const tipo = dests.length > 0 ? (dests[0].type || t.destination_type || '') : (t.destination_type || '');
    const matchesType = typeFilter === 'all' || tipo === typeFilter;
    return matchesSearch && matchesStart && matchesEnd && matchesType;
  });

  const stats = useMemo(() => {
    let totalVol = 0, totalMass = 0, expeditions = 0, transbordos = 0;
    filtered.forEach(t => {
      const dests = parseArr(t.destinations);
      const totalVolT = dests.reduce((s, d) => s + (d.volume || 0), 0) || t.volume || 0;
      const tDensity = recipes.find(r => r.product_name === t.product)?.density || 0;
      totalVol += totalVolT;
      totalMass += Math.round(totalVolT * tDensity);
      const tipo = dests.length > 0 ? (dests[0].type || t.destination_type || '') : (t.destination_type || '');
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
    if (!form.product) { toast({ title: 'Selecione um produto', variant: 'destructive' }); return; }
    if (form.origins.length === 0 || !form.origins[0].container_id) { toast({ title: 'Adicione ao menos uma origem', variant: 'destructive' }); return; }
    if (form.destinations.length === 0) { toast({ title: 'Adicione ao menos um destino', variant: 'destructive' }); return; }

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

    // Update origin containers: deduct withdrawn volume, set departure if zero
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
      }
      await base44.entities.Container.update(o.container_id, updates);
    }

    // For each Transbordo destination, create a container in Vasilhame
    // Fetch all containers to find the max registration_id (guarantees uniqueness)
    const allContainers = await base44.entities.Container.list('-created_date', 500);
    let maxRegId = 0;
    allContainers.forEach(c => { if (c.registration_id != null && c.registration_id > maxRegId) maxRegId = c.registration_id; });
    const originProductionId = form.origins[0]?.container_id
      ? (containers.find(ct => ct.id === form.origins[0].container_id)?.production_id || '')
      : '';
    for (const d of dests) {
      if (d.type === 'Transbordo') {
        maxRegId += 1;
        await base44.entities.Container.create({
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
          operator: user?.nome || user?.full_name || user?.email || '',
          status: 'No Pátio'
        });
      }
    }

      setShowForm(false); load();
      toast({ title: 'Transbordo registrado' });
      setForm({
        date: new Date().toISOString().split('T')[0], product: '', client: '',
        observations: '',
        origins: [emptyOrigin()],
        destinations: [emptyDest()]
      });
    } catch (err) {
      toast({ title: 'Erro ao registrar transbordo', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 48px)' }}>
      {/* Sidebar */}
      <div className="w-60 shrink-0 bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col gap-4 overflow-y-auto">
        <h3 className="text-sm font-bold" style={{ color: '#1A1A2E' }}>Filtros</h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Data Inicial</label>
          <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Data Final</label>
          <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo</label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="Transbordo">Transbordo</SelectItem>
              <SelectItem value="Expedição">Expedição</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(search || startDate || endDate || typeFilter !== 'all') && (
          <Button onClick={() => { setSearch(''); setStartDate(''); setEndDate(''); setTypeFilter('all'); }} variant="outline" size="sm" className="text-xs">Limpar Filtros</Button>
        )}
        <div className="mt-auto pt-4 border-t border-gray-100">
          <Button onClick={() => setShowForm(true)} style={{ background: '#2575D1' }} className="text-white w-full hover:opacity-90">
            <Plus className="w-4 h-4 mr-2" /> Novo Transbordo
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="shrink-0 p-4 border-b border-gray-100">
          <h1 className="text-xl font-bold" style={{ color: '#1A1A2E' }}>🔄 Transbordo</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} de {transfers.length} registro(s)</p>
        </div>
        <div className="flex-1 overflow-auto">
          {loading ? <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" /></div> : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhum transbordo registrado.</div>
        ) : (
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10"><tr className="border-b border-gray-50 bg-gray-50">
                <th className="px-4 py-3 text-left">Registro</th><th className="px-4 py-3 text-left">Tipo</th><th className="px-4 py-3 text-left">Data</th><th className="px-4 py-3 text-left">Produto</th>
                <th className="px-4 py-3 text-left">Cliente</th><th className="px-4 py-3 text-left">Lote</th><th className="px-4 py-3 text-right">Vol. Total (L)</th><th className="px-4 py-3 text-left">Destino</th><th className="px-4 py-3 text-center">Ações</th>
              </tr></thead>
              <tbody>
                {filtered.map((t) => {
                  const dests = parseArr(t.destinations);
                  const originsArr = parseArr(t.origins);
                  const totalVol = dests.reduce((s, d) => s + (d.volume || 0), 0) || t.volume || 0;
                  const tipo = dests.length > 0 ? (dests[0].type || t.destination_type || '—') : (t.destination_type || '—');
                  const lotTotals = {};
                  originsArr.forEach(o => { const k = o.lot || ''; lotTotals[k] = (lotTotals[k] || 0) + (parseFloat(o.volume_used) || 0); });
                  let majorityLot = '', maxLotVol = -1;
                  Object.keys(lotTotals).forEach(k => { if (lotTotals[k] > maxLotVol) { maxLotVol = lotTotals[k]; majorityLot = k; } });
                  const lote = majorityLot || '—';
                  const isTransbordo = tipo === 'Transbordo';
                  let destinoLabel;
                  if (dests.length === 0) {
                    destinoLabel = '—';
                  } else if (isTransbordo && dests.length > 1) {
                    destinoLabel = `${String(dests.length).padStart(2, '0')} x Unidades de Carga`;
                  } else {
                    destinoLabel = dests.map(d => d.placa || '—').filter(Boolean).join(', ');
                  }
                  return (
                    <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>{t.transfer_number || '—'}</td>
                      <td className="px-4 py-2.5 text-sm">{tipo}</td>
                      <td className="px-4 py-2.5 text-sm">{moment(t.date).format('DD/MM/YYYY')}</td>
                      <td className="px-4 py-2.5 font-medium text-sm">{t.product}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{t.client}</td>
                      <td className="px-4 py-2.5 text-sm">{lote}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-sm">{fmt(totalVol)}</td>
                      <td className="px-4 py-2.5 text-sm font-medium">{destinoLabel}</td>
                      <td className="px-4 py-2.5 text-center">
                        <button onClick={() => setViewTransfer(t)} className="p-1 rounded hover:bg-gray-100"><Eye className="w-3.5 h-3.5 text-muted-foreground" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        )}
        </div>

        {/* Fixed Footer */}
        <div className="shrink-0 border-t border-gray-100 bg-gray-50 px-4 py-1.5">
          <div className="flex items-center justify-between text-xs flex-wrap gap-2">
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground">Registros: <span className="font-bold" style={{ color: '#1A1A2E' }}>{stats.count}</span></span>
              <span className="text-muted-foreground">Vol. Total: <span className="font-bold" style={{ color: '#2575D1' }}>{fmt(stats.totalVol)} L</span></span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground">Transbordos: <span className="font-bold text-blue-600">{stats.transbordos}</span></span>
              <span className="text-muted-foreground">Expedições: <span className="font-bold text-green-600">{stats.expeditions}</span></span>
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-base font-semibold" style={{ color: '#1A1A2E' }}>Novo Transbordo</DialogTitle></DialogHeader>
          <div className="grid gap-5">
            {/* Dados Gerais */}
            <div>
              <h4 className="text-sm font-bold mb-3" style={{ color: '#2A5A95' }}>Dados Gerais</h4>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <FieldLabel>Data *</FieldLabel>
                  <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
                <div>
                  <FieldLabel>Produto *</FieldLabel>
                  <ProductCombobox
                    value={form.product}
                    onChange={handleProductSelect}
                    options={productOptions.map(p => ({ value: p, label: p }))}
                    placeholder="Selecione ou busque o produto..."
                  />
                </div>
                <div>
                  <FieldLabel>Cliente (automático)</FieldLabel>
                  <Input value={form.client} readOnly className="bg-gray-50 text-sm" placeholder="Automático" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div className="col-span-2">
                  <FieldLabel>Observações</FieldLabel>
                  <Input value={form.observations} onChange={e => setForm({ ...form, observations: e.target.value })} placeholder="Observações..." />
                </div>
                <div>
                  <FieldLabel>Operador (auto)</FieldLabel>
                  <Input value={user?.nome || user?.full_name || user?.email || ''} readOnly className="bg-gray-50 text-sm" />
                </div>
              </div>
            </div>

            {/* Origens */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold" style={{ color: '#2A5A95' }}>Origens (Vasilhames)</h4>
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setForm(prev => ({ ...prev, origins: [...prev.origins, emptyOrigin()] }))}>
                  <Plus className="w-3 h-3 mr-1" /> Adicionar Origem
                </Button>
              </div>
              {form.origins.map((o, idx) => (
                <div key={idx} className="grid grid-cols-4 gap-3 border rounded-lg p-3 mb-2">
                  <div>
                    <FieldLabel>Vasilhame</FieldLabel>
                    <Select value={o.container_id} onValueChange={v => handleOriginSelect(idx, v)}>
                      <SelectTrigger className="text-sm"><SelectValue placeholder="Selecionar vasilhame..." /></SelectTrigger>
                      <SelectContent>
                        {productContainers.map(c => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.container_number || '—'} - {c.barril_number || '—'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel>Lote (auto)</FieldLabel>
                    <Input value={o.lot} readOnly className="bg-gray-50 text-sm" placeholder="auto" />
                  </div>
                  <div>
                    <FieldLabel>Vol. Retirado (L)</FieldLabel>
                    <Input type="number" value={o.volume_used || ''} onChange={e => updateOrigin(idx, 'volume_used', e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <FieldLabel>Saldo Restante (L)</FieldLabel>
                    <Input value={fmt3(o.remaining_stock)} readOnly className="bg-gray-50 text-sm font-semibold" style={{ color: o.remaining_stock < 0 ? '#EF4444' : '#065F46' }} />
                  </div>
                </div>
              ))}
              {form.origins.length > 1 && (
                <Button variant="ghost" size="sm" className="text-xs text-red-500" onClick={() => setForm(prev => ({ ...prev, origins: prev.origins.slice(0, -1) }))}>
                  <Trash2 className="w-3 h-3 mr-1" /> Remover última origem
                </Button>
              )}
            </div>

            {/* Destino */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold" style={{ color: '#2A5A95' }}>Destino</h4>
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={addDestination}>
                  <Plus className="w-3 h-3 mr-1" /> Adicionar Destino
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
          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving} style={{ background: '#1B5E9C', color: 'white' }}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Registrando...</> : 'Registrar Transbordo'}
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
