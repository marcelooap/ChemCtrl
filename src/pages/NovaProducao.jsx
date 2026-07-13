import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ProductCombobox from '@/components/ui/ProductCombobox';
import { X, Loader2 } from 'lucide-react';
import moment from 'moment';
import LoadingOverlay from '@/components/ui/LoadingOverlay';
import { generatePublicToken } from '@/lib/publicToken';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { NotificationService } from '@/notifications/services/NotificationService';
import { fmtNumber } from '@/i18n/formatters';
import { translatePriority } from '@/i18n/domainMaps';
import { useToast } from '@/components/ui/use-toast';
import {
  parseArr,
  calcMassBalance,
  canSaveStandard,
  canSaveFractional,
  calcVolumeMetrics,
  buildSupplyHistoryEntry,
  flattenAllocatedLots,
  calcMpDeficits,
  mpQtyNeededKg,
} from '@/lib/fractionalSupply';

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

const groupUsedIntoMpList = (used, recipe) => {
  const rawMaterials = parseArr(recipe?.raw_materials);
  const map = new Map();
  for (const rm of rawMaterials) {
    map.set(rm.mp_code, {
      mp_code: rm.mp_code,
      mp_name: rm.mp_name,
      percentage: rm.percentage,
      mp_density: rm.mp_density,
      quantity_kg: rm.quantity_kg,
      lots: [],
      locked: true,
    });
  }
  for (const u of used) {
    if (!map.has(u.mp_code)) {
      map.set(u.mp_code, {
        mp_code: u.mp_code,
        mp_name: u.mp_name,
        lots: [],
        locked: true,
      });
    }
    map.get(u.mp_code).lots.push({
      stock_id: u.stock_id,
      lot: u.lot,
      qty_fiscal: u.qty_fiscal,
      qty_operational: u.qty_operational,
      qty_operational_raw: u.qty_operational,
      locked: true,
    });
  }
  return Array.from(map.values());
};

export default function NovaProducao() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const complementId = searchParams.get('complement');
  const isComplementMode = !!complementId;

  const { data: recipes, loading } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500), [], (r) => ({ ...r, raw_materials: parseArr(r.raw_materials) }));
  const { data: allOrders } = useRealtimeEntity('Order', () => base44.entities.Order.list('-created_date', 500));
  const { data: stocks } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 500));
  const navigate = useNavigate();
  const { user: internalUser } = useInternalAuth();

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    product: '', client: '', recipe_id: '', recipe_revision: '',
    order_id: '', client_order: '', volume_pending: 0,
    volume: '', priority: 'Média', packaging_type: '', observations: '',
    density: '', mass: 0
  });
  const [mpList, setMpList] = useState([]);
  const [deficitMpList, setDeficitMpList] = useState([]);
  const [complementProduction, setComplementProduction] = useState(null);
  const [complementRecipe, setComplementRecipe] = useState(null);
  const [complementLoading, setComplementLoading] = useState(isComplementMode);
  const [fractionalSupply, setFractionalSupply] = useState(false);
  const [saving, setSaving] = useState(false);

  const orders = useMemo(() => allOrders.filter(o => o.status === 'Pendente' || o.status === 'Em produção'), [allOrders]);

  useEffect(() => {
    if (!isComplementMode || !complementId) return;
    let cancelled = false;
    setComplementLoading(true);

    (async () => {
      try {
        const prod = await base44.entities.Production.get(complementId);
        if (cancelled) return;
        if (!prod?.fractional_supply || prod.complement_status === 'Completa') {
          toast({ title: t('common.error'), description: t('production.fractional.validationExceeds'), variant: 'destructive' });
          navigate('/producoes');
          return;
        }

        let recipe = null;
        if (prod.recipe_id) {
          try {
            const fetched = await base44.entities.Recipe.get(prod.recipe_id);
            recipe = fetched ? { ...fetched, raw_materials: parseArr(fetched.raw_materials) } : null;
          } catch {
            recipe = null;
          }
        }
        if (!recipe) {
          const cached = recipes.find(r => r.id === prod.recipe_id) || recipes.find(r => r.product_name === prod.product);
          recipe = cached ? { ...cached, raw_materials: parseArr(cached.raw_materials) } : null;
        }

        setComplementProduction(prod);
        setComplementRecipe(recipe);
        setForm({
          date: prod.date ? moment(prod.date).format('YYYY-MM-DD') : new Date().toISOString().split('T')[0],
          product: prod.product || '',
          client: prod.client || '',
          recipe_id: prod.recipe_id || recipe?.id || '',
          recipe_revision: prod.recipe_revision || '',
          order_id: prod.order_id || '',
          client_order: prod.client_order || '',
          volume_pending: 0,
          volume: String(prod.volume || ''),
          priority: prod.priority || 'Média',
          packaging_type: prod.packaging_type || '',
          observations: prod.observations || '',
          density: String(prod.density || ''),
          mass: prod.mass || (prod.volume || 0) * (prod.density || 1),
        });
        setMpList(groupUsedIntoMpList(parseArr(prod.raw_materials_used), recipe));
      } catch {
        if (!cancelled) navigate('/producoes');
      } finally {
        if (!cancelled) setComplementLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isComplementMode, complementId, navigate, toast, t]);

  useEffect(() => {
    if (!isComplementMode || !complementProduction || !complementRecipe) return;
    setDeficitMpList(calcMpDeficits(complementRecipe, complementProduction, stocks));
  }, [isComplementMode, complementProduction, complementRecipe, stocks]);

  const recalculateMp = (mp, mass, density) => {
    const vol = density > 0 ? mass / density : 0;
    const qtyNeededKg = mpQtyNeededKg(mp, mass, density);
    let remainingKg = qtyNeededKg;
    const lots = mp.lots.map(lot => {
      if (lot.locked) return lot;
      if (!lot.stock_id) {
        const remKg = Math.max(0, remainingKg);
        return {
          ...lot,
          qty_fiscal: round3(remKg),
          qty_operational: round3(remKg),
          qty_operational_raw: remKg,
        };
      }
      const stock = stocks.find(s => s.id === lot.stock_id);
      const unit = stock?.unit || 'kg';
      const d = mp.mp_density || stock?.density || 1;
      const stockAvailableKg = convertToKg(stock?.current_stock || 0, unit, d);
      const qtyKg = Math.min(stockAvailableKg, Math.max(0, remainingKg));
      remainingKg -= qtyKg;
      const qtyFiscal = convertFromKg(qtyKg, unit, d);
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
    if (isComplementMode) return;
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
    if (isComplementMode) return;
    const vol = parseFloat(rawVol) || 0;
    const density = parseFloat(form.density) || 1;
    const mass = vol * density;
    setForm(prev => ({ ...prev, volume: rawVol, mass }));
    setMpList(prev => prev.map(mp => recalculateMp(mp, mass, density)));
  };

  const handleDensityChange = (rawDensity) => {
    if (isComplementMode) return;
    const density = parseFloat(rawDensity) || 0;
    const vol = parseFloat(form.volume) || 0;
    const mass = vol * density;
    setForm(prev => ({ ...prev, density: rawDensity, mass }));
    setMpList(prev => prev.map(mp => recalculateMp(mp, mass, density)));
  };

  const handleLotSelect = (mpIdx, lotIdx, stockId, listSetter, list) => {
    const stock = stocks.find(s => s.id === stockId);
    listSetter(prev => {
      const updated = [...prev];
      const lots = [...updated[mpIdx].lots];
      lots[lotIdx] = { ...lots[lotIdx], stock_id: stockId, lot: stock?.lot || '' };
      updated[mpIdx] = { ...updated[mpIdx], lots };
      const mass = form.mass;
      const density = parseFloat(form.density) || 1;
      const recalculated = updated.map((mp, i) => i === mpIdx ? recalculateMp(mp, mass, density) : mp);

      const mp = recalculated[mpIdx];
      const totalUsed = mp.lots.reduce((s, l) => s + (l.qty_operational_raw || l.qty_operational || 0), 0);
      const neededKg = mp.deficit_kg ?? mp.qty_needed_raw ?? 0;
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

  const handleQtyFiscalChange = (mpIdx, lotIdx, rawVal, listSetter) => {
    const val = parseFloat(rawVal) || 0;
    listSetter(prev => {
      const updated = [...prev];
      const lots = [...updated[mpIdx].lots];
      const lot = { ...lots[lotIdx] };
      if (lot.locked) return prev;
      lot.qty_fiscal = round3(val);
      const mp = updated[mpIdx];
      const stock = lot.stock_id ? stocks.find(s => s.id === lot.stock_id) : null;
      const unit = stock?.unit || 'kg';
      const d = mp.mp_density || stock?.density || 1;
      const kg = convertToKg(val, unit, d);
      lot.qty_operational = round3(kg);
      lot.qty_operational_raw = kg;
      lots[lotIdx] = lot;
      updated[mpIdx] = { ...updated[mpIdx], lots };
      return updated;
    });
  };

  const handleQtyOperationalChange = (mpIdx, lotIdx, rawVal, listSetter, maxKg) => {
    let val = parseFloat(rawVal) || 0;
    if (maxKg != null) val = Math.min(val, maxKg);
    listSetter(prev => {
      const updated = [...prev];
      const lots = [...updated[mpIdx].lots];
      const lot = { ...lots[lotIdx] };
      if (lot.locked) return prev;
      lot.qty_operational = round3(val);
      lot.qty_operational_raw = val;
      const mp = updated[mpIdx];
      const stock = lot.stock_id ? stocks.find(s => s.id === lot.stock_id) : null;
      const unit = stock?.unit || 'kg';
      const d = mp.mp_density || stock?.density || 1;
      const fiscal = convertFromKg(val, unit, d);
      lot.qty_fiscal = round3(fiscal);
      lots[lotIdx] = lot;
      updated[mpIdx] = { ...updated[mpIdx], lots };
      return updated;
    });
  };

  const addLot = (mpIdx, listSetter) => {
    listSetter(prev => {
      const n = [...prev];
      n[mpIdx] = { ...n[mpIdx], lots: [...n[mpIdx].lots, { stock_id: '', lot: '', qty_fiscal: 0, qty_operational: 0 }] };
      return n;
    });
  };

  const removeLot = (mpIdx, lotIdx, listSetter) => {
    listSetter(prev => {
      const updated = [...prev];
      const lots = updated[mpIdx].lots.filter((_, i) => i !== lotIdx);
      const newLots = lots.length ? lots : [{ stock_id: '', lot: '', qty_fiscal: 0, qty_operational: 0 }];
      updated[mpIdx] = { ...updated[mpIdx], lots: newLots };
      return updated.map((mp, i) => i === mpIdx ? recalculateMp(mp, form.mass, parseFloat(form.density) || 1) : mp);
    });
  };

  const balance = calcMassBalance(isComplementMode ? [...mpList, ...deficitMpList] : mpList);
  const { totalOperationQty, totalNeeded, massDiff } = balance;
  const massOk = fractionalSupply
    ? canSaveFractional(balance, form.mass, mpList)
    : canSaveStandard(balance, form.mass, mpList);

  const complementNewQty = deficitMpList.reduce(
    (s, mp) => s + mp.lots.filter(l => l.stock_id).reduce((ls, l) => ls + (l.qty_operational_raw ?? l.qty_operational ?? 0), 0),
    0
  );
  const complementCanSave = isComplementMode && complementNewQty > 0 && !deficitMpList.some(mp => {
    const newKg = mp.lots.filter(l => l.stock_id).reduce((s, l) => s + (l.qty_operational_raw ?? l.qty_operational ?? 0), 0);
    return newKg > mp.deficit_kg + 0.001 || mp.lots.some(l => l.stock_id && (l.qty_operational_raw ?? l.qty_operational ?? 0) < 0);
  });

  const pendingVolumeL = fractionalSupply && !isComplementMode
    ? calcVolumeMetrics(form.volume, totalOperationQty, totalNeeded).volume_pendente
    : 0;

  const fmt3 = (n) => fmtNumber(n, { minimumFractionDigits: 3, maximumFractionDigits: 3 }, i18n.language);

  const deductStock = async (lotsSource) => {
    const stockDeductions = {};
    for (const mp of lotsSource) {
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
  };

  const save = async () => {
    if (!form.product || !form.volume) return;
    if (!massOk) return;
    setSaving(true);
    const volNum = parseFloat(form.volume) || 0;
    const densityNum = parseFloat(form.density) || 0;
    const operatorName = internalUser?.nome_completo || internalUser?.nome || internalUser?.full_name || '';

    try {
      for (const mp of mpList) {
        for (const lot of mp.lots) {
          if (lot.stock_id) {
            const stock = stocks.find(s => s.id === lot.stock_id);
            if (stock && (stock.current_stock || 0) < (lot.qty_fiscal || 0)) { setSaving(false); return; }
          }
        }
      }

      const allProductions = await base44.entities.Production.list('-created_date', 500);
      const nextNum = allProductions.length + 1;
      const lotNumber = `${moment().format('YYMMDD')}-${String(nextNum).padStart(3, '0')}`;
      const allocatedLots = flattenAllocatedLots(mpList);
      const metrics = calcVolumeMetrics(volNum, totalOperationQty, totalNeeded);

      const { volume_pending, order_id, client_order, ...productionFields } = form;
      const data = {
        ...productionFields,
        date: new Date(form.date).toISOString(),
        volume: volNum,
        density: densityNum,
        op_number: `OP${String(nextNum).padStart(2, '0')}`,
        lot: lotNumber,
        public_token: generatePublicToken(),
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

      if (fractionalSupply) {
        data.fractional_supply = true;
        data.volume_apontado = metrics.volume_apontado;
        data.volume_pendente = metrics.volume_pendente;
        data.complement_status = metrics.volume_pendente > 0.001 ? 'Pendente' : 'Completa';
        data.supply_complements = [buildSupplyHistoryEntry('initial', operatorName, allocatedLots)];
      }

      const created = await base44.entities.Production.create(data);
      await NotificationService.productionCreated({
        id: created?.id,
        op_number: created?.op_number || data.op_number,
        client: created?.client || data.client,
      });

      if (form.order_id) {
        await base44.entities.Order.update(form.order_id, { status: 'Em produção' });
      }

      await deductStock(mpList);
      navigate('/ordens');
    } finally {
      setSaving(false);
    }
  };

  const saveComplement = async () => {
    if (!complementCanSave || !complementProduction) return;
    setSaving(true);
    const operatorName = internalUser?.nome_completo || internalUser?.nome || internalUser?.full_name || '';

    try {
      for (const mp of deficitMpList) {
        for (const lot of mp.lots) {
          if (lot.stock_id) {
            const stock = stocks.find(s => s.id === lot.stock_id);
            if (stock && (stock.current_stock || 0) < (lot.qty_fiscal || 0)) {
              toast({ title: t('common.error'), variant: 'destructive' });
              setSaving(false);
              return;
            }
          }
        }
      }

      const newLots = deficitMpList.flatMap(m =>
        m.lots.filter(l => l.stock_id).map(l => ({
          mp_code: m.mp_code,
          mp_name: m.mp_name,
          stock_id: l.stock_id,
          lot: l.lot,
          qty_fiscal: l.qty_fiscal,
          qty_operational: l.qty_operational,
        }))
      );

      const pastProduction = !['Aguardando Início', 'Em Produção'].includes(complementProduction.status);
      const existingUsed = parseArr(complementProduction.raw_materials_used);
      const appended = newLots.map(l => ({
        ...l,
        checked: pastProduction,
      }));

      const allUsed = [...existingUsed, ...appended];
      const recipe = complementRecipe || recipes.find(r => r.id === complementProduction.recipe_id);
      const mass = complementProduction.mass || (complementProduction.volume || 0) * (complementProduction.density || 1);
      const totalNeededAll = parseArr(recipe?.raw_materials).reduce(
        (s, rm) => s + mpQtyNeededKg(rm, mass, complementProduction.density || 1),
        0
      );
      const totalOpAll = allUsed.reduce((s, u) => s + (u.qty_operational || 0), 0);
      const metrics = calcVolumeMetrics(complementProduction.volume, totalOpAll, totalNeededAll);
      const history = parseArr(complementProduction.supply_complements);
      history.push(buildSupplyHistoryEntry('complement', operatorName, newLots));

      await base44.entities.Production.update(complementProduction.id, {
        raw_materials_used: allUsed,
        volume_apontado: metrics.volume_apontado,
        volume_pendente: metrics.volume_pendente,
        complement_status: metrics.volume_pendente > 0.001 ? 'Pendente' : 'Completa',
        supply_complements: history,
      });

      await deductStock(deficitMpList);
      toast({ title: t('production.fractional.complementSuccess') });
      navigate('/producoes');
    } catch (err) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const renderLotRows = (list, listSetter, { readOnly = false, maxKgByMp = null } = {}) => (
    <div className="space-y-4">
      {list.map((mp, idx) => {
        const totalUsed = mp.lots.reduce((s, l) => s + (l.qty_operational_raw || l.qty_operational || 0), 0);
        const maxKg = maxKgByMp ? (mp.deficit_kg ?? null) : null;
        return (
          <div key={idx} className="border rounded-lg overflow-hidden bg-card">
            <div className="px-4 py-2 flex items-center gap-3 border-b bg-muted/50/50 flex-wrap">
              <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: '#E0E7FF', color: '#4338CA' }}>{mp.mp_code}</span>
              <span className="text-sm font-semibold">{mp.mp_name}</span>
              {mp.deficit_kg != null && (
                <span className="text-xs text-amber-700 font-medium">
                  {t('production.fractional.remainingQty', { volume: fmt3(mp.deficit_volume_l), mass: fmt3(mp.deficit_kg) })}
                </span>
              )}
              {!mp.deficit_kg && (
                <span className="ml-auto text-xs font-bold">{t('production.newProduction.totalUsed', { value: fmt3(totalUsed) })}</span>
              )}
            </div>
            <div className="p-3 space-y-3">
              {mp.lots.map((lot, lotIdx) => {
                const stock = stocks.find(s => s.id === lot.stock_id);
                const isLocked = readOnly || lot.locked;
                const usedStockIds = mp.lots.filter((_, li) => li !== lotIdx).map(l => l.stock_id).filter(Boolean);
                const availableStocks = stocks.filter(s =>
                  s.mp_code === mp.mp_code && !usedStockIds.includes(s.id) && (s.current_stock || 0) > 0
                );
                return (
                  <div key={lotIdx} className="grid grid-cols-12 gap-2 items-start">
                    <div className="col-span-4">
                      <label className="text-xs text-muted-foreground">{t('common.lot')}</label>
                      {isLocked ? (
                        <Input value={lot.lot || stock?.lot || t('common.notAvailable')} readOnly className="h-8 text-xs bg-muted/50" />
                      ) : (
                        <Select value={lot.stock_id} onValueChange={v => handleLotSelect(idx, lotIdx, v, listSetter, list)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('production.newProduction.selectLot')} /></SelectTrigger>
                          <SelectContent>
                            {availableStocks.map(s => (
                              <SelectItem key={s.id} value={s.id}>{t('production.newProduction.lotOption', { id: s.entry_id || s.id, lot: s.lot, balance: fmt3(s.current_stock), unit: s.unit })}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div className="col-span-3">
                      <label className="text-xs text-muted-foreground">{t('production.checklist.qtyFiscal')} ({stock?.unit || 'kg'})</label>
                      <Input type="number" step="0.001" value={lot.qty_fiscal} readOnly={isLocked} onChange={e => handleQtyFiscalChange(idx, lotIdx, e.target.value, listSetter)} className={`h-8 text-xs ${isLocked ? 'bg-muted/50' : ''}`} />
                    </div>
                    <div className="col-span-3">
                      <label className="text-xs text-muted-foreground">{t('production.checklist.qtyOperational')} (kg)</label>
                      <Input type="number" step="0.001" value={lot.qty_operational} readOnly={isLocked} onChange={e => handleQtyOperationalChange(idx, lotIdx, e.target.value, listSetter, maxKg)} className={`h-8 text-xs ${isLocked ? 'bg-muted/50' : ''}`} />
                    </div>
                    <div className="col-span-2 flex items-end justify-end gap-1 h-8">
                      {!isLocked && lot.stock_id && (
                        <Button variant="ghost" size="sm" onClick={() => removeLot(idx, lotIdx, listSetter)} className="h-8 text-xs text-red-500"><X className="w-3 h-3" /></Button>
                      )}
                      {!isLocked && lotIdx === mp.lots.length - 1 && (
                        <Button variant="outline" size="sm" onClick={() => addLot(idx, listSetter)} className="h-8 text-xs">{t('production.newProduction.addLot')}</Button>
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
  );

  if (isComplementMode ? complementLoading : loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>;
  }

  const canSave = isComplementMode ? complementCanSave : massOk;
  const saveHandler = isComplementMode ? saveComplement : save;
  const saveLabel = isComplementMode
    ? t('production.fractional.finalizeComplement')
    : t('production.newProduction.registerOrder');
  const overlayLabel = isComplementMode
    ? t('production.fractional.finalizingComplement')
    : t('production.newProduction.registeringOp');

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{isComplementMode ? t('production.fractional.complementTitle') : t('production.newTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {isComplementMode ? t('production.fractional.complementSubtitle') : t('production.newProduction.subtitle')}
        </p>
        {isComplementMode && complementProduction && (
          <p className="text-sm font-semibold mt-1" style={{ color: '#2575D1' }}>{complementProduction.op_number} · {complementProduction.product}</p>
        )}
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border p-6 relative">
        <LoadingOverlay visible={saving} label={overlayLabel} />
        <h3 className="text-sm font-semibold mb-4">
          {isComplementMode ? t('production.fractional.lockedFields') : t('production.newProduction.dataSection')}
        </h3>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div><label className="text-xs font-medium text-muted-foreground">{t('production.fields.date')} *</label><Input type="date" value={form.date} readOnly={isComplementMode} onChange={e => setForm({ ...form, date: e.target.value })} className={isComplementMode ? 'bg-muted/50' : ''} /></div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('production.newProduction.finishedProduct')} *</label>
            {isComplementMode ? (
              <Input value={form.product} readOnly className="bg-muted/50" />
            ) : (
              <ProductCombobox
                value={form.product}
                onChange={handleProductSelect}
                options={recipes.map(r => ({ value: r.product_name, label: r.product_name }))}
                placeholder={t('common.selectOption')}
              />
            )}
          </div>
          <div><label className="text-xs font-medium text-muted-foreground">{t('common.client')}</label><Input value={form.client} readOnly className="bg-muted/50" /></div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div><label className="text-xs font-medium text-muted-foreground">{t('production.fields.recipeRevision')}</label><Input value={form.recipe_revision} readOnly className="bg-muted/50" /></div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('production.newProduction.linkedOrder')}</label>
            {isComplementMode ? (
              <Input value={form.client_order || t('common.notAvailable')} readOnly className="bg-muted/50" />
            ) : (
              <Select value={form.order_id} onValueChange={v => {
                const o = orders.find(ord => ord.id === v);
                setForm(prev => ({ ...prev, order_id: v, client_order: o?.client_order || '', volume_pending: o?.volume_pending || 0 }));
              }}>
                <SelectTrigger><SelectValue placeholder={t('common.selectOption')} /></SelectTrigger>
                <SelectContent>
                  {orders.filter(o => o.product === form.product).map(o => (
                    <SelectItem key={o.id} value={o.id}>{o.order_number} - {o.product}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div><label className="text-xs font-medium text-muted-foreground">{t('production.newProduction.clientOrderShort')}</label><Input value={form.client_order} readOnly className="bg-muted/50" /></div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-4">
          {!isComplementMode && (
            <div><label className="text-xs font-medium text-muted-foreground">{t('production.newProduction.pendingVolume')}</label><Input value={form.volume_pending || t('common.notAvailable')} readOnly className="bg-muted/50" /></div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('production.fields.priority')}</label>
            {isComplementMode ? (
              <Input value={translatePriority(form.priority)} readOnly className="bg-muted/50" />
            ) : (
              <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Baixa">{translatePriority('Baixa')}</SelectItem>
                  <SelectItem value="Média">{translatePriority('Média')}</SelectItem>
                  <SelectItem value="Alta">{translatePriority('Alta')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <div><label className="text-xs font-medium text-muted-foreground">{t('production.newProduction.opVolume')} *</label><Input type="number" value={form.volume} readOnly={isComplementMode} onChange={e => handleVolumeChange(e.target.value)} className={isComplementMode ? 'bg-muted/50' : ''} /></div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div><label className="text-xs font-medium text-muted-foreground">{t('production.newProduction.density')}</label><Input type="number" step="0.001" value={form.density} readOnly={isComplementMode} onChange={e => handleDensityChange(e.target.value)} className={isComplementMode ? 'bg-muted/50' : ''} /></div>
          <div><label className="text-xs font-medium text-muted-foreground">{t('production.newProduction.massCalculated')}</label><Input value={fmt3(form.mass)} readOnly className="bg-muted/50" /></div>
          <div><label className="text-xs font-medium text-muted-foreground">{t('production.newProduction.destinationPackaging')}</label><Input value={form.packaging_type} readOnly={isComplementMode} onChange={e => setForm({ ...form, packaging_type: e.target.value })} className={isComplementMode ? 'bg-muted/50' : ''} placeholder={t('production.newProduction.packagingPlaceholder')} /></div>
        </div>

        {!isComplementMode && (
          <div className="flex items-center justify-between mb-6 p-4 border rounded-lg bg-muted/30">
            <div>
              <p className="text-sm font-medium">{t('production.fractional.toggle')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('production.fractional.toggleHelp')}</p>
            </div>
            <Switch checked={fractionalSupply} onCheckedChange={setFractionalSupply} />
          </div>
        )}

        {!isComplementMode && (
          <div className="mb-6">
            <label className="text-xs font-medium text-muted-foreground">{t('common.notes')}</label>
            <textarea className="w-full border rounded-md px-3 py-2 text-sm mt-1" rows={2} value={form.observations} onChange={e => setForm({ ...form, observations: e.target.value })} />
          </div>
        )}

        {mpList.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold mb-3">{t('production.newProduction.rawMaterialAllocation')}</h3>
            {!isComplementMode && (
              <p className="text-xs text-muted-foreground mb-3">{t('production.newProduction.rawMaterialAllocationHelp')}</p>
            )}
            {renderLotRows(mpList, setMpList, { readOnly: isComplementMode })}

            {!isComplementMode && (
              <div className="mt-4 border rounded-lg px-4 py-3 flex items-center gap-2 text-sm flex-wrap" style={{ background: '#f0fdf4', borderColor: '#22c55e' }}>
                <span>{t('production.newProduction.operationSummary', { operation: fmt3(totalOperationQty), required: fmt3(totalNeeded) })}</span>
                {massOk ? (
                  <span className="ml-auto flex items-center gap-1 font-semibold text-green-700">{t('production.newProduction.balanceOk')}</span>
                ) : fractionalSupply && totalOperationQty > 0 && totalOperationQty <= totalNeeded ? (
                  <span className="ml-auto flex items-center gap-1 font-semibold text-amber-600">
                    {t('production.fractional.pendingBalance', { volume: fmt3(pendingVolumeL), mass: fmt3(Math.abs(massDiff)) })}
                  </span>
                ) : (
                  <span className="ml-auto flex items-center gap-1 font-semibold text-amber-600">{t('production.newProduction.difference', { value: fmt3(Math.abs(massDiff)) })}</span>
                )}
              </div>
            )}
          </div>
        )}

        {isComplementMode && deficitMpList.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold mb-3">{t('production.fractional.newLotsSection')}</h3>
            {renderLotRows(deficitMpList, setDeficitMpList, { maxKgByMp: true })}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          {!isComplementMode && (
            <Button variant="outline" onClick={() => { setForm({ ...form, product: '', client: '', volume: 0, mass: 0 }); setMpList([]); setFractionalSupply(false); }} disabled={saving}>{t('buttons.clear')}</Button>
          )}
          {isComplementMode && (
            <Button variant="outline" onClick={() => navigate('/producoes')} disabled={saving}>{t('buttons.cancel')}</Button>
          )}
          <Button onClick={saveHandler} disabled={!canSave || saving} style={{ background: canSave ? '#2575D1' : '#94a3b8' }} className="text-white hover:opacity-90">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('production.newProduction.registering')}</> : saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
