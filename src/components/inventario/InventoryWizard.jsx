import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Check, ChevronRight, ChevronLeft, Users, Package, Layers } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useInternalAuth } from '@/lib/InternalAuthContext';

export default function InventoryWizard({ open, onOpenChange, onCreated }) {
  const { toast } = useToast();
  const { user: authUser } = useInternalAuth();
  const { data: stocks } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 500));
  const { data: inventories } = useRealtimeEntity('Inventory', () => base44.entities.Inventory.list('-created_date', 500));

  const [step, setStep] = useState(0);
  const [selectedClients, setSelectedClients] = useState([]);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [selectedLots, setSelectedLots] = useState([]);
  const [saving, setSaving] = useState(false);

  const clients = useMemo(() => {
    const set = new Set();
    stocks.forEach(s => { if (s.client) set.add(s.client); });
    return Array.from(set).sort();
  }, [stocks]);

  const products = useMemo(() => {
    const set = new Set();
    stocks
      .filter(s => selectedClients.length === 0 || selectedClients.includes(s.client))
      .forEach(s => { if (s.mp_name) set.add(s.mp_name); });
    return Array.from(set).sort();
  }, [stocks, selectedClients]);

  const lots = useMemo(() => {
    const set = new Set();
    stocks
      .filter(s =>
        (selectedClients.length === 0 || selectedClients.includes(s.client)) &&
        (selectedProducts.length === 0 || selectedProducts.includes(s.mp_name))
      )
      .forEach(s => { if (s.lot) set.add(s.lot); });
    return Array.from(set).sort();
  }, [stocks, selectedClients, selectedProducts]);

  const toggle = (value, list, setList) => {
    setList(list.includes(value) ? list.filter(v => v !== value) : [...list, value]);
  };

  const toggleAll = (allItems, list, setList) => {
    setList(list.length === allItems.length ? [] : [...allItems]);
  };

  const reset = () => {
    setStep(0);
    setSelectedClients([]);
    setSelectedProducts([]);
    setSelectedLots([]);
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      const userName = authUser?.nome || authUser?.full_name || '—';
      const nextNum = inventories.length + 1;
      const inventory_number = `INV-${String(nextNum).padStart(4, '0')}`;

      // Build items from matching stocks
      const matchingStocks = stocks.filter(s =>
        (selectedClients.length === 0 || selectedClients.includes(s.client)) &&
        (selectedProducts.length === 0 || selectedProducts.includes(s.mp_name)) &&
        (selectedLots.length === 0 || selectedLots.includes(s.lot))
      );

      const items = matchingStocks.map(s => ({
        stock_id: s.id,
        client: s.client || '',
        product: s.mp_name || '',
        lot: s.lot || '',
        unit: s.unit || 'kg',
        packaging_type: s.packaging_type || '',
        packaging_capacity: s.packaging_capacity || 0,
        registered_stock: s.current_stock || 0,
        registered_quantity: s.packaging_quantity || 0,
        physical_packages: 0,
        fractional_qty: 0,
        physical_total: 0,
        difference: 0,
        difference_pct: 0,
      }));

      const data = {
        inventory_number,
        opening_date: new Date().toISOString(),
        opened_by: userName,
        clients: selectedClients.length === 0 ? 'TODOS' : JSON.stringify(selectedClients),
        products: selectedProducts.length === 0 ? 'TODOS' : JSON.stringify(selectedProducts),
        lots: selectedLots.length === 0 ? 'TODOS' : JSON.stringify(selectedLots),
        status: 'Aberto',
        items,
      };

      await base44.entities.Inventory.create(data);
      reset();
      onOpenChange(false);
      onCreated && onCreated();
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('could not find the table') || msg.includes('pgrst205') || msg.includes('404')) {
        toast({ title: 'Tabela de inventário não existe no banco. Execute o SQL de migração no Supabase.', variant: 'destructive' });
      } else {
        toast({ title: 'Erro ao criar inventário: ' + (e?.message || 'erro desconhecido'), variant: 'destructive' });
      }
    } finally {
      setSaving(false);
    }
  };

  const steps = [
    { label: 'Cliente', icon: Users, items: clients, selected: selectedClients, setSelected: setSelectedClients },
    { label: 'Produto', icon: Package, items: products, selected: selectedProducts, setSelected: setSelectedProducts },
    { label: 'Lote', icon: Layers, items: lots, selected: selectedLots, setSelected: setSelectedLots },
  ];

  const current = steps[step];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Abrir Inventário — Etapa {step + 1} de 3</DialogTitle>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center gap-2 mb-4">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${i <= step ? 'text-white' : 'text-gray-400 bg-gray-100'}`}
                style={{ background: i <= step ? '#2575D1' : undefined }}>
                {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={`text-xs ${i <= step ? 'font-semibold text-gray-800' : 'text-gray-400'}`}>{s.label}</span>
              {i < steps.length - 1 && <div className={`flex-1 h-0.5 ${i < step ? 'bg-[#2575D1]' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <current.icon className="w-4 h-4 text-[#2575D1]" />
            <span className="text-sm font-semibold">Selecionar {current.label}</span>
          </div>
          <button onClick={() => toggleAll(current.items, current.selected, current.setSelected)}
            className="text-xs font-medium text-[#2575D1] hover:underline">
            {current.selected.length === current.items.length ? 'Desmarcar todos' : 'Selecionar todos'}
          </button>
        </div>

        <div className="border rounded-lg max-h-64 overflow-y-auto">
          {current.items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum item disponível.</p>
          ) : (
            current.items.map(item => (
              <label key={item} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0">
                <Checkbox checked={current.selected.includes(item)} onCheckedChange={() => toggle(item, current.selected, current.setSelected)} />
                <span className="text-sm">{item}</span>
              </label>
            ))
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {current.selected.length === 0 ? `TODOS serão incluídos` : `${current.selected.length} selecionado(s)`}
        </p>

        <div className="flex justify-between mt-4">
          <Button variant="outline" onClick={() => step === 0 ? onOpenChange(false) : setStep(step - 1)}
            disabled={saving}>
            <ChevronLeft className="w-4 h-4 mr-1" /> {step === 0 ? 'Cancelar' : 'Voltar'}
          </Button>
          {step < 2 ? (
            <Button onClick={() => setStep(step + 1)} style={{ background: '#2575D1' }} className="text-white">
              Próximo <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleFinish} disabled={saving} style={{ background: '#2575D1' }} className="text-white">
              {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
              Criar Inventário
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
