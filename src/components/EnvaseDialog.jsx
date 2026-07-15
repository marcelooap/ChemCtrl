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
import { ensureContainerHasOrigin } from '@/lib/containerOrigins';
import { containerDisplayVolume } from '@/lib/fractionalSupply';

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
  const isComplement = !!(production?.complement_packaging && production?.complement_container_id);
  const [containers, setContainers] = useState([newContainer()]);
  const [complementTarget, setComplementTarget] = useState(null);
  const [complementDisplayVolume, setComplementDisplayVolume] = useState(null);
  const [complementVolume, setComplementVolume] = useState('');
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [saving, setSaving] = useState(false);
  const { user: internalUser } = useInternalAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setContainers([newContainer(production?.packaging_type, production?.volume)]);
    setComplementVolume(production?.volume != null ? String(production.volume) : '');
    setComplementTarget(null);
    setComplementDisplayVolume(null);

    if (isComplement && production?.complement_container_id) {
      setLoadingTarget(true);
      (async () => {
        try {
          const c = await supabase.Container.get(production.complement_container_id);
          setComplementTarget(c);
          let linkedProd = null;
          if (c?.production_id) {
            try {
              linkedProd = await supabase.Production.get(c.production_id);
            } catch (_e) {
              linkedProd = null;
            }
          }
          setComplementDisplayVolume(containerDisplayVolume(c, linkedProd ? [linkedProd] : []));
        } catch (err) {
          console.error(err);
          toast({
            title: t('common.error'),
            description: t('production.complementPackaging.targetLoadError'),
            variant: 'destructive',
          });
        } finally {
          setLoadingTarget(false);
        }
      })();
    }
  }, [open, production, isComplement, t, toast]);

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

  const calcNet = (vol, tare) => (parseFloat(vol) || 0) * density;
  const calcGross = (vol, tare) => calcNet(vol) + (parseFloat(tare) || 0);

  const totalVolumeEntered = isComplement
    ? (parseFloat(complementVolume) || 0)
    : containers.reduce((s, c) => s + (parseFloat(c.volume) || 0), 0);
  const opVolume = production?.volume || 0;
  const volumeExceeded = totalVolumeEntered > opVolume;

  const isContainerValid = (c) => {
    const hasVolume = (parseFloat(c.volume) || 0) > 0;
    if (isTankagemType(c.type)) {
      return c.number.trim() !== '' && hasVolume;
    }
    return c.number.trim() !== '' && c.type && hasVolume && c.tare !== '' && c.seals.trim() !== '';
  };

  const allContainersValid = isComplement
    ? !!complementTarget
      && complementTarget.status === 'No Pátio'
      && (complementTarget.product || '') === (production?.product || '')
      && totalVolumeEntered > 0
      && !volumeExceeded
    : containers.every(isContainerValid);

  const handleSaveComplement = async (operatorName) => {
    if (!complementTarget) throw new Error(t('production.complementPackaging.targetLoadError'));
    if (complementTarget.status !== 'No Pátio') {
      throw new Error(t('production.complementPackaging.targetUnavailable'));
    }
    if ((complementTarget.product || '') !== (production.product || '')) {
      throw new Error(t('production.complementPackaging.productMismatch'));
    }

    const addVol = parseFloat(complementVolume) || 0;
    if (addVol <= 0) return;

    // Use volume apontado when the stored container volume is still the nominal OP volume
    const baseVol = Number.isFinite(complementDisplayVolume)
      ? complementDisplayVolume
      : (parseFloat(complementTarget.volume) || 0);

    await ensureContainerHasOrigin(supabase, { ...complementTarget, volume: baseVol }, operatorName);

    // Align existing origins sum with the corrected physical base before adding complement
    const existingOrigins = await supabase.ContainerOrigin.filter({ container_id: complementTarget.id });
    if (existingOrigins?.length === 1) {
      const only = existingOrigins[0];
      const originVol = parseFloat(only.volume) || 0;
      if (Math.abs(originVol - baseVol) > 0.001) {
        await supabase.ContainerOrigin.update(only.id, {
          volume: baseVol,
          initial_volume: parseFloat(only.initial_volume) > 0 ? only.initial_volume : baseVol,
        });
      }
    }

    const newVolume = baseVol + addVol;
    const tare = parseFloat(complementTarget.tare) || 0;
    const net = calcNet(newVolume);
    const gross = calcGross(newVolume, tare);

    await supabase.Container.update(complementTarget.id, {
      volume: newVolume,
      net_weight: net,
      gross_weight: gross,
      is_fractional: newVolume > 0.001,
      status: 'No Pátio',
    });

    await supabase.ContainerOrigin.create({
      container_id: complementTarget.id,
      production_id: production.id,
      op_number: production.op_number,
      lot: production.lot,
      volume: addVol,
      initial_volume: addVol,
      operator: operatorName,
    });

    await supabase.Production.update(production.id, {
      status: 'Finalizado',
      end_time: new Date().toISOString(),
      packaging_type: complementTarget.type || production.packaging_type,
      operator: operatorName,
    });
  };

  const handleSaveStandard = async (operatorName) => {
    const existing = await supabase.Container.list('-created_date', 500);
    const maxRegId = existing.reduce((max, c) => Math.max(max, c.registration_id || 0), 0);
    let nextRegId = maxRegId + 1;

    for (const c of containers) {
      if (!c.volume) continue;
      const payload = isTankagemType(c.type) ? applyTankagemDefaults(c) : c;
      const vol = parseFloat(payload.volume) || 0;
      const tare = parseFloat(payload.tare) || 0;
      const created = await supabase.Container.create({
        production_id: production.id,
        op_number: production.op_number,
        product: production.product,
        client: production.client,
        lot: production.lot,
        container_number: payload.number,
        barril_number: payload.barril || null,
        registration_id: nextRegId,
        type: payload.type,
        volume: vol,
        tare,
        net_weight: calcNet(vol),
        gross_weight: calcGross(vol, tare),
        seals: payload.seals || null,
        sling: payload.sling || null,
        gps: payload.gps || null,
        min_test_date: payload.min_test_date || null,
        operator: operatorName,
        status: 'No Pátio',
      });

      if (created?.id) {
        await supabase.ContainerOrigin.create({
          container_id: created.id,
          production_id: production.id,
          op_number: production.op_number,
          lot: production.lot,
          volume: vol,
          initial_volume: vol,
          operator: operatorName,
        });
      }
      nextRegId++;
    }

    await supabase.Production.update(production.id, {
      status: 'Finalizado',
      end_time: new Date().toISOString(),
      packaging_type: containers[0]?.type,
      operator: operatorName,
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
  };

  const handleSave = async () => {
    if (volumeExceeded || !allContainersValid || totalVolumeEntered === 0) return;
    setSaving(true);
    try {
      const operatorName = internalUser?.nome_completo || internalUser?.nome || '';

      if (isComplement) {
        await handleSaveComplement(operatorName);
      } else {
        await handleSaveStandard(operatorName);
      }

      await NotificationService.fillingFinished({
        id: production.id,
        op_number: production.op_number,
        client: production.client,
      });

      onSave?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Erro ao registrar envase:', error);
      toast({ title: t('common.saveFailed'), description: error?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const targetLabel = complementTarget
    ? `${complementTarget.container_number || ''}${complementTarget.barril_number ? ` - ${complementTarget.barril_number}` : ''}`
    : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-sm font-bold text-gray-800">
            {isComplement
              ? t('production.complementPackaging.envaseTitle', { product: production?.product, lot: production?.lot })
              : t('production.envase.title', { product: production?.product, lot: production?.lot })}
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
                  <p className="text-xs font-medium text-foreground">
                    {isComplement
                      ? targetLabel
                      : (production.packaging_type ? translatePackagingType(production.packaging_type) : '—')}
                  </p>
                </div>
              </div>
            </div>

            {isComplement ? (
              loadingTarget ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : complementTarget ? (
                <div className="border border-border rounded-lg p-4 bg-card space-y-4">
                  <h4 className="text-sm font-semibold">{t('production.complementPackaging.envaseSection')}</h4>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">{t('production.envase.plateNumber')}</p>
                      <p className="font-medium">{complementTarget.container_number || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t('production.envase.barrelNumber')}</p>
                      <p className="font-medium">{complementTarget.barril_number || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t('packaging.fields.type')}</p>
                      <p className="font-medium">{complementTarget.type ? translatePackagingType(complementTarget.type) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t('production.complementPackaging.currentVolume')}</p>
                      <p className="font-semibold">{fmtVolume(complementDisplayVolume ?? complementTarget.volume, 'L', lang)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t('containers.vasilhames.tare')}</p>
                      <p className="font-medium">{complementTarget.tare ?? '—'}</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('production.complementPackaging.addVolume')} *</label>
                      <Input
                        type="number"
                        value={complementVolume}
                        onChange={(e) => setComplementVolume(e.target.value)}
                        className="h-10 text-sm text-right"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-destructive">{t('production.complementPackaging.targetLoadError')}</p>
              )
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-foreground">{t('production.envase.packagedContainers')}</h4>
                  <Button size="sm" onClick={addRow} className="text-white" style={{ background: '#2563EB' }}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> {t('production.envase.addPackaging')}
                  </Button>
                </div>
                <div className="space-y-4">
                  {containers.map((c, idx) => (
                    <div key={idx} className="border border-border rounded-lg p-4 bg-card relative">
                      {containers.length > 1 && (
                        <button onClick={() => removeRow(idx)} className="absolute top-3 right-3 p-1.5 rounded hover:bg-destructive/10 z-10">
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </button>
                      )}
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('production.envase.plateNumber')} *</label>
                          <Input value={c.number} onChange={e => updateContainer(idx, 'number', e.target.value)} className="h-10 text-sm" placeholder="151340690 (806547-8)" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('production.envase.barrelNumber')}</label>
                          <Input value={c.barril} onChange={e => updateContainer(idx, 'barril', e.target.value)} className="h-10 text-sm" placeholder={c.type === 'Tankagem' ? '-' : t('containers.addTank.barrelPlaceholder')} />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('packaging.fields.type')} *</label>
                          <Select value={c.type} onValueChange={v => updateContainer(idx, 'type', v)}>
                            <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {PACKAGING_TYPES.map(pt => <SelectItem key={pt} value={pt}>{translatePackagingType(pt)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('production.packaging.volume')} *</label>
                          <Input type="number" value={c.volume} onChange={e => updateContainer(idx, 'volume', e.target.value)} className="h-10 text-sm text-right" placeholder="25.000" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('containers.vasilhames.tare')}{c.type === 'Tankagem' ? '' : ' *'}</label>
                          <Input type="number" value={c.tare} onChange={e => updateContainer(idx, 'tare', e.target.value)} className="h-10 text-sm text-right" placeholder="2023" />
                        </div>
                        <div className="lg:col-span-2">
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('packaging.fields.seals')}{c.type === 'Tankagem' ? '' : ' *'}</label>
                          <Input value={c.seals} onChange={e => updateContainer(idx, 'seals', e.target.value)} className="h-10 text-sm" placeholder={c.type === 'Tankagem' ? '-' : '12345 12345 12345 12345 12345'} />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('containers.vasilhames.sling')}</label>
                          <Input value={c.sling} onChange={e => updateContainer(idx, 'sling', e.target.value)} className="h-10 text-sm" placeholder="7005289-2" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('containers.vasilhames.gps')}</label>
                          <Input value={c.gps} onChange={e => updateContainer(idx, 'gps', e.target.value)} className="h-10 text-sm" placeholder="2-35115154" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('production.envase.minTestDate')}</label>
                          <Input type="date" value={c.min_test_date} onChange={e => updateContainer(idx, 'min_test_date', e.target.value)} className="h-10 text-sm" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="mt-4 flex items-center justify-between text-sm border rounded-lg px-4 py-2.5" style={{ background: volumeExceeded ? '#fef2f2' : '#f0fdf4', borderColor: volumeExceeded ? '#fca5a5' : '#86efac' }}>
              <span style={{ color: volumeExceeded ? '#dc2626' : '#15803d' }}>
                {t('production.envase.volumeRegistered')} <strong>{fmtVolume(totalVolumeEntered, 'L', lang)}</strong> / {t('production.envase.opVolume')} <strong>{fmtVolume(opVolume, 'L', lang)}</strong>
              </span>
              {volumeExceeded && <span className="text-xs font-semibold text-red-600">⚠ {t('production.envase.volumeExceeded')}</span>}
            </div>

          </div>
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t flex-shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('buttons.cancel')}</Button>
            <Button onClick={handleSave} disabled={saving || loadingTarget || !allContainersValid || volumeExceeded || totalVolumeEntered === 0} className="text-white" style={{ background: '#1E40AF' }}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('production.envase.saving')}</> : t('production.envase.registerPackaging')}
            </Button>
          </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
