import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Printer } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { useToast } from '@shared/components/ui/use-toast';
import NumberInputBr from '@transbordo/components/NumberInputBr';
import EtiquetaPreview from '@painel/components/configuracao/EtiquetaPreview';
import {
  resolveEtiquetaPrintConfig,
  resolveResponsavelTecnico,
} from '@transbordo/lib/etiquetaConfig';
import { printContainerLabel, calcValidityDate } from '@industrializacao/lib/labelprint';
import { ensureProductionPublicToken } from '@industrializacao/lib/ensurePublicToken';
import { base44 } from '@industrializacao/api/base44Client';
import {
  productionOfContainer,
  containerDisplayVolume,
  containerDensity,
} from '@industrializacao/lib/fractionalSupply';
import { resolveValidityDays } from '@industrializacao/lib/recipeRevisions';
import {
  calcLabelWeightsFromVolume,
  formatLabelEmbalagem,
  labelRequiresManualVolume,
  suggestLabelVolumePlaceholder,
} from '@industrializacao/lib/packagingTypes';
import { fmtNumber } from '@/i18n/formatters';

function defaultVolumeForContainer(container, productions) {
  if (!container) return '';
  if (labelRequiresManualVolume(container)) return '';
  const display = Number(containerDisplayVolume(container, productions));
  if (Number.isFinite(display) && display > 0) return Math.round(display);
  const stored = Number(container.volume);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
  return '';
}

async function resolveValidityDaysForContainer(container, production, recipes) {
  let validityDays = resolveValidityDays(recipes || [], container, production);

  if (validityDays == null && production?.recipe_id) {
    try {
      const remote = await base44.entities.Recipe.get(production.recipe_id);
      const n = Number(remote?.validity_days);
      if (Number.isFinite(n) && n > 0) validityDays = n;
    } catch { /* ignore */ }
  }
  if (validityDays == null) {
    const productName = container.product || production?.product;
    if (productName) {
      try {
        const remoteList = await base44.entities.Recipe.filter(
          { product_name: productName },
          '-revision_number',
          20,
        );
        validityDays = resolveValidityDays(remoteList || [], container, production);
      } catch { /* ignore */ }
    }
  }
  return validityDays;
}

export default function PrintContainerLabelDialog({
  open,
  onOpenChange,
  container,
  productions = [],
  recipes = [],
  density: densityOverride,
  contexto = 'industrializacao',
  clienteId,
  clienteNome,
  manufactureDate,
  publicToken: publicTokenOverride,
  resolvePublicToken,
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const sessionKey = open && container
    ? String(container.id || `${container.container_number || ''}|${container.barril_number || ''}|${container.op_number || ''}`)
    : '';
  const [formSession, setFormSession] = useState('');
  const [volume, setVolume] = useState('');
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [meta, setMeta] = useState(null);

  if (sessionKey !== formSession) {
    setFormSession(sessionKey);
    setVolume(sessionKey ? defaultVolumeForContainer(container, productions) : '');
    setQty(1);
  }

  const manualVolume = labelRequiresManualVolume(container);
  const production = useMemo(
    () => productionOfContainer(container, productions || []),
    [container, productions],
  );
  const density = Number(densityOverride) > 0
    ? Number(densityOverride)
    : containerDensity(container, productions, recipes);
  const tare = Number(container?.tare ?? container?.tara) || 0;
  const weights = calcLabelWeightsFromVolume({ volume, density, tare });
  const volumeOk = Number(volume) > 0;
  const qtyOk = Number.isFinite(Number(qty)) && Number(qty) >= 1;
  const embalagem = formatLabelEmbalagem(container);
  const fabDate = manufactureDate || production?.end_time || container?.created_date;
  const volumePlaceholder = suggestLabelVolumePlaceholder(container?.type || container?.tipo);

  useEffect(() => {
    if (!open || !container) return undefined;

    let cancelled = false;
    setMeta(null);
    (async () => {
      setLoading(true);
      try {
        const nome = clienteNome || container.client || container.cliente_nome || production?.client;
        const [printConfig, responsavelTecnico, validityDays, publicToken] = await Promise.all([
          resolveEtiquetaPrintConfig({
            clienteId,
            clienteNome: nome,
            contexto,
          }),
          resolveResponsavelTecnico({
            clienteId,
            clienteNome: nome,
          }),
          resolveValidityDaysForContainer(container, production, recipes),
          publicTokenOverride != null
            ? Promise.resolve(publicTokenOverride)
            : resolvePublicToken
              ? resolvePublicToken()
              : ensureProductionPublicToken(production),
        ]);
        if (cancelled) return;
        setMeta({
          printConfig,
          responsavelTecnico,
          validityDays,
          publicToken,
          clienteNome: nome,
        });
      } catch (err) {
        if (cancelled) return;
        toast({ title: t('errors.saveFailed'), description: err.message, variant: 'destructive' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, container?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrint = async () => {
    if (!container || !volumeOk || !qtyOk) {
      toast({
        title: t('containers.vasilhames.validationTitle'),
        description: t('containers.vasilhames.printLabelVolumeRequired'),
        variant: 'destructive',
      });
      return;
    }
    setPrinting(true);
    try {
      await printContainerLabel(container, meta?.validityDays, meta?.publicToken, {
        manufactureDate: fabDate,
        locale: i18n.language,
        clienteNome: meta?.clienteNome,
        clienteId,
        contexto,
        volume: weights.volume,
        netWeight: weights.netWeight,
        grossWeight: weights.grossWeight,
        copies: Math.round(Number(qty)),
        embalagem,
        campos: meta?.printConfig?.campos,
        dateFormat: meta?.printConfig?.dateFormat,
        orientation: meta?.printConfig?.orientation,
        responsavelTecnico: meta?.responsavelTecnico,
      });
      onOpenChange?.(false);
    } catch (err) {
      toast({ title: t('errors.saveFailed'), description: err.message, variant: 'destructive' });
    } finally {
      setPrinting(false);
    }
  };

  const previewValues = {
    product: container?.product || '—',
    client: meta?.clienteNome || container?.client || '—',
    op_number: container?.op_number || '—',
    lot: container?.lot || '—',
    manufactureDate: fabDate,
    expiryDate: calcValidityDate(fabDate, meta?.validityDays),
    net_weight: volumeOk ? weights.netWeight : 0,
    gross_weight: volumeOk ? weights.grossWeight : 0,
    volume: volumeOk ? Math.round(weights.volume) : null,
    embalagem,
    publicToken: meta?.publicToken,
    responsavel_tecnico: meta?.responsavelTecnico,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-[760px] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('containers.vasilhames.printLabelTitle')}</DialogTitle>
        </DialogHeader>

        {container && (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <div className="overflow-x-auto rounded-lg bg-muted/40 px-3 py-4">
              {loading && !meta ? (
                <div className="flex items-center justify-center h-[220px] text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  {t('common.loading')}
                </div>
              ) : (
                <EtiquetaPreview
                  chrome={false}
                  weightDecimals={0}
                  campos={meta?.printConfig?.campos}
                  dateFormat={meta?.printConfig?.dateFormat}
                  orientation={meta?.printConfig?.orientation}
                  consultaPath={contexto === 'convencional' ? '/consulta-produto' : '/consulta'}
                  values={previewValues}
                />
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  {t('containers.fields.volume')} (L) *
                </label>
                <NumberInputBr
                  key={`vol-${sessionKey}`}
                  value={volume}
                  onChange={setVolume}
                  decimals={0}
                  min={0}
                  placeholder={volumePlaceholder ? String(volumePlaceholder) : '0'}
                  aria-label={t('containers.fields.volume')}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {manualVolume
                    ? t('containers.vasilhames.printLabelVolumeHintUnit')
                    : t('containers.vasilhames.printLabelVolumeHintTank')}
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  {t('containers.vasilhames.printLabelQty')} *
                </label>
                <NumberInputBr
                  key={`qty-${sessionKey}`}
                  value={qty}
                  onChange={(v) => setQty(v === '' ? '' : Math.max(1, Math.round(Number(v) || 1)))}
                  decimals={0}
                  min={1}
                  placeholder="1"
                  aria-label={t('containers.vasilhames.printLabelQty')}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-0.5">{t('containers.fields.netWeight')}</p>
                <p className="font-semibold text-green-700">
                  {volumeOk
                    ? `${fmtNumber(weights.netWeight, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, i18n.language)} kg`
                    : '—'}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-0.5">{t('containers.fields.grossWeight')}</p>
                <p className="font-semibold">
                  {volumeOk
                    ? `${fmtNumber(weights.grossWeight, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, i18n.language)} kg`
                    : '—'}
                </p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="mt-2 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange?.(false)} disabled={printing}>
            {t('buttons.cancel')}
          </Button>
          <Button
            onClick={handlePrint}
            disabled={printing || loading || !volumeOk || !qtyOk}
            className="text-white"
            style={{ background: '#2575D1' }}
          >
            {printing
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('containers.vasilhames.printingLabels')}</>
              : <><Printer className="w-4 h-4 mr-2" /> {t('containers.vasilhames.printLabelConfirm')}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
