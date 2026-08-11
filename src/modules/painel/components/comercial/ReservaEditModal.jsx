import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { Label } from '@shared/components/ui/label';
import { Textarea } from '@shared/components/ui/textarea';
import NumberInputBr from '@transbordo/components/NumberInputBr';
import { formatQty } from '@painel/lib/materialReservas';

export default function ReservaEditModal({ open, onClose, onSave, row }) {
  const { t } = useTranslation();
  const [quantidade, setQuantidade] = useState('');
  const [observacao, setObservacao] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!open || !row) return;
    setQuantidade(row.saldoReservado ?? 0);
    setObservacao('');
    setError('');
    savingRef.current = false;
    setSaving(false);
  }, [open, row]);

  if (!row) return null;

  const qtd = Math.round(Number(quantidade) || 0);
  const max = Math.round(Number(row.saldoAtual) || 0);
  const saldoFinalPreview = Math.max(0, max - qtd);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;

    if (qtd < 0) {
      setError(t('painel.comercial.reservarMaterial.errors.negative'));
      return;
    }
    if (qtd > max) {
      setError(
        t('painel.comercial.reservarMaterial.errors.exceedsBalance', {
          max: formatQty(max, row.unidade),
          unidade: row.unidade,
        })
      );
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave({
        quantidade: qtd,
        observacao: observacao.trim(),
      });
      onClose();
    } catch (err) {
      setError(err?.message || t('painel.comercial.reservarMaterial.errors.saveFailed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('painel.comercial.reservarMaterial.editTitle')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-1.5">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                {t('painel.comercial.reservarMaterial.columns.cliente')}
              </span>
              <span className="font-medium text-right">{row.clienteNome}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                {t('painel.comercial.reservarMaterial.columns.produto')}
              </span>
              <span className="font-medium text-right">
                {row.codigo} — {row.produto}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                {t('painel.comercial.reservarMaterial.columns.lote')}
              </span>
              <span className="font-mono text-right">{row.lote}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                {t('painel.comercial.reservarMaterial.columns.saldoAtual')}
              </span>
              <span className="font-semibold tabular-nums text-right">
                {formatQty(row.saldoAtual, row.unidade)} {row.unidade}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reserva-qtd">
              {t('painel.comercial.reservarMaterial.reservedQty')} ({row.unidade})
            </Label>
            <NumberInputBr
              id="reserva-qtd"
              value={quantidade}
              onChange={setQuantidade}
              decimals={0}
              min={0}
              max={max}
              aria-label={t('painel.comercial.reservarMaterial.reservedQty')}
            />
            <p className="text-xs text-muted-foreground">
              {t('painel.comercial.reservarMaterial.finalPreview', {
                value: formatQty(saldoFinalPreview, row.unidade),
                unidade: row.unidade,
              })}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reserva-obs">
              {t('painel.comercial.reservarMaterial.observation')}
            </Label>
            <Textarea
              id="reserva-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={3}
              placeholder={t('painel.comercial.reservarMaterial.observationPlaceholder')}
            />
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {t('buttons.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? t('painel.comercial.reservarMaterial.saving')
                : t('buttons.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
