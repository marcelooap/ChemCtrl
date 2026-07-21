import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Box,
  Flame,
  Link2,
  Loader2,
  Lock,
  Scale,
  Shield,
  Sparkles,
  Tag,
  Zap,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/components/ui/use-toast';
import {
  ANSWER,
  buildAnswersPayload,
  getEtapaCancelLabelKey,
  getEtapaConfirmLabelKey,
  getEtapaTitleKey,
  getQuestionsForEtapa,
  validateAnswers,
} from '@/lib/checklists/operationalChecklistConfig';
import { submitOperationalChecklist } from '@/lib/checklists/submitOperationalChecklist';
import { cn } from '@/lib/utils';

const ICON_MAP = {
  zap: Zap,
  flame: Flame,
  scale: Scale,
  box: Box,
  link: Link2,
  shield: Shield,
  lock: Lock,
  sparkles: Sparkles,
  alert: AlertTriangle,
  seal: Lock,
  tag: Tag,
};

/**
 * Modal genérico de checklist operacional.
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   etapa: string,
 *   production: object|null,
 *   recipe?: object|null,
 *   onCompleted: () => void | Promise<void>,
 * }} props
 */
export default function OperationalChecklistModal({
  open,
  onOpenChange,
  etapa,
  production,
  recipe = null,
  onCompleted,
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const questions = useMemo(() => getQuestionsForEtapa(etapa, recipe), [etapa, recipe]);
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAnswers({});
    setErrors({});
    setSubmitting(false);
    setAttempted(false);
  }, [open, etapa, production?.id]);

  const validation = useMemo(() => validateAnswers(questions, answers), [questions, answers]);
  const canSubmit = validation.ok && !submitting;

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

  const setObservation = (key, value) => {
    setAnswers((prev) => ({
      ...prev,
      [key]: { ...prev[key], observacao: value },
    }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleConfirm = async () => {
    setAttempted(true);
    const result = validateAnswers(questions, answers);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    if (!production?.id) return;

    setSubmitting(true);
    try {
      const payload = buildAnswersPayload(questions, answers, t);
      await submitOperationalChecklist({
        productionId: production.id,
        etapa,
        answers: payload,
      });
      await onCompleted?.();
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast({
        title: t('production.operationalChecklist.submitError'),
        description: err?.message || String(err),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (submitting) return;
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (submitting) return;
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] w-[min(70vw,48rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0"
        onInteractOutside={(e) => submitting && e.preventDefault()}
        onEscapeKeyDown={(e) => submitting && e.preventDefault()}
      >
        <DialogHeader className="flex-shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-bold">
            {t(getEtapaTitleKey(etapa))}
          </DialogTitle>
          {production && (
            <p className="text-xs text-muted-foreground">
              {t('production.operationalChecklist.subtitle', {
                op: production.op_number || '—',
                product: production.product || '—',
              })}
            </p>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {questions.map((q) => {
            const Icon = ICON_MAP[q.icon] || AlertTriangle;
            const state = answers[q.key] || {};
            const errorKey = errors[q.key] || (attempted ? validation.errors[q.key] : null);
            const showError = Boolean(errorKey);
            const showObs =
              q.observationWhen != null && state.answer === q.observationWhen;
            const answerBlocks =
              state.answer &&
              ((q.requiredAnswer && state.answer !== q.requiredAnswer) ||
                (q.allowedAnswers && !q.allowedAnswers.includes(state.answer)));

            return (
              <div
                key={q.key}
                className={cn(
                  'rounded-xl border bg-card p-4 shadow-sm transition-colors',
                  showError || answerBlocks
                    ? 'border-red-400 bg-red-50/60'
                    : 'border-border',
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg',
                      showError || answerBlocks ? 'bg-red-100' : 'bg-muted',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4',
                        showError || answerBlocks ? 'text-red-600' : 'text-muted-foreground',
                      )}
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    {q.type === 'checkbox' ? (
                      <div className="space-y-2">
                        <label className="flex cursor-pointer items-start gap-3">
                          <Checkbox
                            checked={state.answer === ANSWER.CONFIRMADO}
                            onCheckedChange={(checked) =>
                              setAnswer(q.key, checked ? ANSWER.CONFIRMADO : '')
                            }
                            disabled={submitting}
                            className="mt-0.5"
                          />
                          <span className="text-sm font-medium leading-snug">
                            {t(q.labelKey)}
                          </span>
                        </label>
                        {q.helperKey && (
                          <p className="pl-7 text-xs text-muted-foreground">{t(q.helperKey)}</p>
                        )}
                      </div>
                    ) : (
                      <>
                        <p className="mb-3 text-sm font-medium leading-snug">{t(q.labelKey)}</p>
                        <RadioGroup
                          value={state.answer || ''}
                          onValueChange={(v) => setAnswer(q.key, v)}
                          disabled={submitting}
                          className="flex flex-wrap gap-3"
                        >
                          {(q.options || []).map((opt) => {
                            const id = `${q.key}-${opt.value}`;
                            const isBlockedOption =
                              q.allowedAnswers &&
                              state.answer === opt.value &&
                              !q.allowedAnswers.includes(opt.value);
                            return (
                              <div key={opt.value} className="flex items-center gap-2">
                                <RadioGroupItem value={opt.value} id={id} />
                                <Label
                                  htmlFor={id}
                                  className={cn(
                                    'cursor-pointer text-sm font-normal',
                                    isBlockedOption && 'font-semibold text-red-700',
                                  )}
                                >
                                  {t(opt.labelKey)}
                                </Label>
                              </div>
                            );
                          })}
                        </RadioGroup>
                      </>
                    )}

                    {(showError || answerBlocks) && (
                      <p className="mt-2 text-xs font-medium text-red-600">
                        {t(
                          errorKey ||
                            q.blockMessageKey ||
                            'production.operationalChecklist.errors.invalidAnswer',
                        )}
                      </p>
                    )}

                    {showObs && (
                      <div className="mt-3 space-y-1.5">
                        <Label className="text-xs font-medium">
                          {t('production.operationalChecklist.observation')}
                          {q.observationRequiredWhen === state.answer && (
                            <span className="ml-1 text-red-600">*</span>
                          )}
                        </Label>
                        <Textarea
                          value={state.observacao || ''}
                          onChange={(e) => setObservation(q.key, e.target.value)}
                          placeholder={t('production.operationalChecklist.observationPlaceholder')}
                          disabled={submitting}
                          className="min-h-[72px] resize-y"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-border bg-muted/30 px-6 py-3">
          <Button variant="outline" onClick={handleCancel} disabled={submitting}>
            {t(getEtapaCancelLabelKey(etapa))}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="text-white"
            style={{ background: canSubmit ? '#1e40af' : '#94a3b8' }}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('common.saving')}
              </>
            ) : (
              t(getEtapaConfirmLabelKey(etapa))
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
