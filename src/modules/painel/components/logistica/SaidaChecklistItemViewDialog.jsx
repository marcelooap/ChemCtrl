import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ClipboardList, Loader2, MinusCircle, Printer, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import SignedImage from '@industrializacao/components/SignedImage';
import { getSignedFileUrl } from '@industrializacao/api/storage';
import {
  CHECK_ANSWER,
  CHECKLIST_KIND,
  CHECKLIST_STATUS,
  checksForKind,
  normalizeCheckValue,
} from '@painel/lib/carregamentoChecklistConfig';
import { printChecklistItemA4 } from '@painel/lib/printChecklistItem';

const STATUS_STYLE = {
  [CHECKLIST_STATUS.PENDENTE]: 'bg-muted text-muted-foreground',
  [CHECKLIST_STATUS.EM_CONFERENCIA]: 'bg-amber-100 text-amber-800',
  [CHECKLIST_STATUS.APROVADO]: 'bg-emerald-100 text-emerald-800',
  [CHECKLIST_STATUS.REPROVADO]: 'bg-red-100 text-red-800',
};

const ANSWER_META = {
  [CHECK_ANSWER.APROVADO]: {
    icon: CheckCircle2,
    className: 'text-emerald-700',
    labelKey: 'painel.comercial.agendamentos.checklist.answers.aprovado',
  },
  [CHECK_ANSWER.REPROVADO]: {
    icon: XCircle,
    className: 'text-red-700',
    labelKey: 'painel.comercial.agendamentos.checklist.answers.reprovado',
  },
  [CHECK_ANSWER.NAO_SE_APLICA]: {
    icon: MinusCircle,
    className: 'text-slate-600',
    labelKey: 'painel.comercial.agendamentos.checklist.answers.naoSeAplica',
  },
};

function InfoChip({ label, value }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground break-words">{value || '—'}</p>
    </div>
  );
}

export default function SaidaChecklistItemViewDialog({
  open,
  onClose,
  item,
  saida,
}) {
  const { t, i18n } = useTranslation();
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!open) setPrinting(false);
  }, [open]);

  const checkDefs = useMemo(
    () => (item ? checksForKind(item.kind) : []),
    [item]
  );

  if (!item) return null;

  const statusLabel = (status) =>
    t(
      `painel.comercial.agendamentos.checklist.status.${
        {
          [CHECKLIST_STATUS.PENDENTE]: 'pendente',
          [CHECKLIST_STATUS.EM_CONFERENCIA]: 'emConferencia',
          [CHECKLIST_STATUS.APROVADO]: 'aprovado',
          [CHECKLIST_STATUS.REPROVADO]: 'reprovado',
        }[status] || 'pendente'
      }`
    );

  const sectionTitle = (section) =>
    t(`painel.comercial.agendamentos.checklist.sections.${section}`, {
      defaultValue: section,
    });

  const sections = [...new Set(checkDefs.map((c) => c.section))];

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const fotoUrls = [];
      for (const path of item.fotos || []) {
        try {
          const signed = await getSignedFileUrl(path);
          fotoUrls.push(signed || path);
        } catch {
          fotoUrls.push(path);
        }
      }
      printChecklistItemA4({
        item,
        saida,
        fotoUrls,
        t,
        language: i18n.language,
      });
    } catch (err) {
      window.alert(
        err?.message || t('painel.logistica.carregamentos.checklistPrintError')
      );
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="space-y-2 border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-[#2575D1]" />
            {t('painel.logistica.carregamentos.checklistItemTitle')}
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {saida?.codigo || item.saida_codigo} · {item.label}
            </p>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                STATUS_STYLE[item.status] || STATUS_STYLE.pendente
              )}
            >
              {statusLabel(item.status)}
            </span>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <InfoChip
              label={t('painel.comercial.agendamentos.checklist.fields.produto')}
              value={item.produto}
            />
            <InfoChip
              label={t('painel.comercial.agendamentos.checklist.fields.tipo')}
              value={item.tipo_label}
            />
            <InfoChip
              label={t('painel.comercial.agendamentos.checklist.fields.quantidade')}
              value={item.quantidade}
            />
            <InfoChip
              label={t('painel.comercial.agendamentos.checklist.fields.lote')}
              value={item.lote}
            />
            {item.kind === CHECKLIST_KIND.CONVENCIONAL ? (
              <InfoChip
                label={t('painel.comercial.agendamentos.checklist.fields.tanque')}
                value={
                  [item.vasilhame_placa, item.vasilhame_barril].filter(Boolean).join(' / ') ||
                  '—'
                }
              />
            ) : null}
            <InfoChip
              label={t('painel.comercial.agendamentos.checklist.fields.fabricacao')}
              value={formatDateSafe(item.data_fabricacao, i18n.language)}
            />
            <InfoChip
              label={t('painel.comercial.agendamentos.checklist.fields.validade')}
              value={formatDateSafe(item.data_validade, i18n.language)}
            />
          </div>

          {item.kind === CHECKLIST_KIND.CONVENCIONAL && item.lacres?.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('painel.comercial.agendamentos.checklist.sections.lacres')}
              </p>
              <div className="flex flex-wrap gap-2">
                {item.lacres.map((l, i) => (
                  <span
                    key={`${l.numero}-${i}`}
                    className="inline-flex rounded-md border border-border bg-muted/40 px-2.5 py-1 font-mono text-sm font-medium"
                  >
                    {l.numero}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {sections.map((section) => (
            <div key={section} className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {sectionTitle(section)}
              </p>
              {checkDefs
                .filter((c) => c.section === section)
                .map((c) => {
                  const answer = normalizeCheckValue(item.checks?.[c.key]);
                  const meta = ANSWER_META[answer];
                  const Icon = meta?.icon;
                  return (
                    <div
                      key={c.key}
                      className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <p className="text-sm leading-snug">{t(c.labelKey)}</p>
                      {meta ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 text-xs font-semibold',
                            meta.className
                          )}
                        >
                          {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                          {t(meta.labelKey)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  );
                })}
            </div>
          ))}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('painel.comercial.agendamentos.checklist.sections.fotos')}
            </p>
            {(item.fotos || []).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {item.fotos.map((url) => (
                  <SignedImage
                    key={url}
                    url={url}
                    alt={t('painel.comercial.agendamentos.checklist.photoAlt')}
                    className="h-20 w-20 rounded-lg border object-cover"
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('painel.logistica.carregamentos.checklistNoPhotos')}
              </p>
            )}
          </div>

          {item.conferido_em ? (
            <p className="text-xs text-muted-foreground">
              {t('painel.comercial.agendamentos.checklist.itemValidatedAt', {
                date: new Date(item.conferido_em).toLocaleString(i18n.language || 'pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                operador: item.conferido_por_nome || '—',
              })}
            </p>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border bg-muted/30 px-6 py-3 gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('buttons.close')}
          </Button>
          <Button type="button" onClick={handlePrint} disabled={printing} className="gap-2">
            {printing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Printer className="h-4 w-4" />
            )}
            {t('painel.logistica.carregamentos.checklistPrint')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDateSafe(value, language = 'pt-BR') {
  if (!value) return '—';
  const raw = String(value);
  const date = raw.includes('T') ? new Date(raw) : new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(language || 'pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
