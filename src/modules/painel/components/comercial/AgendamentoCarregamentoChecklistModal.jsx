import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Package,
  Shield,
  Truck,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { Label } from '@shared/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/components/ui/radio-group';
import { Can } from '@industrializacao/lib/rbac/Can';
import { cn } from '@shared/lib/utils';
import {
  buildCarregamentoChecklistPayload,
  getCarregamentoChecklistQuestions,
  parseStoredCarregamentoChecklistAnswers,
  validateCarregamentoChecklistAnswers,
} from '@painel/lib/carregamentoChecklistConfig';
import {
  ENCAIXE_HORARIO,
  formatDateBR,
  normalizeBookings,
  summarizeSlotBookings,
} from '@painel/lib/agendamentosCarregamento';

const ICON_MAP = {
  file: FileText,
  shield: Shield,
  truck: Truck,
  package: Package,
};

export default function AgendamentoCarregamentoChecklistModal({
  open,
  onClose,
  bookings,
  permissionPrefix = 'painel_logistica_agendamentos',
  onConfirm,
}) {
  const { t, i18n } = useTranslation();
  const questions = useMemo(() => getCarregamentoChecklistQuestions(), []);
  const list = normalizeBookings(bookings);
  const summary = summarizeSlotBookings(list);
  const booking = summary.first;

  const readOnly = Boolean(booking?.checklist_validado_em);
  const storedAnswers = useMemo(
    () => parseStoredCarregamentoChecklistAnswers(booking?.checklist_respostas),
    [booking?.checklist_respostas]
  );

  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !booking) return;
    setAnswers(readOnly ? storedAnswers : {});
    setErrors({});
    setSubmitting(false);
    setAttempted(false);
    setError('');
  }, [open, booking?.id, readOnly, storedAnswers]);

  const validation = useMemo(
    () => validateCarregamentoChecklistAnswers(questions, answers),
    [questions, answers]
  );
  const canSubmit = validation.ok && !submitting && !readOnly;

  const setAnswer = (key, value) => {
    setAnswers((prev) => ({
      ...prev,
      [key]: { ...prev[key], answer: value },
    }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (readOnly) return;
    setAttempted(true);
    const result = validateCarregamentoChecklistAnswers(questions, answers);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const payload = buildCarregamentoChecklistPayload(questions, answers, t);
      await onConfirm({ respostas: payload });
      onClose();
    } catch (err) {
      setError(
        err?.message || t('painel.comercial.agendamentos.checklist.submitError')
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!booking) return null;

  const horarioLabel =
    booking.horario === ENCAIXE_HORARIO
      ? t('painel.comercial.agendamentos.encaixe')
      : booking.horario;

  const validatedAtLabel = booking.checklist_validado_em
    ? new Date(booking.checklist_validado_em).toLocaleString(i18n.language || 'pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="space-y-1 border-b border-border px-6 py-4">
          <DialogTitle>{t('painel.comercial.agendamentos.checklist.title')}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('painel.comercial.agendamentos.modal.slotLabel', {
              date: formatDateBR(String(booking.data).slice(0, 10)),
              time: horarioLabel,
            })}
            {summary.codesLabel && summary.codesLabel !== '—'
              ? ` · ${summary.codesLabel}`
              : ''}
          </p>
          {summary.clientesLabel && summary.clientesLabel !== '—' ? (
            <p className="text-sm text-muted-foreground">{summary.clientesLabel}</p>
          ) : null}
          {readOnly ? (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  {t('painel.comercial.agendamentos.checklist.readOnlyBadge')}
                </p>
                {validatedAtLabel ? (
                  <p className="text-xs mt-0.5 opacity-90">
                    {t('painel.comercial.agendamentos.checklist.validatedAt', {
                      date: validatedAtLabel,
                      operador: booking.checklist_operador_nome || '—',
                    })}
                  </p>
                ) : null}
                <p className="text-xs mt-1 opacity-80">
                  {t('painel.comercial.agendamentos.checklist.editSoonHint')}
                </p>
              </div>
            </div>
          ) : null}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {questions.map((q) => {
              const Icon = ICON_MAP[q.icon] || FileText;
              const state = answers[q.key] || {};
              const errorKey = errors[q.key];
              const showError = attempted && Boolean(errorKey);
              const answerBlocks =
                q.requiredAnswer && state.answer && state.answer !== q.requiredAnswer;

              return (
                <div
                  key={q.key}
                  className={cn(
                    'rounded-lg border p-3',
                    showError || answerBlocks
                      ? 'border-red-200 bg-red-50/40'
                      : 'border-border',
                    readOnly && 'opacity-90',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                        showError || answerBlocks ? 'bg-red-100' : 'bg-muted',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4',
                          showError || answerBlocks ? 'text-red-600' : 'text-muted-foreground',
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="mb-3 text-sm font-medium leading-snug">{t(q.labelKey)}</p>
                      {readOnly ? (
                        <p className="text-sm font-semibold text-foreground">
                          {state.answer === 'sim'
                            ? t('production.operationalChecklist.answers.yes')
                            : state.answer === 'nao'
                              ? t('production.operationalChecklist.answers.no')
                              : '—'}
                        </p>
                      ) : (
                        <RadioGroup
                          value={state.answer || ''}
                          onValueChange={(v) => setAnswer(q.key, v)}
                          disabled={submitting}
                          className="flex flex-wrap gap-3"
                        >
                          {(q.options || []).map((opt) => {
                            const id = `${q.key}-${opt.value}`;
                            return (
                              <div key={opt.value} className="flex items-center gap-2">
                                <RadioGroupItem value={opt.value} id={id} />
                                <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
                                  {t(opt.labelKey)}
                                </Label>
                              </div>
                            );
                          })}
                        </RadioGroup>
                      )}
                      {(showError || answerBlocks) && !readOnly ? (
                        <p className="mt-2 text-xs font-medium text-red-600">
                          {t(
                            errorKey ||
                              q.blockMessageKey ||
                              'painel.comercial.agendamentos.checklist.errors.mustBeYes',
                          )}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {error ? (
            <div className="mx-6 mb-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <DialogFooter className="border-t border-border bg-muted/30 px-6 py-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {readOnly ? t('buttons.close') : t('buttons.cancel')}
            </Button>
            {!readOnly ? (
              <Can anyOf={[`${permissionPrefix}.edit`, `${permissionPrefix}.view`]}>
                <Button type="submit" disabled={!canSubmit}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('painel.comercial.agendamentos.saving')}
                    </>
                  ) : (
                    t('painel.comercial.agendamentos.checklist.confirm')
                  )}
                </Button>
              </Can>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
