import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useToast } from '@/components/ui/use-toast';
import { fmtVolume, fmtMass } from '@/i18n/formatters';
import { translatePackagingType } from '@/i18n/domainMaps';

const supabase = createSupabaseEntities();

const applyTankagemDefaults = (c) => ({
  ...c,
  barril: c.barril || '-',
  tare: c.tare !== '' && c.tare != null ? String(c.tare) : '0',
  seals: c.seals || '-',
  sling: c.sling || '-',
  gps: c.gps || '-',
});

const newContainer = (preferredType, opVolume) => {
  const type = PACKAGING_TYPES.includes(preferredType) ? preferredType : 'Tambor 200 L';
  const c = {
    number: '',
    barril: '',
    type,
    volume: type === 'Tankagem' && opVolume ? String(opVolume) : '',
    tare: '',
    seals: '',
    sling: '',
    gps: '',
    min_test_date: '',
  };
  return type === 'Tankagem' ? applyTankagemDefaults(c) : c;
};

const isTankagemType = (type) => type === 'Tankagem';

export default function EnvaseDialog({ open, onOpenChange, production, onSave }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [containers, setContainers] = useState([newContainer()]);
  const [saving, setSaving] = useState(false);
  const { user: internalUser } = useInternalAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setContainers([newContainer(production?.packaging_type, production?.volume)]);
    }
  }, [open, production]);

  const density = production?.density || 1;

  const updateContainer = (idx, field, value) => {
    const next = [...containers];
    const wasNotTankagem = next[idx].type !== 'Tankagem';
    next[idx] = { ...next[idx], [field]: value };
    if (field === 'type' && value === 'Tankagem' && wasNotTankagem) {
      next[idx] = applyTankagemDefaults(next[idx]);
    }
    setContainers(next);
  };

  const addRow = () => setContainers(prev => [...prev, newContainer(production?.packaging_type, production?.volume)]);
  const removeRow = (idx) => setContainers(prev => prev.filter((_, i) => i !== idx));

  const calcNet = (c) => (parseFloat(c.volume) || 0) * density;
  const calcGross = (c) => calcNet(c) + (parseFloat(c.tare) || 0);

  const totalVolumeEntered = containers.reduce((s, c) => s + (parseFloat(c.volume) || 0), 0);
  const opVolume = production?.volume || 0;
  const volumeExceeded = totalVolumeEntered > opVolume;

  const isContainerValid = (c) => {
    const hasVolume = (parseFloat(c.volume) || 0) > 0;
    if (isTankagemType(c.type)) {
      return c.number.trim() !== '' && hasVolume;
    }
    return c.number.trim() !== '' && c.type && hasVolume && c.tare !== '' && c.seals.trim() !== '';
  };

  const allContainersValid = containers.every(isContainerValid);

  const handleSave = async () => {
    if (volumeExceeded || !allContainersValid || totalVolumeEntered === 0) return;
    setSaving(true);
    try {
      const operatorName = internalUser?.nome_completo || internalUser?.nome || '';

      const existing = await supabase.Container.list('-created_date', 500);
      const maxRegId = existing.reduce((max, c) => Math.max(max, c.registration_id || 0), 0);
      let nextRegId = maxRegId + 1;

      for (const c of containers) {
        if (!c.volume) continue;
        const payload = isTankagemType(c.type) ? applyTankagemDefaults(c) : c;
        await supabase.Container.create({
          production_id: production.id,
          op_number: production.op_number,
          product: production.product,
          client: production.client,
          lot: production.lot,
          container_number: payload.number,
          barril_number: payload.barril || null,
          registration_id: nextRegId,
          type: payload.type,
          volume: parseFloat(payload.volume) || 0,
          tare: parseFloat(payload.tare) || 0,
          net_weight: calcNet(payload),
          gross_weight: calcGross(payload),
          seals: payload.seals || null,
          sling: payload.sling || null,
          gps: payload.gps || null,
          min_test_date: payload.min_test_date || null,
          operator: operatorName,
          status: 'No Pátio',
        });
        nextRegId++;
      }

      await supabase.Production.update(production.id, {
        status: 'Finalizado',
        end_time: new Date().toISOString(),
        packaging_type: containers[0]?.type,
        operator: operatorName
      });

      for (const c of containers) {
        const payload = isTankagemType(c.type) ? applyTankagemDefaults(c) : c;
        if (isTankagemType(payload.type) && payload.number) {
          try {
            await zeroOutTankaStock(payload.number);
          } catch (stockError) {
            console.warn('Erro ao zerar estoque da tanka:', stockError);
          }
        }
      }

      await NotificationService.fillingFinished({
        id: production.id,
        op_number: production.op_number,
        client: production.client,
      });

      onSave?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Erro ao registrar envase:", error);
      toast({ title: t('common.saveFailed'), description: error?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-sm font-bold text-gray-800">
            {t('production.envase.title', { product: production?.product, lot: production?.lot })}
          </DialogTitle>
        </DialogHeader>
        {production && (
          <>
          <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
            <div className="bg-muted/50 rounded-lg p-4 mb-4">
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{t('production.opNumber')}</p>
                  <p className="font-bold" style={{ color: '#2563EB' }}>{production.op_number}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{t('common.lot')}</p>
                  <p className="font-medium text-foreground">{production.lot}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{t('common.volume')}</p>
                  <p className="font-medium text-foreground">{fmtVolume(production.volume, 'L', lang)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{t('common.mass')}</p>
                  <p className="font-medium text-foreground">{fmtMass(production.mass, 'kg', lang)}</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{t('production.envase.destinationPackaging')}</p>
                  <p className="text-xs font-medium text-foreground">{production.packaging_type ? translatePackagingType(production.packaging_type) : '—'}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-foreground">{t('production.envase.packagedContainers')}</h4>
              <Button size="sm" onClick={addRow} className="text-white" style={{ background: '#2563EB' }}>
                <Plus className="w-3.5 h-3.5 mr-1" /> {t('production.envase.addPackaging')}
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
                      <label className="text-xs font-medium text-gray-500 mb-1 block">{t('production.envase.plateNumber')} *</label>
                      <Input value={c.number} onChange={e => updateContainer(idx, 'number', e.target.value)} className="h-10 text-sm" placeholder="151340690 (806547-8)" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">{t('production.envase.barrelNumber')}</label>
                      <Input value={c.barril} onChange={e => updateContainer(idx, 'barril', e.target.value)} className="h-10 text-sm" placeholder={c.type === 'Tankagem' ? '-' : t('containers.addTank.barrelPlaceholder')} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">{t('packaging.fields.type')} *</label>
                      <Select value={c.type} onValueChange={v => updateContainer(idx, 'type', v)}>
                        <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PACKAGING_TYPES.map(pt => <SelectItem key={pt} value={pt}>{translatePackagingType(pt)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">{t('production.packaging.volume')} *</label>
                      <Input type="number" value={c.volume} onChange={e => updateContainer(idx, 'volume', e.target.value)} className="h-10 text-sm text-right" placeholder="25.000" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">{t('containers.vasilhames.tare')}{c.type === 'Tankagem' ? '' : ' *'}</label>
                      <Input type="number" value={c.tare} onChange={e => updateContainer(idx, 'tare', e.target.value)} className="h-10 text-sm text-right" placeholder="2023" />
                    </div>
                    <div className="lg:col-span-2">
                      <label className="text-xs font-medium text-gray-500 mb-1 block">{t('packaging.fields.seals')}{c.type === 'Tankagem' ? '' : ' *'}</label>
                      <Input value={c.seals} onChange={e => updateContainer(idx, 'seals', e.target.value)} className="h-10 text-sm" placeholder={c.type === 'Tankagem' ? '-' : '12345 12345 12345 12345 12345'} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">{t('containers.vasilhames.sling')}</label>
                      <Input value={c.sling} onChange={e => updateContainer(idx, 'sling', e.target.value)} className="h-10 text-sm" placeholder="7005289-2" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">{t('containers.vasilhames.gps')}</label>
                      <Input value={c.gps} onChange={e => updateContainer(idx, 'gps', e.target.value)} className="h-10 text-sm" placeholder="2-35115154" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">{t('production.envase.minTestDate')}</label>
                      <Input type="date" value={c.min_test_date} onChange={e => updateContainer(idx, 'min_test_date', e.target.value)} className="h-10 text-sm" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between text-sm border rounded-lg px-4 py-2.5" style={{ background: volumeExceeded ? '#fef2f2' : '#f0fdf4', borderColor: volumeExceeded ? '#fca5a5' : '#86efac' }}>
              <span style={{ color: volumeExceeded ? '#dc2626' : '#15803d' }}>
                {t('production.envase.volumeRegistered')} <strong>{fmtVolume(totalVolumeEntered, 'L', lang)}</strong> / {t('production.envase.opVolume')} <strong>{fmtVolume(opVolume, 'L', lang)}</strong>
              </span>
              {volumeExceeded && <span className="text-xs font-semibold text-red-600">⚠ {t('production.envase.volumeExceeded')}</span>}
            </div>

          </div>
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t flex-shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('buttons.cancel')}</Button>
            <Button onClick={handleSave} disabled={saving || !allContainersValid || volumeExceeded || totalVolumeEntered === 0} className="text-white" style={{ background: '#1E40AF' }}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('production.envase.saving')}</> : t('production.envase.registerPackaging')}
            </Button>
          </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
