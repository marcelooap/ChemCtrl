import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, Printer } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogClose,
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
import { parseDensidade } from '@transbordo/lib/format';
import { printContainerLabel, calcValidityDate } from '@industrializacao/lib/labelprint';
import { containerLabelDateOverride } from '@industrializacao/lib/containerLabelDateOverride';
import { ensureProductionPublicToken } from '@industrializacao/lib/ensurePublicToken';
import {
  productionOfContainer,
  containerDisplayVolume,
  containerDensity,
} from '@industrializacao/lib/fractionalSupply';
import { resolveValidityDaysForContainer } from '@industrializacao/lib/containerLoteDatas';
import {
  calcLabelWeightsFromVolume,
  formatLabelEmbalagem,
  labelRequiresManualVolume,
  stripAggregatedQtyPrefix,
  suggestLabelVolumePlaceholder,
} from '@industrializacao/lib/packagingTypes';
import { fmtNumber } from '@/i18n/formatters';

const REP_BRASIL_CLIENT = 'REP BRASIL';

/** Alerta REP BRASIL: lote de etiqueta não pode iniciar com OF (deve ser OS-…). */
export function shouldWarnRepBrasilOfLot(clienteNome, lot) {
  const client = String(clienteNome || '').trim().toUpperCase();
  if (client !== REP_BRASIL_CLIENT) return false;
  const lote = String(lot || '').trim();
  if (!lote || lote === '—') return false;
  return lote.toUpperCase().startsWith('OF');
}

/** Volume inicial do modal: unidade (tambor/bombona/IBC) ou volume do tanque. */
export function defaultVolumeForContainer(container, productions, initialVolume) {
  if (!container) return '';

  const forced = Number(initialVolume);
  if (Number.isFinite(forced) && forced > 0) return Math.round(forced);

  // Tambor / bombona / IBC: volume de UMA unidade (editável), não o total do lote.
  if (labelRequiresManualVolume(container)) {
    const fromField = Number(container.volume_por_embalagem);
    if (Number.isFinite(fromField) && fromField > 0) return Math.round(fromField);

    const fromType = suggestLabelVolumePlaceholder(container.type || container.tipo);
    if (fromType) return Math.round(fromType);

    const plate = stripAggregatedQtyPrefix(
      container.container_number || container.placa || '',
    );
    const fromPlate = suggestLabelVolumePlaceholder(plate);
    if (fromPlate) return Math.round(fromPlate);

    return '';
  }

  const display = Number(containerDisplayVolume(container, productions));
  if (Number.isFinite(display) && display > 0) return Math.round(display);
  const stored = Number(container.volume);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
  return '';
}

function defaultTareForContainer(container) {
  const raw = container?.tare ?? container?.tara;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : '';
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
  expiryDate,
  publicToken: publicTokenOverride,
  resolvePublicToken,
  /** Volume já resolvido pela tela (tanque ou unidade). Evita race do useEffect. */
  initialVolume,
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const sessionKey = open && container
    ? String(container.id || `${container.container_number || ''}|${container.barril_number || ''}|${container.op_number || ''}`)
    : '';

  const seedVolume = useMemo(
    () => defaultVolumeForContainer(container, productions, initialVolume),
    // sessionKey força recálculo ao reabrir o mesmo container
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      sessionKey,
      container,
      productions,
      initialVolume,
      container?.volume,
      container?.volume_por_embalagem,
      container?.type,
      container?.tipo,
      container?.container_number,
      container?.placa,
    ],
  );

  const seedTare = useMemo(
    () =>
      labelRequiresManualVolume(container)
        ? defaultTareForContainer(container)
        : '',
    [container, sessionKey],
  );

  // null = usar seed; número/'' = valor editado pelo usuário
  const [volumeOverride, setVolumeOverride] = useState(null);
  const [tareOverride, setTareOverride] = useState(null);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [meta, setMeta] = useState(null);

  const dialogOpen = Boolean(open && container);
  const volume = volumeOverride !== null ? volumeOverride : seedVolume;
  const tare = tareOverride !== null ? tareOverride : seedTare;

  useEffect(() => {
    // Nova sessão: descarta edições locais e volta ao seed
    setVolumeOverride(null);
    setTareOverride(null);
    setQty(1);
  }, [sessionKey]);

  useEffect(() => {
    if (dialogOpen) return;
    setVolumeOverride(null);
    setTareOverride(null);
    setQty(1);
    setPrinting(false);
    setMeta(null);
  }, [dialogOpen]);

  const handleOpenChange = (nextOpen) => {
    if (nextOpen) {
      onOpenChange?.(true);
      return;
    }
    setPrinting(false);
    onOpenChange?.(false);
  };

  const manualVolume = labelRequiresManualVolume(container);
  const production = useMemo(
    () => productionOfContainer(container, productions || []),
    [container, productions],
  );
  const densityFromOverride = parseDensidade(densityOverride);
  const density = densityFromOverride > 0
    ? densityFromOverride
    : containerDensity(container, productions, recipes);
  const tareKg = manualVolume
    ? (Number(tare) || 0)
    : (Number(container?.tare ?? container?.tara) || 0);
  const weights = calcLabelWeightsFromVolume({ volume, density, tare: tareKg });
  const volumeOk = Number(volume) > 0;
  const qtyOk = Number.isFinite(Number(qty)) && Number(qty) >= 1;
  const embalagem = formatLabelEmbalagem(container);
  const dateOverride = containerLabelDateOverride(container);
  const fabDate =
    contexto === 'convencional'
      ? dateOverride?.manufactureDate || manufactureDate || null
      : dateOverride?.manufactureDate ||
        manufactureDate ||
        production?.end_time ||
        container?.created_date;
  const labelExpiry = dateOverride?.expiryDate || expiryDate || calcValidityDate(fabDate, meta?.validityDays);
  const volumePlaceholder = suggestLabelVolumePlaceholder(
    container?.type || container?.tipo || stripAggregatedQtyPrefix(container?.container_number || container?.placa || ''),
  );

  useEffect(() => {
    if (!dialogOpen || !container) return undefined;

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
  }, [dialogOpen, container?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        fillingDate: container?.created_date || undefined,
        expiryDate: labelExpiry || undefined,
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
      handleOpenChange(false);
    } catch (err) {
      toast({ title: t('errors.saveFailed'), description: err.message, variant: 'destructive' });
    } finally {
      setPrinting(false);
    }
  };

  const resolvedClienteNome =
    meta?.clienteNome || clienteNome || container?.client || container?.cliente_nome || production?.client || '';
  const resolvedLot = container?.lot || container?.lote || '';
  const showRepBrasilOfLotWarning = shouldWarnRepBrasilOfLot(resolvedClienteNome, resolvedLot);

  const previewValues = {
    product: container?.product || '—',
    client: resolvedClienteNome || '—',
    op_number: container?.op_number || '—',
    lot: resolvedLot || '—',
    manufactureDate: fabDate,
    fillingDate: container?.created_date || null,
    expiryDate: labelExpiry,
    net_weight: volumeOk ? weights.netWeight : 0,
    gross_weight: volumeOk ? weights.grossWeight : 0,
    volume: volumeOk ? Math.round(weights.volume) : null,
    embalagem,
    container_number: container?.container_number,
    barril_number: container?.barril_number,
    publicToken: meta?.publicToken,
    responsavel_tecnico: meta?.responsavelTecnico,
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-[760px] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('containers.vasilhames.printLabelTitle')}</DialogTitle>
        </DialogHeader>

        {container && (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            {showRepBrasilOfLotWarning && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-950"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
                <p>{t('containers.vasilhames.printLabelRepBrasilOfLotWarning')}</p>
              </div>
            )}

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
                  emphasis={contexto === 'industrializacao'}
                  campos={meta?.printConfig?.campos}
                  dateFormat={meta?.printConfig?.dateFormat}
                  orientation={meta?.printConfig?.orientation}
                  consultaPath={contexto === 'convencional' ? '/consulta-produto' : '/consulta'}
                  convencional={contexto === 'convencional'}
                  values={previewValues}
                />
              )}
            </div>

            <div className={`grid grid-cols-1 gap-4 ${manualVolume ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  {t('containers.fields.volume')} (L) *
                </label>
                <NumberInputBr
                  key={`vol-${sessionKey}-${seedVolume || 'empty'}`}
                  value={volume}
                  onChange={setVolumeOverride}
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
              {manualVolume && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    {t('containers.vasilhames.tare')}
                  </label>
                  <NumberInputBr
                    key={`tare-${sessionKey}`}
                    value={tare}
                    onChange={setTareOverride}
                    decimals={0}
                    min={0}
                    placeholder="0"
                    aria-label={t('containers.vasilhames.tare')}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('containers.vasilhames.printLabelTareHint')}
                  </p>
                </div>
              )}
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
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={printing}>
              {t('buttons.cancel')}
            </Button>
          </DialogClose>
          <Button
            type="button"
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
