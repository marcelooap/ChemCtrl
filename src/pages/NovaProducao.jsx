import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, X } from 'lucide-react';
import moment from 'moment';

const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const convertToKg = (value, unit, density) => {
  const d = density || 1;
  switch (unit) {
    case 'kg': return value;
    case 'L': return value * d;
    case 'gal': return value * 3.78541 * d;
    case 'lb': return value * 0.453592;
    default: return value;
  }
};

const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

const convertFromKg = (kg, unit, density) => {
  const d = density || 1;
  switch (unit) {
    case 'kg': return kg;
    case 'L': return kg / d;
    case 'gal': return kg / (3.78541 * d);
    case 'lb': return kg / 0.453592;
    default: return kg;
  }
};

export default function NovaProducao() {
  const { data: recipes, loading } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500), [], (r) => ({ ...r, raw_materials: parseArr(r.raw_materials) }));
  const { data: allOrders } = useRealtimeEntity('Order', () => base44.entities.Order.list('-created_date', 500));
  const { data: stocks } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 500));
  const navigate = useNavigate();

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    product: '', client: '', recipe_id: '', recipe_revision: '',
    order_id: '', client_order: '', volume_pending: 0,
    volume: '', priority: 'Média', packaging_type: '', observations: '',
    density: '', mass: 0
  });
  const [mpList, setMpList] = useState([]);

  const orders = useMemo(() => allOrders.filter(o => o.status === 'Pendente' || o.status === 'Em produção'), [allOrders]);

  const recalculateMp = (mp, mass, density) => {
    // Use quantity_kg (base value for 5000L) directly for maximum precision.
    // Falls back to percentage if quantity_kg is not available.
    const vol = density > 0 ? mass / density : 0;
    const qtyNeededKg = (mp.quantity_kg != null && mp.quantity_kg > 0)
      ? mp.quantity_kg * (vol / 5000)
      : (mp.percentage / 100) * mass;
    let remainingKg = qtyNeededKg;
    const lots = mp.lots.map(lot => {
      if (!lot.stock_id) {
        // Antes de selecionar lote: ambos os campos em kg
        return {
          ...lot,
          qty_fiscal: round3(qtyNeededKg),
          qty_operational: round3(qtyNeededKg),
          qty_operational_raw: qtyNeededKg,
        };
      }
      const stock = stocks.find(s => s.id === lot.stock_id);
      const unit = stock?.unit || 'kg';
      const stockDensity = stock?.density || 1;
      const stockAvailableKg = convertToKg(stock?.current_stock || 0, unit, stockDensity);
      const qtyKg = Math.min(stockAvailableKg, Math.max(0, remainingKg));
      remainingKg -= qtyKg;
      // Após selecionar lote: converte fiscal para a unidade do estoque se não for kg
      const qtyFiscal = convertFromKg(qtyKg, unit, stockDensity);
      return {
        ...lot,
        qty_fiscal: round3(qtyFiscal),
        qty_operational: round3(qtyKg),
        qty_operational_raw: qtyKg,
      };
    });
    return { ...mp, lots, qty_needed_raw: qtyNeededKg };
  };

  const handleProductSelect = (productName) => {
    const recipe = recipes.find(r => r.product_name === productName);
    if (!recipe) return;
    const linkedOrder = orders.find(o => o.product === productName);
    setForm(prev => ({
      ...prev, product: productName, client: recipe.client || '',
      recipe_id: recipe.id, recipe_revision: recipe.revision || '',
      density: recipe.density || 0,
      order_id: linkedOrder?.id || '', client_order: linkedOrder?.client_order || '',
      volume_pending: linkedOrder?.volume_pending || 0,
    }));
    const mps = parseArr(recipe.raw_materials).map(m => ({
      mp_code: m.mp_code, mp_name: m.mp_name, percentage: m.percentage, mp_density: m.mp_density, quantity_kg: m.quantity_kg,
      lots: [{ stock_id: '', lot: '', qty_fiscal: 0, qty_operational: 0 }],
    }));
    setMpList(mps);
  };

  const handleVolumeChange = (rawVol) => {
    const vol = parseFloat(rawVol) || 0;
    const density = parseFloat(form.density) || 1;
    const mass = vol * density;
    setForm(prev => ({ ...prev, volume: rawVol, mass }));
    setMpList(prev => prev.map(mp => recalculateMp(mp, mass, density)));
  };

  const handleDensityChange = (rawDensity) => {
    const density = parseFloat(rawDensity) || 0;
    const vol = parseFloat(form.volume) || 0;
    const mass = vol * density;
    setForm(prev => ({ ...prev, density: rawDensity, mass }));
    setMpList(prev => prev.map(mp => recalculateMp(mp, mass, density)));
  };

  const handleLotSelect = (mpIdx, lotIdx, stockId) => {
    const stock = stocks.find(s => s.id === stockId);
    setMpList(prev => {
      const updated = [...prev];
      const lots = [...updated[mpIdx].lots];
      lots[lotIdx] = { ...lots[lotIdx], stock_id: stockId, lot: stock?.lot || '' };
      updated[mpIdx] = { ...updated[mpIdx], lots };
      const recalculated = updated.map((mp, i) => i === mpIdx ? recalculateMp(mp, form.mass, parseFloat(form.density) || 1) : mp);

      // Auto-add new lot row if this lot doesn't have enough stock
      const mp = recalculated[mpIdx];
      const totalUsed = mp.lots.reduce((s, l) => s + (l.qty_operational_raw || l.qty_operational || 0), 0);
      const neededKg = mp.qty_needed_raw || 0;
      const diff = neededKg - totalUsed;
      const isLastLot = lotIdx === mp.lots.length - 1;
      if (isLastLot && diff > 0.001) {
        recalculated[mpIdx] = {
          ...mp,
          lots: [...mp.lots, { stock_id: '', lot: '', qty_fiscal: 0, qty_operational: 0 }],
        };
      }
      return recalculated;
    });
  };

  const handleQtyFiscalChange = (mpIdx, lotIdx, rawVal) => {
    const val = parseFloat(rawVal) || 0;
    setMpList(prev => {
      const updated = [...prev];
      const lots = [...updated[mpIdx].lots];
      const lot = { ...lots[lotIdx] };
      lot.qty_fiscal = round3(val);
      const stock = lot.stock_id ? stocks.find(s => s.id === lot.stock_id) : null;
      const unit = stock?.unit || 'kg';
      const stockDensity = stock?.density || 1;
      const kg = convertToKg(val, unit, stockDensity);
      lot.qty_operational = round3(kg);
      lot.qty_operational_raw = kg;
      lots[lotIdx] = lot;
      updated[mpIdx] = { ...updated[mpIdx], lots };
      return updated;
    });
  };

  const handleQtyOperationalChange = (mpIdx, lotIdx, rawVal) => {
    const val = parseFloat(rawVal) || 0;
    setMpList(prev => {
      const updated = [...prev];
      const lots = [...updated[mpIdx].lots];
      const lot = { ...lots[lotIdx] };
      lot.qty_operational = round3(val);
      lot.qty_operational_raw = val;
      const stock = lot.stock_id ? stocks.find(s => s.id === lot.stock_id) : null;
      const unit = stock?.unit || 'kg';
      const stockDensity = stock?.density || 1;
      const fiscal = convertFromKg(val, unit, stockDensity);
      lot.qty_fiscal = round3(fiscal);
      lots[lotIdx] = lot;
      updated[mpIdx] = { ...updated[mpIdx], lots };
      return updated;
    });
  };

  const addLot = (mpIdx) => {
    setMpList(prev => {
      const n = [...prev];
      n[mpIdx] = { ...n[mpIdx], lots: [...n[mpIdx].lots, { stock_id: '', lot: '', qty_fiscal: 0, qty_operational: 0 }] };
      return n;
    });
  };

  const removeLot = (mpIdx, lotIdx) => {
    setMpList(prev => {
      const updated = [...prev];
      const lots = updated[mpIdx].lots.filter((_, i) => i !== lotIdx);
      const newLots = lots.length ? lots : [{ stock_id: '', lot: '', qty_fiscal: 0, qty_operational: 0 }];
      updated[mpIdx] = { ...updated[mpIdx], lots: newLots };
      return updated.map((mp, i) => i === mpIdx ? recalculateMp(mp, form.mass, parseFloat(form.density) || 1) : mp);
    });
  };

  const totalOperationQty = round3(mpList.reduce((s, mp) => s + mp.lots.filter(l => l.stock_id).reduce((ls, l) => ls + (l.qty_operational_raw || l.qty_operational || 0), 0), 0));
  const totalNeeded = round3(mpList.reduce((s, mp) => s + (mp.qty_needed_raw || 0), 0));
  const massDiff = round3(totalOperationQty - totalNeeded);
  const massOk = Math.abs(massDiff) < 0.01 && form.mass > 0;

  const fmt3 = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const save = async () => {
    if (!form.product || !form.volume) return;
    if (!massOk) return;

    const volNum = parseFloat(form.volume) || 0;
    const densityNum = parseFloat(form.density) || 0;

    // Auto-register logged-in user as operator
    let operatorName = '';
    try {
      const user = await base44.auth.me();
      operatorName = user?.nome || user?.full_name || user?.email || '';
    } catch (_) {}

    for (const mp of mpList) {
      for (const lot of mp.lots) {
        if (lot.stock_id) {
          const stock = stocks.find(s => s.id === lot.stock_id);
          if (stock && (stock.current_stock || 0) < (lot.qty_fiscal || 0)) return;
        }
      }
    }

    const allProductions = await base44.entities.Production.list('-created_date', 500);
    const nextNum = allProductions.length + 1;
    const lotNumber = `${moment().format('YYMMDD')}-${String(nextNum).padStart(3, '0')}`;

    const { volume_pending, order_id, client_order, ...productionFields } = form;
    const data = {
      ...productionFields,
      date: new Date(form.date).toISOString(),
      volume: volNum,
      density: densityNum,
      op_number: `OP${String(nextNum).padStart(2, '0')}`,
      lot: lotNumber,
      status: 'Aguardando Início',
      operator: operatorName,
      order_id: form.order_id,
      client_order: form.client_order,
      unit_price: recipes.find(r => r.id === form.recipe_id)?.price || 0,
      total_value: (volNum * densityNum) * (recipes.find(r => r.id === form.recipe_id)?.price || 0),
      raw_materials_used: mpList.flatMap(m =>
        m.lots.filter(l => l.stock_id).map(l => ({
          mp_code: m.mp_code, mp_name: m.mp_name, stock_id: l.stock_id,
          lot: l.lot, qty_fiscal: l.qty_fiscal, qty_operational: l.qty_operational, checked: false
        }))
      ),
    };

    await base44.entities.Production.create(data);

    // Update linked order status to "Em produção"
    if (form.order_id) {
      await base44.entities.Order.update(form.order_id, { status: 'Em produção' });
    }

    // Deduct stock by stock_id (aggregating same stock used in multiple lots)
    const stockDeductions = {};
    for (const mp of mpList) {
      for (const lot of mp.lots) {
        if (lot.stock_id && lot.qty_fiscal > 0) {
          stockDeductions[lot.stock_id] = (stockDeductions[lot.stock_id] || 0) + lot.qty_fiscal;
        }
      }
    }
    for (const [stockId, totalDeduction] of Object.entries(stockDeductions)) {
      const stock = stocks.find(s => s.id === stockId);
      if (stock) {
        const newStock = parseFloat(((stock.current_stock || 0) - totalDeduction).toFixed(3));
        await base44.entities.RawMaterialStock.update(stockId, { current_stock: newStock });
      }
    }

    navigate('/ordens');
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" /></div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#1A1A2E' }}>Nova Produção</h1>
        <p className="text-sm text-muted-foreground">Registre uma nova ordem de produção.</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: '#1A1A2E' }}>Dados da Produção</h3>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div><label className="text-xs font-medium text-muted-foreground">Data *</label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Produto Acabado *</label>
            <Select value={form.product} onValueChange={handleProductSelect}>
              <SelectTrigger><SelectValue placeholder="Selecione o produto..." /></SelectTrigger>
              <SelectContent>
                {recipes.map(r => <SelectItem key={r.id} value={r.product_name}>{r.product_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><label className="text-xs font-medium text-muted-foreground">Cliente</label><Input value={form.client} readOnly className="bg-gray-50" /></div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div><label className="text-xs font-medium text-muted-foreground">Revisão da Receita</label><Input value={form.recipe_revision} readOnly className="bg-gray-50" /></div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Pedido Vinculado</label>
            <Select value={form.order_id} onValueChange={v => {
              const o = orders.find(ord => ord.id === v);
              setForm(prev => ({ ...prev, order_id: v, client_order: o?.client_order || '' }));
            }}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {orders.filter(o => o.product === form.product).map(o => (
                  <SelectItem key={o.id} value={o.id}>{o.order_number} - {o.product}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><label className="text-xs font-medium text-muted-foreground">Ped. Cliente</label><Input value={form.client_order} readOnly className="bg-gray-50" /></div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div><label className="text-xs font-medium text-muted-foreground">Volume Pendente (L)</label><Input value={form.volume_pending || '—'} readOnly className="bg-gray-50" /></div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Prioridade</label>
            <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Baixa">Baixa</SelectItem>
                <SelectItem value="Média">Média</SelectItem>
                <SelectItem value="Alta">Alta</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><label className="text-xs font-medium text-muted-foreground">Volume desta OP (L) *</label><Input type="number" value={form.volume} onChange={e => handleVolumeChange(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div><label className="text-xs font-medium text-muted-foreground">Densidade (g/mL)</label><Input type="number" step="0.001" value={form.density} onChange={e => handleDensityChange(e.target.value)} /></div>
          <div><label className="text-xs font-medium text-muted-foreground">Massa (kg) — calculado</label><Input value={form.mass.toFixed(3)} readOnly className="bg-gray-50" /></div>
          <div><label className="text-xs font-medium text-muted-foreground">Embalagem de Destino</label><Input value={form.packaging_type} onChange={e => setForm({ ...form, packaging_type: e.target.value })} placeholder="Ex: Tambor 200L, IBC 1000L..." /></div>
        </div>
        <div className="mb-6">
          <label className="text-xs font-medium text-muted-foreground">Observações</label>
          <textarea className="w-full border rounded-md px-3 py-2 text-sm mt-1" rows={2} value={form.observations} onChange={e => setForm({ ...form, observations: e.target.value })} />
        </div>

        {/* MP Allocation */}
        {mpList.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold mb-3" style={{ color: '#1A1A2E' }}>Apontamento de Matérias Primas</h3>
            <p className="text-xs text-muted-foreground mb-3">As quantidades são calculadas em kg automaticamente. Ao selecionar o lote, a Qtd. Fiscal converte para a unidade do estoque. Use "+ Lote" para misturar lotes.</p>
            <div className="space-y-4">
              {mpList.map((mp, idx) => {
                const totalUsed = mp.lots.reduce((s, l) => s + (l.qty_operational_raw || l.qty_operational || 0), 0);
                return (
                  <div key={idx} className="border rounded-lg overflow-hidden bg-white">
                    {/* Header */}
                    <div className="px-4 py-2 flex items-center gap-3 border-b bg-gray-50/50 flex-wrap">
                      <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: '#E0E7FF', color: '#4338CA' }}>{mp.mp_code}</span>
                      <span className="text-sm font-semibold">{mp.mp_name}</span>
                      <span className="text-xs text-muted-foreground">%m/m: {(mp.percentage || 0).toFixed(8)}%</span>
                      {mp.mp_density && <span className="text-xs text-muted-foreground">p={mp.mp_density} g/mL</span>}
                      <span className="ml-auto text-xs font-bold">Total usado: {fmt3(totalUsed)} kg</span>
                    </div>
                    {/* Lot rows */}
                    <div className="p-3 space-y-3">
                      {mp.lots.map((lot, lotIdx) => {
                        const stock = stocks.find(s => s.id === lot.stock_id);
                        const totalUsedFromStock = stock
                          ? mp.lots.filter(l => l.stock_id === lot.stock_id).reduce((s, l) => s + (l.qty_fiscal || 0), 0)
                          : 0;
                        const remaining = stock ? (stock.current_stock || 0) - totalUsedFromStock : 0;
                        // Excluir lotes já selecionados em outras linhas da mesma MP
                        const usedStockIds = mp.lots.filter((_, li) => li !== lotIdx).map(l => l.stock_id).filter(Boolean);
                        const availableStocks = stocks.filter(s =>
                          (s.mp_name === mp.mp_name || s.mp_code === mp.mp_code) && !usedStockIds.includes(s.id)
                        );
                        return (
                          <div key={lotIdx} className="grid grid-cols-12 gap-2 items-start">
                            <div className="col-span-4">
                              <label className="text-xs text-muted-foreground">Lote</label>
                              <Select value={lot.stock_id} onValueChange={v => handleLotSelect(idx, lotIdx, v)}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar lote..." /></SelectTrigger>
                                <SelectContent>
                                  {availableStocks.map(s => (
                                    <SelectItem key={s.id} value={s.id}>{s.lot} — Saldo: {fmt3(s.current_stock)} {s.unit}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {stock && (
                                <p className="text-xs mt-1" style={{ color: remaining >= 0 ? '#15803d' : '#dc2626' }}>
                                  Restará: {fmt3(remaining)} {stock.unit}
                                </p>
                              )}
                            </div>
                            <div className="col-span-3">
                              <label className="text-xs text-muted-foreground">Qtd. Fiscal ({stock?.unit || 'kg'})</label>
                              <Input type="number" step="0.001" value={lot.qty_fiscal} onChange={e => handleQtyFiscalChange(idx, lotIdx, e.target.value)} className="h-8 text-xs" />
                            </div>
                            <div className="col-span-3">
                              <label className="text-xs text-muted-foreground">Qtd. Operação (kg)</label>
                              <Input type="number" step="0.001" value={lot.qty_operational} onChange={e => handleQtyOperationalChange(idx, lotIdx, e.target.value)} className="h-8 text-xs" />
                            </div>
                            <div className="col-span-2 flex items-end justify-end gap-1 h-8">
                              {lot.stock_id && (
                                <Button variant="ghost" size="sm" onClick={() => removeLot(idx, lotIdx)} className="h-8 text-xs text-red-500"><X className="w-3 h-3" /></Button>
                              )}
                              {lotIdx === mp.lots.length - 1 && (
                                <Button variant="outline" size="sm" onClick={() => addLot(idx)} className="h-8 text-xs">+ Lote</Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary footer */}
            <div className="mt-4 border rounded-lg px-4 py-3 flex items-center gap-2 text-sm" style={{ background: '#f0fdf4', borderColor: '#22c55e' }}>
              <span>Somatório Qtd. Operação: <strong>{fmt3(totalOperationQty)}</strong> kg / Total Necessário: <strong>{fmt3(totalNeeded)}</strong> kg</span>
              {massOk ? (
                <span className="ml-auto flex items-center gap-1 font-semibold text-green-700">✓ Balanço OK</span>
              ) : (
                <span className="ml-auto flex items-center gap-1 font-semibold text-amber-600">⚠ Diferença: {fmt3(Math.abs(massDiff))} kg</span>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="outline" onClick={() => { setForm({ ...form, product: '', client: '', volume: 0, mass: 0 }); setMpList([]); }}>Limpar</Button>
          <Button onClick={save} disabled={!massOk} style={{ background: massOk ? '#2575D1' : '#94a3b8' }} className="text-white hover:opacity-90">Registrar Ordem de Produção</Button>
        </div>
      </div>
    </div>
  );
}
