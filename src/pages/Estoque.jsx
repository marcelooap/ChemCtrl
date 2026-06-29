import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Eye, Pencil, Trash2, Box, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Combobox from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { generateStockPDF } from '@/lib/pdfReports';
import moment from 'moment';

const emptyItem = { mp_name: '', mp_code: '', client: '', lot: '', supplier: '', unit: 'kg', unit_price: '', entry_date: new Date().toISOString().split('T')[0], manufacture_date: '', expiry_date: '', initial_stock: '', current_stock: '', density: '', observations: '', tank_storage: false, tank_entries: [], packaging_type: '', packaging_capacity: '', packaging_quantity: 0 };

const parseArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);

export default function Estoque() {
  const { user, isReadOnly } = useOutletContext();
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
  const [consumption, setConsumption] = useState([]);
  const [loadingConsumption, setLoadingConsumption] = useState(false);
  const [form, setForm] = useState(emptyItem);
  const [deleteTarget, setDeleteTarget] = useState(null);
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

  const openNew = () => { setEditing(null); setForm({ ...emptyItem }); setShowForm(true); };
  const openEdit = (item) => { setEditing(item); setForm({ ...item, tank_entries: item.tank_entries || (item.tank_name ? [{ tank_name: item.tank_name, volume: item.tank_volume, mass: item.tank_mass }] : []) }); setShowForm(true); };
  const openView = async (item) => {
    setViewing(item);
    setShowView(true);
    setLoadingConsumption(true);
    setConsumption([]);
    const allProductions = await base44.entities.Production.list('-created_date', 500);
    const used = [];
    allProductions.forEach(prod => {
      parseArr(prod.raw_materials_used).forEach(mp => {
        if (mp.stock_id === item.id) {
          used.push({ op_number: prod.op_number, product: prod.product, date: prod.date, qty_fiscal: mp.qty_fiscal, qty_operational: mp.qty_operational });
        }
      });
    });
    setConsumption(used);
    setLoadingConsumption(false);
  };

  const addTankEntry = () => setForm(prev => ({ ...prev, tank_entries: [...(prev.tank_entries || []), { tank_name: '', volume: '', mass: 0 }] }));
  const updateTankEntry = (idx, patch) => setForm(prev => ({ ...prev, tank_entries: (prev.tank_entries || []).map((e, i) => i === idx ? { ...e, ...patch } : e) }));
  const removeTankEntry = (idx) => setForm(prev => ({ ...prev, tank_entries: (prev.tank_entries || []).filter((_, i) => i !== idx) }));

  // Ao editar, o cálculo de qtd. de embalagens usa o saldo atual;
  // ao criar, usa o estoque inicial (que também é o saldo atual no momento).
  const stockForPackaging = () => editing ? (parseFloat(form.current_stock) || 0) : (parseFloat(form.initial_stock) || 0);

  const calcPackagingQty = (stock, capacity) => {
    const s = parseFloat(stock) || 0;
    const c = parseFloat(capacity) || 0;
    return c > 0 ? Math.round((s / c) * 100) / 100 : 0;
  };

  const save = async () => {
    const initialStock = parseFloat(form.initial_stock) || 0;
    const packagingCapacity = parseFloat(form.packaging_capacity) || 0;
    const data = { ...form, unit_price: parseFloat(form.unit_price) || 0, initial_stock: initialStock, current_stock: editing ? (parseFloat(form.current_stock) || 0) : initialStock, density: parseFloat(form.density) || 0, entry_date: form.entry_date || null, packaging_capacity: packagingCapacity, packaging_quantity: calcPackagingQty(stockForPackaging(), packagingCapacity), tank_entries: form.tank_storage ? (form.tank_entries || []).filter(te => te.tank_name).map(te => ({ tank_name: te.tank_name, volume: parseFloat(te.volume) || 0, mass: te.mass || 0 })) : [] };
    if (!data.mp_name) { toast({ title: 'Informe o nome da matéria prima', variant: 'destructive' }); return; }
    if (editing) {
      await base44.entities.RawMaterialStock.update(editing.id, data);
    } else {
      const count = items.length + 1;
      data.entry_id = `MP${String(count).padStart(3, '0')}`;
      await base44.entities.RawMaterialStock.create(data);
    }
    setShowForm(false);
    load();
    toast({ title: editing ? 'Item atualizado' : 'Novo item cadastrado' });
  };

  const remove = (item) => { setDeleteTarget(item); };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await base44.entities.RawMaterialStock.delete(deleteTarget.id);
    setDeleteTarget(null);
    load();
    toast({ title: 'Item excluído permanentemente' });
  };

  const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 });
  const fmtMoney = (n) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  const getStatus = (item) => {
    if (!item.expiry_date) return null;
    if (moment(item.expiry_date).isBefore(moment())) return 'Vencido';
    return 'Válido';
  };

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      {/* Fixed Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#1A1A2E' }}>⚗ Controle de Estoque</h1>
          <p className="text-sm text-muted-foreground">Matérias primas · {items.length} item(s)</p>
        </div>
        {!isReadOnly && (
          <Button onClick={openNew} style={{ background: '#2575D1' }} className="text-white hover:opacity-90">
            <Plus className="w-4 h-4 mr-2" /> Novo Item
          </Button>
        )}
      </div>

      {/* Card: fixed search, scrollable table, fixed footer */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar por código, nome, cliente ou lote..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={stockFilter} onValueChange={setStockFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="com_saldo">Com saldo</SelectItem>
              <SelectItem value="sem_saldo">Sem saldo</SelectItem>
            </SelectContent>
          </Select>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Cliente" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os clientes</SelectItem>
              {clientOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Scrollable Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" /></div>
          ) : (
            <table className="w-full" style={{ background: '#F9FAFB' }}>
              <thead className="sticky top-0 z-10">
                <tr style={{ background: '#F3F4F6' }}>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Reg.</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Código</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Nome</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Cliente</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Lote</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Saldo Atual</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Preço Unit. (R$)</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Custo Total (R$)</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, idx) => {
                  const zeroStock = (item.current_stock || 0) === 0;
                  const status = getStatus(item);
                  return (
                    <tr key={item.id} style={{ opacity: zeroStock ? 0.45 : 1, borderBottom: '1px solid #E5E7EB', background: '#FFFFFF' }}>
                       <td className="px-4 py-2.5 text-sm font-medium" style={{ color: '#3B82F6' }}>{item.entry_id || `#${idx + 1}`}</td>
                       <td className="px-4 py-2.5 font-mono text-sm" style={{ color: '#6B7280' }}>{item.mp_code}</td>
                       <td className="px-4 py-2.5 font-medium text-sm" style={{ color: '#333' }}>{item.mp_name}</td>
                       <td className="px-4 py-2.5 text-sm" style={{ color: '#9CA3AF' }}>{item.client || '—'}</td>
                       <td className="px-4 py-2.5 font-mono text-sm" style={{ color: '#6B7280' }}>{item.lot || '—'}</td>
                       <td className="px-4 py-2.5 text-right text-sm">
                         <span className="font-medium" style={{ color: '#333' }}>{fmt(item.current_stock)}</span>{' '}
                         <span className="font-medium" style={{ color: '#333' }}>{item.unit}</span>
                       </td>
                       <td className="px-4 py-2.5 text-right text-sm" style={{ color: '#333' }}>{(item.unit_price || 0).toFixed(4)}</td>
                       <td className="px-4 py-2.5 text-right text-sm font-semibold" style={{ color: '#065F46' }}>{fmtMoney((item.current_stock || 0) * (item.unit_price || 0))}</td>
                       <td className="px-4 py-2.5 text-center">
                         {status === null ? (
                           <span className="text-sm" style={{ color: '#9CA3AF' }}>—</span>
                         ) : status === 'Vencido' ? (
                           <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700">Vencido</span>
                         ) : (
                           <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-600 text-white">Válido</span>
                         )}
                       </td>
                       <td className="px-4 py-2.5 text-center">
                         <div className="flex items-center justify-center gap-1">
                           <button onClick={() => openView(item)} className="p-1.5 rounded hover:bg-gray-100"><Eye className="w-4 h-4 text-gray-400" /></button>
                           {!isReadOnly && <button onClick={() => openEdit(item)} className="p-1.5 rounded hover:bg-gray-100"><Pencil className="w-4 h-4 text-gray-400" /></button>}
                           {!isReadOnly && <button onClick={() => remove(item)} className="p-1.5 rounded hover:bg-gray-100"><Trash2 className="w-4 h-4 text-gray-400" /></button>}
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
          <span>Itens exibidos: {filtered.length}</span>
          <span>Qtd. total em estoque: <strong>{fmt(totalQty)}</strong> (und. mistas)</span>
          <span>Custo total MP: <strong style={{ color: '#16a34a' }}>{fmtMoney(totalCost)}</strong></span>
        </div>
      </div>

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar Item · ${editing.entry_id || ''}` : `Novo Item · Reg. ${String(items.length + 1).padStart(3, '0')}`}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            {/* Data de entrada no topo */}
            <div><label className="text-xs font-medium text-muted-foreground">Data de Entrada *</label><Input type="date" value={form.entry_date} onChange={e => setForm({ ...form, entry_date: e.target.value })} /></div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Matéria Prima * <span className="text-muted-foreground/60">(selecione ou digite)</span></label>
              <Combobox value={form.mp_name} onValueChange={v => setForm({ ...form, mp_name: v })} options={mpOptions} placeholder="Selecione uma MP cadastrada ou digite..." onSelect={handleMPSelect} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">Código</label><Input value={form.mp_code} onChange={e => setForm({ ...form, mp_code: e.target.value })} placeholder="Auto-preenchido ou digite..." /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Nome</label><Input value={form.mp_name} onChange={e => setForm({ ...form, mp_name: e.target.value })} placeholder="Auto-preenchido ou digite..." /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">Cliente</label><Input value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} placeholder="Auto-preenchido ou digite..." /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Lote</label><Input value={form.lot} onChange={e => setForm({ ...form, lot: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">Fornecedor</label><Input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Preço Unitário (R$)</label><Input type="number" step="0.0001" value={form.unit_price} onChange={e => setForm({ ...form, unit_price: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">Data de Fabricação</label><Input type="date" value={form.manufacture_date} onChange={e => setForm({ ...form, manufacture_date: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Data de Validade</label><Input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">Estoque Inicial *</label><Input type="number" value={form.initial_stock} onChange={e => setForm({ ...form, initial_stock: e.target.value })} /></div>
              {editing && (
                <div><label className="text-xs font-medium text-muted-foreground">Saldo Atual</label><Input type="number" value={form.current_stock} onChange={e => setForm({ ...form, current_stock: e.target.value })} /></div>
              )}
              {!editing && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Unidade *</label>
                  <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kg">kg</SelectItem>
                      <SelectItem value="L">L</SelectItem>
                      <SelectItem value="gal">gal</SelectItem>
                      <SelectItem value="lb">lb</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div><label className="text-xs font-medium text-muted-foreground">Observações</label><textarea className="w-full border rounded-md px-3 py-2 text-sm" rows={2} value={form.observations || ''} onChange={e => setForm({ ...form, observations: e.target.value })} placeholder="Notas adicionais..." /></div>
            <div className="border-t pt-3 mt-1">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Embalagem</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Tipo de Embalagem</label>
                  <Select value={form.packaging_type || ''} onValueChange={v => setForm({ ...form, packaging_type: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="One Way (IBC)">One Way (IBC)</SelectItem>
                      <SelectItem value="Bombona">Bombona</SelectItem>
                      <SelectItem value="Tambor">Tambor</SelectItem>
                      <SelectItem value="Sacaria">Sacaria</SelectItem>
                      <SelectItem value="Contentor">Contentor</SelectItem>
                      <SelectItem value="Tankagem">Tankagem</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Capacidade (kg)</label>
                  <Input type="number" step="0.001" value={form.packaging_capacity || ''} onChange={e => setForm({ ...form, packaging_capacity: e.target.value })} placeholder="Ex: 1000" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Qtd. Embalagens</label>
                  <Input value={calcPackagingQty(stockForPackaging(), form.packaging_capacity)} readOnly className="bg-gray-50 font-semibold" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={form.tank_storage || false} onChange={e => setForm({ ...form, tank_storage: e.target.checked, tank_entries: e.target.checked ? (form.tank_entries && form.tank_entries.length > 0 ? form.tank_entries : [{ tank_name: '', volume: '', mass: 0 }]) : [] })} className="rounded" />
              <div>
                <p className="text-sm font-medium">Descarregado em Tankagem?</p>
                <p className="text-xs text-muted-foreground">Produto será armazenado diretamente em tanques</p>
              </div>
            </div>
            {form.tank_storage && (
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 space-y-3">
                {(form.tank_entries || []).map((entry, idx) => (
                  <div key={idx} className="grid grid-cols-2 gap-3 pb-3 border-b border-blue-100 last:border-0 last:pb-0">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Tanka *</label>
                      <Select value={entry.tank_name || ''} onValueChange={v => updateTankEntry(idx, { tank_name: v })}>
                        <SelectTrigger><SelectValue placeholder="Selecione a tanka" /></SelectTrigger>
                        <SelectContent>
                          {tanks.map(t => <SelectItem key={t.id} value={t.name}>{t.name} — {t.client}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Volume (L)</label>
                      <Input type="number" step="0.001" value={entry.volume || ''} onChange={e => {
                        const vol = parseFloat(e.target.value) || 0;
                        const mass = Math.round((parseFloat(form.density) || 0) * vol);
                        updateTankEntry(idx, { volume: vol, mass });
                      }} />
                    </div>
                    <div className="col-span-2 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Massa: <strong>{(entry.mass || 0).toLocaleString('pt-BR')} kg</strong> (dens. {form.density || 0} × {entry.volume || 0} L)</span>
                      <button type="button" onClick={() => removeTankEntry(idx)} className="text-red-500 hover:text-red-700 font-medium">Remover</button>
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addTankEntry} className="w-full border-blue-200 text-blue-600 hover:bg-blue-50">
                  <Plus className="w-4 h-4 mr-1" /> Adicionar Tanka
                </Button>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={save} style={{ background: '#2575D1' }} className="text-white">
              {editing ? 'Salvar Alterações' : 'Cadastrar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Box className="w-4 h-4 text-muted-foreground" />
              <span style={{ color: '#2563eb' }}>{viewing?.entry_id}</span>
              {' · '}
              <span className="font-bold">{viewing?.mp_code}</span>
              {' – '}
              {viewing?.mp_name}
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div>
              <div className="grid grid-cols-3 gap-4 text-sm mb-5">
                <div><p className="text-xs text-muted-foreground">ID Registro</p><p className="font-medium" style={{ color: '#2563eb' }}>{viewing.entry_id}</p></div>
                <div><p className="text-xs text-muted-foreground">Data de Entrada</p><p className="font-medium">{viewing.entry_date ? moment(viewing.entry_date).format('DD/MM/YYYY') : '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Código</p><p className="font-bold">{viewing.mp_code}</p></div>
                <div><p className="text-xs text-muted-foreground">Nome</p><p className="font-medium">{viewing.mp_name}</p></div>
                <div><p className="text-xs text-muted-foreground">Cliente</p><p className="font-medium">{viewing.client || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Lote</p><p className="font-medium">{viewing.lot || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Fornecedor</p><p className="font-medium">{viewing.supplier || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Fabricação</p><p className="font-medium">{viewing.manufacture_date ? moment(viewing.manufacture_date).format('DD/MM/YYYY') : '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Validade</p><p className="font-medium">{viewing.expiry_date ? moment(viewing.expiry_date).format('DD/MM/YYYY') : '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Unidade</p><p className="font-medium">{viewing.unit}</p></div>
                <div><p className="text-xs text-muted-foreground">Estoque Inicial</p><p className="font-bold">{fmt(viewing.initial_stock)} {viewing.unit}</p></div>
                <div><p className="text-xs text-muted-foreground">Saldo Atual</p><p className="font-bold" style={{ color: '#2563eb' }}>{fmt(viewing.current_stock)} {viewing.unit}</p></div>
                <div><p className="text-xs text-muted-foreground">Preço Unitário</p><p className="font-medium">{(viewing.unit_price || 0).toFixed(4)}</p></div>
                <div><p className="text-xs text-muted-foreground">Tipo de Embalagem</p><p className="font-medium">{viewing.packaging_type || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Capacidade Embalagem</p><p className="font-medium">{fmt(viewing.packaging_capacity)} kg</p></div>
                <div><p className="text-xs text-muted-foreground">Qtd. de Embalagens</p><p className="font-medium">{fmt(viewing.packaging_quantity)}</p></div>
              </div>

              {viewing.tank_entries && viewing.tank_entries.length > 0 && (
                <div className="mb-5">
                  <h4 className="text-sm font-bold mb-2" style={{ color: '#1f2937' }}>Tankas de Destino (Recebimento)</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {viewing.tank_entries.map((te, i) => (
                      <div key={i} className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                        <p className="text-xs text-muted-foreground mb-0.5">Tanka</p>
                        <p className="font-bold text-sm" style={{ color: '#2563eb' }}>{te.tank_name}</p>
                        <div className="flex justify-between mt-2 text-xs">
                          <span className="text-muted-foreground">Volume: <strong className="text-foreground">{fmt(te.volume)} L</strong></span>
                          <span className="text-muted-foreground">Massa: <strong className="text-foreground">{fmt(te.mass)} kg</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <h4 className="text-sm font-bold mb-2" style={{ color: '#1f2937' }}>Ordens de Produção que utilizaram este lote</h4>
              {loadingConsumption ? (
                <div className="flex items-center justify-center h-16"><div className="w-5 h-5 border-2 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" /></div>
              ) : consumption.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma OP utilizou este lote ainda.</p>
              ) : (
                <table className="w-full text-sm border rounded-lg overflow-hidden">
                  <thead><tr className="text-xs font-semibold text-muted-foreground">
                    <th className="px-3 py-2 text-left">OP</th><th className="px-3 py-2 text-left">Produto</th><th className="px-3 py-2 text-left">Data</th><th className="px-3 py-2 text-right">Qtd. Fiscal</th><th className="px-3 py-2 text-right">Qtd. Op. (kg)</th>
                  </tr></thead>
                  <tbody>
                    {consumption.map((c, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2 font-medium" style={{ color: '#2563eb' }}>{c.op_number}</td>
                        <td className="px-3 py-2">{c.product}</td>
                        <td className="px-3 py-2">{moment(c.date).format('DD/MM/YYYY')}</td>
                        <td className="px-3 py-2 text-right">{fmt(c.qty_fiscal)} {viewing.unit}</td>
                        <td className="px-3 py-2 text-right">{fmt(c.qty_operational)} kg</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 bg-gray-50 font-bold">
                      <td colSpan={3} className="px-3 py-2" style={{ color: '#2563eb' }}>TOTAL CONSUMIDO</td>
                      <td className="px-3 py-2 text-right" style={{ color: '#2563eb' }}>{fmt(consumption.reduce((s, c) => s + (c.qty_fiscal || 0), 0))} {viewing.unit}</td>
                      <td className="px-3 py-2 text-right" style={{ color: '#2563eb' }}>{fmt(consumption.reduce((s, c) => s + (c.qty_operational || 0), 0))} kg</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          )}
          <div className="flex justify-between mt-4">
            <Button variant="outline" onClick={() => generateStockPDF(viewing, consumption)} className="gap-2">
              <FileText className="w-4 h-4" /> Gerar PDF
            </Button>
            <Button variant="outline" onClick={() => setShowView(false)}>Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Excluir Registro"
        message={`Tem certeza que deseja excluir o registro "${deleteTarget?.mp_name}" (Lote: ${deleteTarget?.lot || '—'})?\n\nEsta ação não pode ser desfeita. O registro será excluído permanentemente.`}
        onConfirm={confirmDelete}
        confirmLabel="Sim, excluir"
        confirmColor="#DC2626"
      />
    </div>
  );
}
