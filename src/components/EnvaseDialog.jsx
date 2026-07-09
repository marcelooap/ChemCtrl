import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createSupabaseEntities } from '@/api/supabaseClient';
import { zeroOutTankaStock } from '@/lib/tankUtils';
import { PACKAGING_TYPES } from '@/lib/packagingTypes';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { NotificationService } from '@/notifications/services/NotificationService';

const supabase = createSupabaseEntities();

const fmt3 = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmt1 = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const emptyContainer = () => ({ number: '', barril: '', type: 'Tambor 200 L', volume: '', tare: '', seals: '', sling: '', gps: '', min_test_date: '' });

export default function EnvaseDialog({ open, onOpenChange, production, onSave }) {
  const [containers, setContainers] = useState([emptyContainer()]);
  const [saving, setSaving] = useState(false);
  const { user: internalUser } = useInternalAuth();

  useEffect(() => {
    if (open) {
      setContainers([emptyContainer()]);
    }
  }, [open, production]);

  const density = production?.density || 1;

  const updateContainer = (idx, field, value) => {
    const next = [...containers];
    const wasNotTankagem = next[idx].type !== 'Tankagem';
    next[idx] = { ...next[idx], [field]: value };
    if (field === 'type' && value === 'Tankagem' && wasNotTankagem) {
      if (!next[idx].barril) next[idx].barril = '-';
      if (!next[idx].tare) next[idx].tare = 0;
      if (!next[idx].seals) next[idx].seals = '-';
      if (!next[idx].sling) next[idx].sling = '-';
      if (!next[idx].gps) next[idx].gps = '-';
      if (!next[idx].min_test_date) next[idx].min_test_date = '';
    }
    setContainers(next);
  };

  const addRow = () => setContainers(prev => [...prev, emptyContainer()]);
  const removeRow = (idx) => setContainers(prev => prev.filter((_, i) => i !== idx));

  const calcNet = (c) => (parseFloat(c.volume) || 0) * density;
  const calcGross = (c) => calcNet(c) + (parseFloat(c.tare) || 0);

  const totalVolumeEntered = containers.reduce((s, c) => s + (parseFloat(c.volume) || 0), 0);
  const opVolume = production?.volume || 0;
  const volumeExceeded = totalVolumeEntered > opVolume;

  const allContainersValid = containers.every(c => {
    const isTankagem = c.type === 'Tankagem';
    if (isTankagem) return c.number.trim() && c.volume;
    return c.number.trim() && c.type && c.volume && c.tare !== '' && c.seals.trim();
  });

  const handleSave = async () => {
    if (volumeExceeded || !allContainersValid || totalVolumeEntered === 0) return;
    setSaving(true);
    try {
      const operatorName = internalUser?.nome_completo || internalUser?.nome || '';

      // Consulta usando o novo cliente customizado do Supabase
      const existing = await supabase.Container.list('-created_date', 500);
      const maxRegId = existing.reduce((max, c) => Math.max(max, c.registration_id || 0), 0);
      let nextRegId = maxRegId + 1;

      for (const c of containers) {
        if (!c.volume) continue;
        await supabase.Container.create({
          production_id: production.id,
          op_number: production.op_number,
          product: production.product,
          client: production.client,
          lot: production.lot,
          container_number: c.number,
          barril_number: c.barril,
          registration_id: nextRegId,
          type: c.type,
          volume: parseFloat(c.volume) || 0,
          tare: parseFloat(c.tare) || 0,
          net_weight: calcNet(c),
          gross_weight: calcGross(c),
          seals: c.seals,
          sling: c.sling,
          gps: c.gps,
          min_test_date: c.min_test_date || null,
          operator: operatorName,
          status: 'No Pátio',
        });
        if (c.type === 'Tankagem' && c.number) {
          await zeroOutTankaStock(c.number);
        }
        nextRegId++;
      }
      
      await supabase.Production.update(production.id, {
        status: 'Finalizado',
        end_time: new Date().toISOString(),
        packaging_type: containers[0]?.type,
        operator: operatorName
      });

      NotificationService.fillingFinished({
        id: production.id,
        op_number: production.op_number,
        client: production.client,
      });

      onSave?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Erro ao registrar envase:", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold text-gray-800">
            Envase — {production?.product} · Lote {production?.lot}
          </DialogTitle>
        </DialogHeader>
        {production && (
          <div>
            <div className="bg-muted/50 rounded-lg p-4 mb-4">
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">OP</p>
                  <p className="font-bold" style={{ color: '#2563EB' }}>{production.op_number}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Lote</p>
                  <p className="font-medium text-foreground">{production.lot}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Volume</p>
                  <p className="font-medium text-foreground">{fmt1(production.volume)} L</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Massa</p>
                  <p className="font-medium text-foreground">{fmt3(production.mass)} kg</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Embalagem de Destino</p>
                  <p className="text-xs font-medium text-foreground">{production.packaging_type || '—'}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-foreground">Embalagens Envasadas</h4>
              <Button size="sm" onClick={addRow} className="text-white" style={{ background: '#2563EB' }}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Incluir Embalagem
              </Button>
            </div>
            <div className="space-y-4">
              {containers.map((c, idx) => (
                <div key={idx} className="border border-border rounded-lg p-4 bg-white relative">
                  {containers.length > 1 && (
                    <button onClick={() => removeRow(idx)} className="absolute top-3 right-3 p-1.5 rounded hover:bg-red-50 z-10">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  )}
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">N° Placa *</label>
                      <Input value={c.number} onChange={e => updateContainer(idx, 'number', e.target.value)} className="h-10 text-sm" placeholder="151340690 (806547-8)" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">N° Barril</label>
                      <Input value={c.barril} onChange={e => updateContainer(idx, 'barril', e.target.value)} className="h-10 text-sm" placeholder={c.type === 'Tankagem' ? '-' : 'N° do barril'} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Tipo *</label>
                      <Select value={c.type} onValueChange={v => updateContainer(idx, 'type', v)}>
                        <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PACKAGING_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Volume (L) *</label>
                      <Input type="number" value={c.volume} onChange={e => updateContainer(idx, 'volume', e.target.value)} className="h-10 text-sm text-right" placeholder="25.000" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Tara (kg){c.type === 'Tankagem' ? '' : ' *'}</label>
                      <Input type="number" value={c.tare} onChange={e => updateContainer(idx, 'tare', e.target.value)} className="h-10 text-sm text-right" placeholder="2023" />
                    </div>
                    <div className="lg:col-span-2">
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Lacres{c.type === 'Tankagem' ? '' : ' *'}</label>
                      <Input value={c.seals} onChange={e => updateContainer(idx, 'seals', e.target.value)} className="h-10 text-sm" placeholder={c.type === 'Tankagem' ? '-' : '12345 12345 12345 12345 12345'} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Eslinga</label>
                      <Input value={c.sling} onChange={e => updateContainer(idx, 'sling', e.target.value)} className="h-10 text-sm" placeholder="7005289-2" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">GPS</label>
                      <Input value={c.gps} onChange={e => updateContainer(idx, 'gps', e.target.value)} className="h-10 text-sm" placeholder="2-35115154" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Data Menor Teste</label>
                      <Input type="date" value={c.min_test_date} onChange={e => updateContainer(idx, 'min_test_date', e.target.value)} className="h-10 text-sm" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between text-sm border rounded-lg px-4 py-2.5" style={{ background: volumeExceeded ? '#fef2f2' : '#f0fdf4', borderColor: volumeExceeded ? '#fca5a5' : '#86efac' }}>
              <span style={{ color: volumeExceeded ? '#dc2626' : '#15803d' }}>
                Volume registrado: <strong>{fmt1(totalVolumeEntered)} L</strong> / Volume da OP: <strong>{fmt1(opVolume)} L</strong>
              </span>
              {volumeExceeded && <span className="text-xs font-semibold text-red-600">⚠ Volume excedido!</span>}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving || !allContainersValid || volumeExceeded || totalVolumeEntered === 0} className="text-white" style={{ background: '#1E40AF' }}>
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</> : <>Registrar Envase</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
