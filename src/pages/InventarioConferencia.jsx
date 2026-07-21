import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Save, CheckCircle, Lock } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { fmtDateTime, fmtNumber } from '@/i18n/formatters';

const parseArr = (v) => { if (!v) return []; if (Array.isArray(v)) return v; try { const p = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(p) ? p : []; } catch { return []; } };

export default function InventarioConferencia() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user: authUser } = useInternalAuth();
  const [inventory, setInventory] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showFinish, setShowFinish] = useState(false);

  const fmt = (n) => fmtNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 }, i18n.language);

  useEffect(() => {
    let cancelled = false;
    base44.entities.Inventory.get(id).then(inv => {
      if (cancelled) return;
      setInventory(inv);
      setItems(parseArr(inv?.items));
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const isFinished = inventory?.status === 'Finalizado';

  const calcPhysicalTotal = (it) => (it.physical_packages || 0) * (it.packaging_capacity || 0) + (it.fractional_qty || 0);
  const calcDifference = (it) => calcPhysicalTotal(it) - (it.registered_stock || 0);
  const calcDiffPct = (it) => {
    const reg = it.registered_stock || 0;
    return reg > 0 ? (calcDifference(it) / reg) * 100 : 0;
  };

  const formatFilterValue = (value) => {
    if (value === 'TODOS') return t('inventory.page.allItems');
    return value;
  };

  const updateItem = (idx, field, value) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: parseFloat(value) || 0 };
      updated.physical_total = calcPhysicalTotal(updated);
      updated.difference = calcDifference(updated);
      updated.difference_pct = calcDiffPct(updated);
      return updated;
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await base44.entities.Inventory.update(id, { items });
      toast({ title: t('inventory.messages.saved') });
    } catch (e) {
      toast({ title: t('inventory.conferencePage.saveError'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = async () => {
    try {
      const userName = authUser?.nome || authUser?.full_name || t('common.notAvailable');
      await base44.entities.Inventory.update(id, {
        items,
        status: 'Finalizado',
        closing_date: new Date().toISOString(),
        closed_by: userName,
      });
      toast({ title: t('inventory.messages.completed') });
      navigate('/inventario');
    } catch (e) {
      toast({ title: t('inventory.conferencePage.finishError'), variant: 'destructive' });
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>;
  if (!inventory) return <div className="p-8 text-center text-muted-foreground">{t('inventory.conferencePage.notFound')}</div>;

  const clients = inventory.clients === 'TODOS' ? formatFilterValue('TODOS') : parseArr(inventory.clients).join(', ');
  const products = inventory.products === 'TODOS' ? formatFilterValue('TODOS') : parseArr(inventory.products).join(', ');

  const totalRegistered = items.reduce((s, it) => s + (it.registered_stock || 0), 0);
  const totalPhysical = items.reduce((s, it) => s + calcPhysicalTotal(it), 0);
  const totalDiff = totalPhysical - totalRegistered;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/inventario')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{inventory.inventory_number}</h1>
            <p className="text-sm text-muted-foreground">
              {clients} · {products} · {t('inventory.conferencePage.openedBy', {
                user: inventory.opened_by || t('common.notAvailable'),
                date: fmtDateTime(inventory.opening_date, undefined, i18n.language),
              })}
            </p>
          </div>
        </div>
        {isFinished ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-green-600">
            <Lock className="w-4 h-4" /> {t('inventory.conferencePage.finished')}
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSave} disabled={saving}>
              {saving ? <div className="w-4 h-4 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              {t('buttons.save')}
            </Button>
            <Button onClick={() => setShowFinish(true)} style={{ background: '#16a34a' }} className="text-white hover:opacity-90">
              <CheckCircle className="w-4 h-4 mr-1" /> {t('buttons.finish')}
            </Button>
          </div>
        )}
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto">
          <table className="w-full chemctrl-table">
            <thead className="sticky top-0 z-10">
              <tr className="border-b">
                <th className="px-3 py-3 text-left">{t('common.client')}</th>
                <th className="px-3 py-3 text-left">{t('common.product')}</th>
                <th className="px-3 py-3 text-left">{t('common.lot')}</th>
                <th className="px-3 py-3 text-left">{t('inventory.conferencePage.packaging')}</th>
                <th className="px-3 py-3 text-right">{t('inventory.conferencePage.capacityKg')}</th>
                <th className="px-3 py-3 text-right">{t('inventory.conferencePage.registeredStockKg')}</th>
                <th className="px-3 py-3 text-right">{t('inventory.conferencePage.expectedPackages')}</th>
                <th className="px-3 py-3 text-right">{t('inventory.conferencePage.physicalPackages')}</th>
                <th className="px-3 py-3 text-right">{t('inventory.conferencePage.fractionalKg')}</th>
                <th className="px-3 py-3 text-right">{t('inventory.conferencePage.physicalQtyKg')}</th>
                <th className="px-3 py-3 text-right">{t('inventory.conferencePage.differenceKg')}</th>
                <th className="px-3 py-3 text-right">{t('inventory.conferencePage.diffPercent')}</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={12} className="text-center py-8 text-sm text-muted-foreground">{t('inventory.messages.noItems')}</td></tr>
              ) : items.map((it, idx) => {
                const physTotal = calcPhysicalTotal(it);
                const diff = calcDifference(it);
                const diffPct = calcDiffPct(it);
                const diffColor = diff > 0 ? '#16a34a' : diff < 0 ? '#dc2626' : '#666';
                return (
                  <tr key={idx} className="border-b hover:bg-accent/30">
                    <td className="px-3 py-2 text-sm">{it.client || t('common.notAvailable')}</td>
                    <td className="px-3 py-2 text-sm font-medium">{it.product || t('common.notAvailable')}</td>
                    <td className="px-3 py-2 text-sm font-mono">{it.lot || t('common.notAvailable')}</td>
                    <td className="px-3 py-2 text-sm">{it.packaging_type || t('common.notAvailable')}</td>
                    <td className="px-3 py-2 text-sm text-right">{fmt(it.packaging_capacity)}</td>
                    <td className="px-3 py-2 text-sm text-right font-medium">{fmt(it.registered_stock)}</td>
                    <td className="px-3 py-2 text-sm text-right">{fmt(it.registered_quantity)}</td>
                    <td className="px-3 py-2">
                      <Input type="number" step="1" value={it.physical_packages || ''} disabled={isFinished}
                        onChange={e => updateItem(idx, 'physical_packages', e.target.value)}
                        className="h-8 text-sm w-20 text-right" />
                    </td>
                    <td className="px-3 py-2">
                      <Input type="number" step="0.001" value={it.fractional_qty || ''} disabled={isFinished}
                        onChange={e => updateItem(idx, 'fractional_qty', e.target.value)}
                        className="h-8 text-sm w-24 text-right" />
                    </td>
                    <td className="px-3 py-2 text-sm text-right font-bold">{fmt(physTotal)}</td>
                    <td className="px-3 py-2 text-sm text-right font-bold" style={{ color: diffColor }}>
                      {diff >= 0 ? '+' : ''}{fmt(diff)}
                    </td>
                    <td className="px-3 py-2 text-sm text-right font-semibold" style={{ color: diffColor }}>
                      {diffPct >= 0 ? '+' : ''}{fmt(diffPct)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center gap-6 text-sm bg-muted/50/50">
          <span>{t('inventory.conferencePage.itemsCount', { count: items.length })}</span>
          <span>{t('inventory.conferencePage.registeredTotal', { value: fmt(totalRegistered) })}</span>
          <span>{t('inventory.conferencePage.physicalTotal', { value: fmt(totalPhysical) })}</span>
          <span style={{ color: totalDiff > 0 ? '#16a34a' : totalDiff < 0 ? '#dc2626' : '#666' }}>
            {t('inventory.conferencePage.totalDifference', { value: `${totalDiff >= 0 ? '+' : ''}${fmt(totalDiff)}` })}
          </span>
        </div>
      </div>

      <ConfirmDialog
        open={showFinish}
        onOpenChange={setShowFinish}
        title={t('inventory.conferencePage.finishTitle')}
        message={t('inventory.conferencePage.finishMessage')}
        onConfirm={handleFinish}
        confirmLabel={t('inventory.conferencePage.finishConfirmLabel')}
        confirmColor="#16a34a"
      />
    </div>
  );
}
