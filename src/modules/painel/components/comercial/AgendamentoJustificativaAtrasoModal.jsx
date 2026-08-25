import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, Building2, ClipboardList } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { Label } from '@shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Can } from '@industrializacao/lib/rbac/Can';
import { cn } from '@shared/lib/utils';
import {
  ENCAIXE_HORARIO,
  formatDateBR,
  JUSTIFICATIVA_ATRASO_MOTIVOS,
  JUSTIFICATIVA_ATRASO_RESPONSAVEIS,
  normalizeBookings,
  summarizeSlotBookings,
} from '@painel/lib/agendamentosCarregamento';

export default function AgendamentoJustificativaAtrasoModal({
  open,
  onClose,
  bookings,
  pendingPayload,
  permissionPrefix = 'painel_logistica_agendamentos',
  onConfirm,
}) {
  const { t } = useTranslation();
  const [responsavel, setResponsavel] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const list = normalizeBookings(bookings);
  const summary = summarizeSlotBookings(list);
  const booking = summary.first;

  useEffect(() => {
    if (!open) return;
    setResponsavel('');
    setMotivo('');
    setError('');
    setSaving(false);
    savingRef.current = false;
  }, [open, booking?.id, pendingPayload?.horaCarregamento, pendingPayload?.dataCarregamento]);

  if (!booking || !pendingPayload) return null;

  const horarioLabel =
    booking.horario === ENCAIXE_HORARIO
      ? t('painel.comercial.agendamentos.encaixe')
      : booking.horario;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;
    if (!responsavel || !motivo) {
      setError(t('painel.comercial.agendamentos.justificativa.required'));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onConfirm({
        horaCarregamento: pendingPayload.horaCarregamento,
        dataCarregamento: pendingPayload.dataCarregamento,
        justificativa: { responsavel, motivo },
      });
      onClose();
    } catch (err) {
      setError(
        err?.message || t('painel.comercial.agendamentos.errors.concluirFailed')
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-2">
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            {t('painel.comercial.agendamentos.justificativa.title')}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('painel.comercial.agendamentos.justificativa.subtitle')}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('painel.comercial.agendamentos.modal.slotLabel', {
              date: formatDateBR(String(booking.data).slice(0, 10)),
              time: horarioLabel,
            })}
            {summary.codesLabel && summary.codesLabel !== '—'
              ? ` · ${summary.codesLabel}`
              : ''}
            {' · '}
            {formatDateBR(pendingPayload.dataCarregamento)} {pendingPayload.horaCarregamento}
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div
            className={cn(
              'rounded-xl border p-4 space-y-3',
              responsavel ? 'border-amber-300 bg-amber-50/40' : 'border-border bg-card'
            )}
          >
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <Building2 className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t('painel.comercial.agendamentos.justificativa.responsavelTitle')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('painel.comercial.agendamentos.justificativa.responsavelHint')}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('painel.comercial.agendamentos.justificativa.responsavelLabel')}</Label>
              <Select value={responsavel} onValueChange={setResponsavel} disabled={saving}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t('painel.comercial.agendamentos.justificativa.responsavelPlaceholder')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {JUSTIFICATIVA_ATRASO_RESPONSAVEIS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div
            className={cn(
              'rounded-xl border p-4 space-y-3',
              motivo ? 'border-[#2575D1]/30 bg-[#2575D1]/5' : 'border-border bg-card'
            )}
          >
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-[#2575D1]">
                <ClipboardList className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t('painel.comercial.agendamentos.justificativa.motivoTitle')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('painel.comercial.agendamentos.justificativa.motivoHint')}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('painel.comercial.agendamentos.justificativa.motivoLabel')}</Label>
              <Select value={motivo} onValueChange={setMotivo} disabled={saving}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t('painel.comercial.agendamentos.justificativa.motivoPlaceholder')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {JUSTIFICATIVA_ATRASO_MOTIVOS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {t('buttons.cancel')}
            </Button>
            <Can anyOf={[`${permissionPrefix}.edit`, `${permissionPrefix}.view`]}>
              <Button type="submit" disabled={saving || !responsavel || !motivo}>
                {saving
                  ? t('painel.comercial.agendamentos.saving')
                  : t('painel.comercial.agendamentos.justificativa.confirm')}
              </Button>
            </Can>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
