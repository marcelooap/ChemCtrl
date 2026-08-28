import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Loader2, ChevronDown } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Badge } from '@shared/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@shared/components/ui/collapsible';
import { createSupabaseEntities } from '@industrializacao/api/supabaseClient';
import { zeroOutTankaStock } from '@industrializacao/lib/tankUtils';
import {
  PACKAGING_TYPES,
  isUnitPackagingType,
  suggestPackageQty,
  formatAggregatedContainerLabel,
} from '@industrializacao/lib/packagingTypes';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { useToast } from '@shared/components/ui/use-toast';
import { fmtVolume, fmtMass } from '@/i18n/formatters';
import { translatePackagingType } from '@/i18n/domainMaps';
import {
  ensureContainerHasOrigin,
  dominantLotFromOrigins,
  upsertOriginFromSlice,
} from '@industrializacao/lib/containerOrigins';
import { containerDisplayVolume } from '@industrializacao/lib/fractionalSupply';
import OperationalChecklistModal from '@industrializacao/components/checklists/OperationalChecklistModal';
import { CHECKLIST_ETAPAS } from '@industrializacao/lib/checklists/operationalChecklistConfig';
import { loadRecipeForProduction } from '@industrializacao/lib/checklists/loadRecipeForProduction';
import {
  loadEnvaseEvidence,
  productionHasRegisteredEnvase,
  finalizeProductionAfterEnvase,
} from '@industrializacao/lib/envaseCompletion';
import { useSubmitGuard } from '@industrializacao/hooks/useSubmitGuard';

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
  const unit = isUnitPackagingType(type);
  const volume = (type === 'Tankagem' || unit) && opVolume ? String(opVolume) : '';
  const c = {
    number: '',
    barril: '',
    type,
    volume,
    tare: '',
    seals: '',
    sling: '',
    gps: '',
    min_test_date: '',
    package_qty: unit ? String(suggestPackageQty(type, volume)) : '',
  };
  return type === 'Tankagem' ? applyTankagemDefaults(c) : c;
};

const isTankagemType = (type) => type === 'Tankagem';
const isContentorType = (type) => type === 'Contentor';

const parsePackageQty = (value) => {
  const qty = parseInt(value, 10);
  return Number.isFinite(qty) && qty >= 1 ? qty : 0;
};

export default function EnvaseDialog({ open, onOpenChange, production, recipe: recipeProp, onSave }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isComplement = !!(production?.complement_packaging && production?.complement_container_id);
  const [containers, setContainers] = useState([newContainer()]);
  const [expandedIdx, setExpandedIdx] = useState(0);
  const [complementTarget, setComplementTarget] = useState(null);
  const [complementDisplayVolume, setComplementDisplayVolume] = useState(null);
  const [complementVolume, setComplementVolume] = useState('');
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recipe, setRecipe] = useState(recipeProp || null);
  const [finishChecklistOpen, setFinishChecklistOpen] = useState(false);
  const [existingEvidence, setExistingEvidence] = useState({ containers: [], origins: [] });
  const [loadingExisting, setLoadingExisting] = useState(false);
  const { user: internalUser } = useInternalAuth();
  const { toast } = useToast();
  const { busy: submitBusy, run: runSubmit } = useSubmitGuard();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setContainers([newContainer(production?.packaging_type, production?.volume)]);
    setExpandedIdx(0);
    setComplementVolume(production?.volume != null ? String(production.volume) : '');
    setComplementTarget(null);
    setComplementDisplayVolume(null);
    setFinishChecklistOpen(false);
    setExistingEvidence({ containers: [], origins: [] });

    if (recipeProp) {
      setRecipe(recipeProp);
    } else {
      loadRecipeForProduction(production).then((r) => { if (!cancelled) setRecipe(r); });
    }

    setLoadingExisting(true);
    loadEnvaseEvidence(supabase, production)
      .then((evidence) => {
        if (!cancelled) setExistingEvidence(evidence);
      })
      .catch(() => {
        if (!cancelled) setExistingEvidence({ containers: [], origins: [] });
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });

    if (isComplement && production?.complement_container_id) {
      setLoadingTarget(true);
      (async () => {
        try {
          const c = await supabase.Container.get(production.complement_container_id);
          if (cancelled) return;
          setComplementTarget(c);
          let linkedProd = null;
          if (c?.production_id) {
            try {
              linkedProd = await supabase.Production.get(c.production_id);
            } catch (_e) {
              linkedProd = null;
            }
          }
          if (cancelled) return;
          setComplementDisplayVolume(containerDisplayVolume(c, linkedProd ? [linkedProd] : []));
        } catch (_err) {
          if (cancelled) return;
          toast({
            title: t('common.error'),
            description: t('production.complementPackaging.targetLoadError'),
            variant: 'destructive',
          });
        } finally {
          if (!cancelled) setLoadingTarget(false);
        }
      })();
    }

    return () => { cancelled = true; };
    // production?.id identifica a OP; demais campos usados no efeito são estáveis
    // enquanto o diálogo permanece aberto para a mesma OP.
  }, [open, production?.id, isComplement, recipeProp, t, toast]);

  const density = production?.density || 1;
  const alreadyRegistered = productionHasRegisteredEnvase(
    production,
    existingEvidence.containers,
    existingEvidence.origins,
  );
  const fmtRegId = (n) => (n != null ? String(n).padStart(2, '0') : '—');

  const updateContainer = (idx, field, value) => {
    setContainers((prev) => {
      const next = [...prev];
      const current = next[idx];
      let updated = { ...current, [field]: value };

      if (field === 'type') {
        if (value === 'Tankagem' && current.type !== 'Tankagem') {
          updated = applyTankagemDefaults(updated);
        }
        if (isUnitPackagingType(value)) {
          const vol = updated.volume || (production?.volume != null ? String(production.volume) : '');
          updated = {
            ...updated,
            number: '',
            barril: '',
            volume: vol,
            package_qty: String(suggestPackageQty(value, vol)),
          };
        } else if (isUnitPackagingType(current.type)) {
          updated = { ...updated, package_qty: '' };
        }
      }

      if (field === 'volume' && isUnitPackagingType(updated.type)) {
        updated.package_qty = String(suggestPackageQty(updated.type, value));
      }

      next[idx] = updated;
      return next;
    });
  };

  const addRow = () => {
    setContainers((prev) => {
      const next = [...prev, newContainer(production?.packaging_type, production?.volume)];
      setExpandedIdx(next.length - 1);
      return next;
    });
  };

  const removeRow = (idx) => {
    setContainers((prev) => prev.filter((_, i) => i !== idx));
    setExpandedIdx((prev) => {
      if (prev === idx) return Math.max(0, idx - 1);
      if (prev > idx) return prev - 1;
      return prev;
    });
  };

  const calcNet = (vol) => (parseFloat(vol) || 0) * density;
  const calcGross = (vol, tare) => calcNet(vol) + (parseFloat(tare) || 0);

  const unitWeights = (c) => {
    const qty = parsePackageQty(c.package_qty);
    const totalVol = parseFloat(c.volume) || 0;
    const tare = parseFloat(c.tare) || 0;
    if (qty < 1 || totalVol <= 0) {
      return { qty: 0, unitVol: 0, unitNet: 0, unitGross: 0 };
    }
    const unitVol = totalVol / qty;
    const unitNet = (totalVol * density) / qty;
    return { qty, unitVol, unitNet, unitGross: unitNet + tare };
  };

  const existingVolume = alreadyRegistered
    ? (
      existingEvidence.containers.reduce((s, c) => s + (parseFloat(c.volume) || 0), 0)
      || existingEvidence.origins.reduce((s, o) => s + (parseFloat(o.volume) || 0), 0)
    )
    : 0;
  const totalVolumeEntered = alreadyRegistered
    ? existingVolume
    : (isComplement
      ? (parseFloat(complementVolume) || 0)
      : containers.reduce((s, c) => s + (parseFloat(c.volume) || 0), 0));
  const opVolume = production?.volume || 0;
  const volumeExceeded = !alreadyRegistered && totalVolumeEntered > opVolume;

  const isContainerValid = (c) => {
    const hasVolume = (parseFloat(c.volume) || 0) > 0;
    if (isTankagemType(c.type)) {
      return c.number.trim() !== '' && hasVolume;
    }
    if (isUnitPackagingType(c.type)) {
      return c.type && hasVolume && c.tare !== '' && parsePackageQty(c.package_qty) >= 1;
    }
    return c.number.trim() !== '' && c.type && hasVolume && c.tare !== '' && c.seals.trim() !== '';
  };

  const allContainersValid = alreadyRegistered
    ? true
    : (isComplement
      ? !!complementTarget
        && complementTarget.status === 'No Pátio'
        && (complementTarget.product || '') === (production?.product || '')
        && totalVolumeEntered > 0
        && !volumeExceeded
      : containers.every(isContainerValid));

  const rowSummaryIdentity = (c) => {
    if (c.number?.trim()) return c.number.trim();
    if (isUnitPackagingType(c.type)) return translatePackagingType(c.type);
    return '—';
  };

  const rowSummaryQty = (c) => (
    isUnitPackagingType(c.type) ? (parsePackageQty(c.package_qty) || 1) : 1
  );

  const handleSaveComplement = async (operatorName) => {
    const evidence = await loadEnvaseEvidence(supabase, production);
    if (productionHasRegisteredEnvase(production, evidence.containers, evidence.origins)) {
      await finalizeProductionAfterEnvase(supabase, production, {
        operatorName,
        packagingType: complementTarget?.type || production.packaging_type,
      });
      return;
    }

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
    const existingOrigins = await supabase.ContainerOrigin.filter({ container_id: complementTarget.id }) || [];
    if (existingOrigins.length === 1) {
      const only = existingOrigins[0];
      const originVol = parseFloat(only.volume) || 0;
      if (Math.abs(originVol - baseVol) > 0.001) {
        await supabase.ContainerOrigin.update(only.id, {
          volume: baseVol,
          initial_volume: parseFloat(only.initial_volume) > 0 ? only.initial_volume : baseVol,
        });
        only.volume = baseVol;
      }
    }

    const newVolume = baseVol + addVol;
    const tare = parseFloat(complementTarget.tare) || 0;
    const net = calcNet(newVolume);
    const gross = calcGross(newVolume, tare);

    const complementSlice = {
      production_id: production.id,
      op_number: production.op_number,
      lot: production.lot,
      volume: addVol,
      initial_volume: addVol,
      created_date: new Date().toISOString(),
    };
    const compositionAfter = [
      ...existingOrigins,
      complementSlice,
    ];
    const dominantLot = dominantLotFromOrigins(compositionAfter)
      || production.lot
      || complementTarget.lot
      || '';

    await supabase.Container.update(complementTarget.id, {
      volume: newVolume,
      net_weight: net,
      gross_weight: gross,
      is_fractional: newVolume > 0.001,
      status: 'No Pátio',
      lot: dominantLot,
    });

    // Same OP/lote on the same packaging must stay as one composition row
    await upsertOriginFromSlice(
      supabase,
      complementTarget.id,
      complementSlice,
      operatorName,
      existingOrigins,
    );

    await finalizeProductionAfterEnvase(supabase, production, {
      operatorName,
      packagingType: complementTarget.type || production.packaging_type,
    });
  };

  const createContainerRecord = async ({ payload, volume, tare, netWeight, grossWeight, containerNumber, barrilNumber, registrationId, operatorName }) => {
    const created = await supabase.Container.create({
      production_id: production.id,
      op_number: production.op_number,
      product: production.product,
      client: production.client,
      lot: production.lot,
      container_number: containerNumber,
      barril_number: barrilNumber,
      registration_id: registrationId,
      type: payload.type,
      volume,
      tare,
      net_weight: netWeight,
      gross_weight: grossWeight,
      seals: payload.seals || null,
      sling: payload.sling || null,
      gps: payload.gps || null,
      min_test_date: payload.min_test_date || null,
      operator: operatorName,
      status: 'No Pátio',
      original_package_qty: isUnitPackagingType(payload.type)
        ? parsePackageQty(payload.package_qty) || suggestPackageQty(payload.type, volume)
        : null,
    });

    if (created?.id) {
      await upsertOriginFromSlice(supabase, created.id, {
        production_id: production.id,
        op_number: production.op_number,
        lot: production.lot,
        volume,
        initial_volume: volume,
      }, operatorName, []);
    }
  };

  const handleSaveStandard = async (operatorName) => {
    const evidence = await loadEnvaseEvidence(supabase, production);
    if (productionHasRegisteredEnvase(production, evidence.containers, evidence.origins)) {
      await finalizeProductionAfterEnvase(supabase, production, {
        operatorName,
        packagingType: evidence.containers[0]?.type || containers[0]?.type,
      });
      return;
    }

    const existing = await supabase.Container.list('-created_date', 500);
    const maxRegId = existing.reduce((max, c) => Math.max(max, c.registration_id || 0), 0);
    let nextRegId = maxRegId + 1;

    for (const c of containers) {
      if (!c.volume) continue;
      const payload = isTankagemType(c.type) ? applyTankagemDefaults(c) : c;

      if (isUnitPackagingType(payload.type)) {
        const { qty } = unitWeights(payload);
        const totalVol = parseFloat(payload.volume) || 0;
        if (qty < 1 || totalVol <= 0) continue;

        const tare = parseFloat(payload.tare) || 0;
        const totalNet = totalVol * density;
        const totalGross = totalNet + tare * qty;

        await createContainerRecord({
          payload: {
            ...payload,
            seals: null,
            sling: null,
            gps: null,
            min_test_date: null,
          },
          volume: totalVol,
          tare,
          netWeight: totalNet,
          grossWeight: totalGross,
          containerNumber: formatAggregatedContainerLabel(qty, payload.type),
          barrilNumber: null,
          registrationId: nextRegId,
          operatorName,
        });
        nextRegId += 1;
        continue;
      }

      const vol = parseFloat(payload.volume) || 0;
      const tare = parseFloat(payload.tare) || 0;
      await createContainerRecord({
        payload,
        volume: vol,
        tare,
        netWeight: calcNet(vol),
        grossWeight: calcGross(vol, tare),
        containerNumber: payload.number,
        barrilNumber: payload.barril || null,
        registrationId: nextRegId,
        operatorName,
      });
      nextRegId += 1;
    }

    await finalizeProductionAfterEnvase(supabase, production, {
      operatorName,
      packagingType: containers[0]?.type,
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
    if (alreadyRegistered) {
      setFinishChecklistOpen(true);
      return;
    }
    if (volumeExceeded || !allContainersValid || totalVolumeEntered === 0) return;
    setFinishChecklistOpen(true);
  };

  const persistEnvase = () => runSubmit(async () => {
    setSaving(true);
    try {
      const operatorName = internalUser?.nome_completo || internalUser?.nome || '';

      if (isComplement) {
        await handleSaveComplement(operatorName);
      } else {
        await handleSaveStandard(operatorName);
      }

      onSave?.();
      onOpenChange(false);
      toast({ title: t('production.envase.saveSuccess') });
    } catch (error) {
      toast({ title: t('errors.saveFailed'), description: error?.message, variant: 'destructive' });
      throw error;
    } finally {
      setSaving(false);
    }
  });

  const targetLabel = complementTarget
    ? `${complementTarget.container_number || ''}${complementTarget.barril_number ? ` - ${complementTarget.barril_number}` : ''}`
    : '—';

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (finishChecklistOpen && !v) return;
        onOpenChange(v);
      }}
    >
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

            {loadingExisting ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : alreadyRegistered ? (
              <div className="border border-border rounded-lg p-4 bg-card space-y-3">
                <h4 className="text-sm font-semibold">{t('production.envase.alreadyRegisteredTitle')}</h4>
                <p className="text-sm text-muted-foreground">{t('production.envase.alreadyRegisteredHint')}</p>
                <div className="space-y-2">
                  {(existingEvidence.containers.length > 0
                    ? existingEvidence.containers
                    : existingEvidence.origins
                  ).map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-3 text-sm border border-border rounded-md px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {row.container_number || row.op_number || production?.op_number}
                        </p>
                        {row.registration_id != null && (
                          <p className="text-xs text-muted-foreground">
                            {t('production.envase.alreadyRegisteredId', {
                              id: fmtRegId(row.registration_id),
                            })}
                          </p>
                        )}
                      </div>
                      <p className="font-semibold shrink-0">{fmtVolume(row.volume, 'L', lang)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : isComplement ? (
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
                <div className="space-y-3">
                  {containers.map((c, idx) => {
                    const unitMode = isUnitPackagingType(c.type);
                    const tankagemMode = isTankagemType(c.type);
                    const contentorMode = isContentorType(c.type);
                    const showPlate = !unitMode;
                    const showBarril = contentorMode;
                    const showLogistics = contentorMode;
                    const weights = unitMode ? unitWeights(c) : null;
                    const tareRequired = !tankagemMode;
                    const sealsRequired = contentorMode;
                    const isOpen = expandedIdx === idx;
                    const qty = rowSummaryQty(c);

                    return (
                      <Collapsible
                        key={idx}
                        open={isOpen}
                        onOpenChange={(openState) => {
                          if (openState) setExpandedIdx(idx);
                          else if (expandedIdx === idx) setExpandedIdx(-1);
                        }}
                      >
                        <div className="border border-border rounded-lg bg-card overflow-hidden">
                          <div className="flex items-start gap-2 px-4 py-3">
                            <CollapsibleTrigger asChild>
                              <button
                                type="button"
                                className="flex flex-1 items-start gap-3 min-w-0 text-left hover:opacity-90"
                              >
                                <div className="min-w-0 flex-1 space-y-1">
                                  <Badge
                                    className="border-transparent text-white shadow-none"
                                    style={{ background: '#7C3AED' }}
                                  >
                                    {t('production.envase.packagingBadge', { n: String(idx + 1).padStart(2, '0') })}
                                  </Badge>
                                  {!isOpen && (
                                    <p className="text-sm text-muted-foreground truncate">
                                      <span className="font-medium text-foreground">{rowSummaryIdentity(c)}</span>
                                      {' · '}
                                      {tankagemMode
                                        ? t('production.envase.summaryVolume', {
                                            volume: fmtVolume(parseFloat(c.volume) || 0, 'L', lang),
                                          })
                                        : t('production.envase.summaryQty', { count: qty })}
                                    </p>
                                  )}
                                </div>
                                <ChevronDown
                                  className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                                />
                              </button>
                            </CollapsibleTrigger>
                            {containers.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeRow(idx)}
                                className="p-1.5 rounded hover:bg-destructive/10 shrink-0 mt-0.5"
                                aria-label={t('buttons.delete')}
                              >
                                <Trash2 className="w-4 h-4 text-red-400" />
                              </button>
                            )}
                          </div>

                          <CollapsibleContent>
                            <div className="px-4 pb-4 pt-1 border-t border-border">
                              <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
                                {showPlate && (
                                  <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                      {tankagemMode ? t('production.envase.tanka') : t('production.envase.plateNumber')} *
                                    </label>
                                    <Input
                                      value={c.number}
                                      onChange={(e) => updateContainer(idx, 'number', e.target.value)}
                                      className="h-10 text-sm"
                                      placeholder={tankagemMode ? 'TKA-014' : '151340690 (806547-8)'}
                                    />
                                  </div>
                                )}
                                {showBarril && (
                                  <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('production.envase.barrelNumber')}</label>
                                    <Input
                                      value={c.barril}
                                      onChange={(e) => updateContainer(idx, 'barril', e.target.value)}
                                      className="h-10 text-sm"
                                      placeholder={t('containers.addTank.barrelPlaceholder')}
                                    />
                                  </div>
                                )}
                                <div>
                                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('packaging.fields.type')} *</label>
                                  <Select value={c.type} onValueChange={(v) => updateContainer(idx, 'type', v)}>
                                    <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {PACKAGING_TYPES.map((pt) => (
                                        <SelectItem key={pt} value={pt}>{translatePackagingType(pt)}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                {unitMode && (
                                  <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('production.envase.packageQty')} *</label>
                                    <Input
                                      type="number"
                                      min={1}
                                      step={1}
                                      value={c.package_qty}
                                      onChange={(e) => updateContainer(idx, 'package_qty', e.target.value)}
                                      className="h-10 text-sm text-right"
                                    />
                                  </div>
                                )}
                                <div>
                                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('production.packaging.volume')} *</label>
                                  <Input type="number" value={c.volume} onChange={(e) => updateContainer(idx, 'volume', e.target.value)} className="h-10 text-sm text-right" placeholder="25.000" />
                                </div>
                                {!tankagemMode && (
                                  <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                      {unitMode ? t('production.envase.tarePerPackage') : t('containers.vasilhames.tare')}
                                      {tareRequired ? ' *' : ''}
                                    </label>
                                    <Input type="number" value={c.tare} onChange={(e) => updateContainer(idx, 'tare', e.target.value)} className="h-10 text-sm text-right" placeholder={unitMode ? '60' : '2023'} />
                                  </div>
                                )}
                                {unitMode && (
                                  <>
                                    <div>
                                      <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('production.envase.netWeightPerPackage')}</label>
                                      <Input
                                        readOnly
                                        value={weights.qty > 0 ? fmtMass(weights.unitNet, 'kg', lang) : '—'}
                                        className="h-10 text-sm text-right bg-muted/40"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('production.envase.grossWeightPerPackage')}</label>
                                      <Input
                                        readOnly
                                        value={weights.qty > 0 ? fmtMass(weights.unitGross, 'kg', lang) : '—'}
                                        className="h-10 text-sm text-right bg-muted/40"
                                      />
                                    </div>
                                    {weights.qty > 0 && (
                                      <div className="col-span-2 lg:col-span-3">
                                        <p className="text-xs text-muted-foreground">
                                          {t('production.envase.willCreatePackages', { count: weights.qty })}
                                        </p>
                                      </div>
                                    )}
                                  </>
                                )}
                                {showLogistics && (
                                  <>
                                    <div className="lg:col-span-2">
                                      <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('packaging.fields.seals')}{sealsRequired ? ' *' : ''}</label>
                                      <Input value={c.seals} onChange={(e) => updateContainer(idx, 'seals', e.target.value)} className="h-10 text-sm" placeholder="12345 12345 12345 12345 12345" />
                                    </div>
                                    <div>
                                      <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('containers.vasilhames.sling')}</label>
                                      <Input value={c.sling} onChange={(e) => updateContainer(idx, 'sling', e.target.value)} className="h-10 text-sm" placeholder="7005289-2" />
                                    </div>
                                    <div>
                                      <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('containers.vasilhames.gps')}</label>
                                      <Input value={c.gps} onChange={(e) => updateContainer(idx, 'gps', e.target.value)} className="h-10 text-sm" placeholder="2-35115154" />
                                    </div>
                                    <div>
                                      <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('production.envase.minTestDate')}</label>
                                      <Input type="date" value={c.min_test_date} onChange={(e) => updateContainer(idx, 'min_test_date', e.target.value)} className="h-10 text-sm" />
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    );
                  })}
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
            <Button onClick={handleSave} disabled={saving || submitBusy || loadingTarget || loadingExisting || !allContainersValid || volumeExceeded || (!alreadyRegistered && totalVolumeEntered === 0)} className="text-white" style={{ background: '#1E40AF' }}>
              {saving || submitBusy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('production.envase.saving')}</> : alreadyRegistered ? t('production.envase.finalizeExisting') : t('production.envase.registerPackaging')}
            </Button>
          </div>
          </>
        )}
      </DialogContent>
    </Dialog>

    <OperationalChecklistModal
      open={finishChecklistOpen}
      onOpenChange={setFinishChecklistOpen}
      etapa={CHECKLIST_ETAPAS.FINISH_FILLING}
      production={production}
      recipe={recipe}
      onCompleted={persistEnvase}
    />
    </>
  );
}
