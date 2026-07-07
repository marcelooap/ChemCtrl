import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Save, CheckCircle, Lock } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import moment from 'moment';

const parseArr = (v) => { if (!v) return []; if (Array.isArray(v)) return v; try { const p = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(p) ? p : []; } catch { return []; } };
const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function InventarioConferencia() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user: authUser } = useInternalAuth();
  const [inventory, setInventory] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showFinish, setShowFinish] = useState(false);

  useEffect(() => {
    base44.entities.Inventory.get(id).then(inv => {
      setInventory(inv);
      setItems(parseArr(inv.items));
      setLoading(false);
    }).catch(() => { setLoading(false); });
  }, [id]);

  const isFinished = inventory?.status === 'Finalizado';

  const calcPhysicalTotal = (it) => (it.physical_packages || 0) * (it.packaging_capacity || 0) + (it.fractional_qty || 0);
  const calcDifference = (it) => calcPhysicalTotal(it) - (it.registered_stock || 0);
  const calcDiffPct = (it) => {
    const reg = it.registered_stock || 0;
    return reg > 0 ? (calcDifference(it) / reg) * 100 : 0;
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
    } catch (e) {
      toast({ title: 'Erro ao salvar', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = async () => {
    try {
      const userName = authUser?.nome || authUser?.full_name || '—';
      await base44.entities.Inventory.update(id, {
        items,
        status: 'Finalizado',
        closing_date: new Date().toISOString(),
        closed_by: userName,
      });
      navigate('/inventario');
    } catch (e) {
      toast({ title: 'Erro ao finalizar', variant: 'destructive' });
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" /></div>;
  if (!inventory) return <div className="p-8 text-center text-muted-foreground">Inventário não encontrado.</div>;

  const clients = inventory.clients === 'TODOS' ? 'TODOS' : parseArr(inventory.clients).join(', ');
  const products = inventory.products === 'TODOS' ? 'TODOS' : parseArr(inventory.products).join(', ');
  const lots = inventory.lots === 'TODOS' ? 'TODOS' : parseArr(inventory.lots).join(', ');

  const totalRegistered = items.reduce((s, it) => s + (it.registered_stock || 0), 0);
  const totalPhysical = items.reduce((s, it) => s + calcPhysicalTotal(it), 0);
  const totalDiff = totalPhysical - totalRegistered;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/inventario')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#1A1A2E' }}>{inventory.inventory_number}</h1>
            <p className="text-sm text-muted-foreground">
              {clients} · {products} · Aberto por {inventory.opened_by || '—'} em {moment(inventory.opening_date).format('DD/MM/YYYY HH:mm')}
            </p>
          </div>
        </div>
        {isFinished ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-green-600">
            <Lock className="w-4 h-4" /> Inventário Finalizado
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSave} disabled={saving}>
              {saving ? <div className="w-4 h-4 border-2 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Salvar
            </Button>
            <Button onClick={() => setShowFinish(true)} style={{ background: '#16a34a' }} className="text-white hover:opacity-90">
              <CheckCircle className="w-4 h-4 mr-1" /> Finalizar
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto">
          <table className="w-full chemctrl-table">
            <thead className="sticky top-0 z-10">
              <tr className="border-b">
                <th className="px-3 py-3 text-left">Cliente</th>
                <th className="px-3 py-3 text-left">Produto</th>
                <th className="px-3 py-3 text-left">Lote</th>
                <th className="px-3 py-3 text-left">Embalagem</th>
                <th className="px-3 py-3 text-right">Cap. (kg)</th>
                <th className="px-3 py-3 text-right">Estoque Reg. (kg)</th>
                <th className="px-3 py-3 text-right">Embal. Esp.</th>
                <th className="px-3 py-3 text-right">Embal. Fís.</th>
                <th className="px-3 py-3 text-right">Fracionado (kg)</th>
                <th className="px-3 py-3 text-right">Qtd. Física (kg)</th>
                <th className="px-3 py-3 text-right">Diferença (kg)</th>
                <th className="px-3 py-3 text-right">Dif. %</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={12} className="text-center py-8 text-sm text-muted-foreground">Nenhum item neste inventário.</td></tr>
              ) : items.map((it, idx) => {
                const physTotal = calcPhysicalTotal(it);
                const diff = calcDifference(it);
                const diffPct = calcDiffPct(it);
                const diffColor = diff > 0 ? '#16a34a' : diff < 0 ? '#dc2626' : '#666';
                return (
                  <tr key={idx} className="border-b hover:bg-gray-50/50">
                    <td className="px-3 py-2 text-sm">{it.client || '—'}</td>
                    <td className="px-3 py-2 text-sm font-medium">{it.product || '—'}</td>
                    <td className="px-3 py-2 text-sm font-mono">{it.lot || '—'}</td>
                    <td className="px-3 py-2 text-sm">{it.packaging_type || '—'}</td>
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

        {/* Footer summary */}
        <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-6 text-sm bg-gray-50/50">
          <span>Itens: <strong>{items.length}</strong></span>
          <span>Estoque Registrado: <strong>{fmt(totalRegistered)} kg</strong></span>
          <span>Quantidade Física: <strong>{fmt(totalPhysical)} kg</strong></span>
          <span style={{ color: totalDiff > 0 ? '#16a34a' : totalDiff < 0 ? '#dc2626' : '#666' }}>
            Diferença Total: <strong>{totalDiff >= 0 ? '+' : ''}{fmt(totalDiff)} kg</strong>
          </span>
        </div>
      </div>

      <ConfirmDialog
        open={showFinish}
        onOpenChange={setShowFinish}
        title="Finalizar Inventário"
        message="Tem certeza que deseja finalizar este inventário?\n\nApós a finalização, não será possível realizar novas alterações."
        onConfirm={handleFinish}
        confirmLabel="Sim, finalizar"
        confirmColor="#16a34a"
      />
    </div>
  );
}
