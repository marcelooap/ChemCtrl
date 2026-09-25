import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
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
import { buildEquipmentLabelData, printEquipmentLabel } from '@industrializacao/lib/labelprint';
import { ensureEquipmentPublicToken } from '@industrializacao/lib/ensurePublicToken';

function PreviewRow({ label, value, stacked = false }) {
  if (stacked) {
    return (
      <div className="min-w-0">
        <div className="text-[8px] font-extrabold uppercase leading-none tracking-wide">{label}</div>
        <div className="mt-px truncate text-[11px] font-bold leading-tight">{value}</div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-baseline gap-1 text-[11px] leading-tight">
      <span className="shrink-0 font-extrabold uppercase">{label}</span>
      <span className="shrink-0 font-bold text-black/80">•</span>
      <span className="min-w-0 flex-1 truncate font-bold">{value}</span>
    </div>
  );
}

function EquipmentLabelPreview({ equipment, publicToken }) {
  const { t, i18n } = useTranslation();
  if (!equipment) return null;
  const data = buildEquipmentLabelData(equipment, { lang: i18n.language, t, publicToken });
  const left = [
    ['type', data.type],
    ['manufacturer', data.manufacturer],
    ['model', data.model],
    ['serial', data.serial],
    ['certificate', data.certificate],
  ];
  const right = [
    ['lastCalibration', data.lastCalibration],
    ['nextCalibration', data.nextCalibration],
    ['status', data.status],
  ];

  return (
    <div className="flex justify-center">
      <div
        className="flex flex-col overflow-hidden border border-black bg-white text-black shadow-lg"
        style={{ width: 420, height: 200, padding: '5px 12px' }}
      >
        <div className="shrink-0 whitespace-nowrap text-[17px] font-extrabold leading-none">{data.name}</div>
        <div className="flex min-h-0 flex-1 overflow-hidden pt-1">
          <div className="flex min-w-0 flex-1 flex-col pr-2">
            <div className="flex min-h-0 flex-1 gap-2">
              <div className="flex min-w-0 flex-1 flex-col justify-between pb-0.5">
                {left.map(([key, value]) => (
                  <PreviewRow key={key} label={data.labels[key]} value={value} />
                ))}
              </div>
              <div className="flex w-[34%] shrink-0 flex-col justify-start gap-1.5">
                {right.map(([key, value]) => (
                  <PreviewRow key={key} stacked label={data.labels[key]} value={value} />
                ))}
              </div>
            </div>
            <div className="flex min-w-0 items-baseline gap-1 text-[11px] leading-tight">
              <span className="shrink-0 font-extrabold uppercase">{data.labels.responsible}</span>
              <span className="shrink-0 font-bold text-black/80">•</span>
              <span className="min-w-0 font-bold">{data.responsible}</span>
            </div>
          </div>
          <div className="flex w-[88px] shrink-0 flex-col items-center border-l border-black pl-2">
            <div className="flex flex-1 items-center justify-center py-0.5">
              {data.qrText ? (
                <QRCodeSVG value={data.qrText} size={64} level="M" bgColor="#ffffff" fgColor="#000000" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
              )}
            </div>
            <div className="text-center text-[6px] font-bold uppercase leading-tight">{data.labels.qrHint}</div>
          </div>
        </div>
        <div className="mt-0.5 flex min-w-0 shrink-0 items-baseline gap-1 text-[11px] font-extrabold uppercase">
          <span className="shrink-0">{data.labels.location}</span>
          <span className="shrink-0 font-bold text-black/80">•</span>
          <span className="min-w-0 flex-1 truncate text-[12px]">{data.location}</span>
        </div>
      </div>
    </div>
  );
}

export default function PrintEquipmentLabelDialog({ open, onOpenChange, equipment }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const sessionKey = open && equipment ? String(equipment.id || equipment.name || '') : '';
  const [formSession, setFormSession] = useState('');
  const [qty, setQty] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [publicToken, setPublicToken] = useState('');
  const [preparing, setPreparing] = useState(false);

  if (sessionKey !== formSession) {
    setFormSession(sessionKey);
    setQty(1);
    setPublicToken(equipment?.public_token || '');
  }

  useEffect(() => {
    if (!open || !equipment?.id) return undefined;
    let cancelled = false;
    (async () => {
      setPreparing(true);
      try {
        const token = await ensureEquipmentPublicToken(equipment);
        if (!cancelled) setPublicToken(token || '');
      } catch (err) {
        if (!cancelled) {
          setPublicToken('');
          toast({
            title: t('quality.equipment.card.printLabel'),
            description: err?.message || t('quality.equipment.label.printFailed', { message: '' }),
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setPreparing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, equipment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const qtyOk = Number.isFinite(Number(qty)) && Number(qty) >= 1;

  const handlePrint = async () => {
    if (!equipment || !qtyOk) {
      toast({
        title: t('quality.equipment.card.printLabel'),
        description: t('quality.equipment.label.qtyRequired'),
        variant: 'destructive',
      });
      return;
    }
    setPrinting(true);
    try {
      await printEquipmentLabel(equipment, {
        copies: Math.round(Number(qty)),
        locale: i18n.language,
        publicToken,
      });
      onOpenChange?.(false);
    } catch (err) {
      toast({
        title: t('quality.equipment.card.printLabel'),
        description: err?.message || t('quality.equipment.label.printFailed', { message: '' }),
        variant: 'destructive',
      });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-[760px] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('quality.equipment.card.printLabel')}</DialogTitle>
        </DialogHeader>

        {equipment && (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <div className="overflow-x-auto rounded-lg bg-muted/40 px-3 py-4">
              <EquipmentLabelPreview equipment={equipment} publicToken={publicToken} />
            </div>

            <div className="max-w-xs">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('quality.equipment.label.qty')} *
              </label>
              <NumberInputBr
                key={`qty-${sessionKey}`}
                value={qty}
                onChange={(v) => setQty(v === '' ? '' : Math.max(1, Math.round(Number(v) || 1)))}
                decimals={0}
                min={1}
                placeholder="1"
                aria-label={t('quality.equipment.label.qty')}
              />
            </div>
          </div>
        )}

        <DialogFooter className="mt-2 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange?.(false)} disabled={printing}>
            {t('buttons.cancel')}
          </Button>
          <Button
            onClick={handlePrint}
            disabled={printing || preparing || !qtyOk || !publicToken}
            className="text-white"
            style={{ background: '#2575D1' }}
          >
            {printing
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('quality.equipment.label.printing')}</>
              : <><Printer className="w-4 h-4 mr-2" /> {t('quality.equipment.label.confirm')}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
