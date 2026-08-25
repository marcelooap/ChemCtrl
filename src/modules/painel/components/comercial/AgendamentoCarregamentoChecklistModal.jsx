import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Container,
  Loader2,
  MinusCircle,
  Package,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { Can } from '@industrializacao/lib/rbac/Can';
import { cn } from '@shared/lib/utils';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { uploadFileToSupabase } from '@industrializacao/api/storage';
import SignedImage from '@industrializacao/components/SignedImage';
import {
  ENCAIXE_HORARIO,
  formatDateBR,
  normalizeBookings,
  summarizeSlotBookings,
} from '@painel/lib/agendamentosCarregamento';
import {
  CHECK_ANSWER,
  CHECKLIST_KIND,
  CHECKLIST_STATUS,
  areAllItemsApproved,
  buildChecklistItemsFromSaidas,
  buildChecklistPayloadV2,
  checksForKind,
  computeChecksSummary,
  computeItemStatus,
  hasRejectedItem,
  mergeChecklistItems,
  parseStoredChecklist,
} from '@painel/lib/carregamentoChecklistConfig';

const STATUS_STYLE = {
  [CHECKLIST_STATUS.PENDENTE]: 'bg-muted text-muted-foreground',
  [CHECKLIST_STATUS.EM_CONFERENCIA]: 'bg-amber-100 text-amber-800',
  [CHECKLIST_STATUS.APROVADO]: 'bg-emerald-100 text-emerald-800',
  [CHECKLIST_STATUS.REPROVADO]: 'bg-red-100 text-red-800',
};

const STATUS_ICON = {
  [CHECKLIST_STATUS.APROVADO]: CheckCircle2,
  [CHECKLIST_STATUS.REPROVADO]: XCircle,
};

function StatusBadge({ status, label, className }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        STATUS_STYLE[status] || STATUS_STYLE[CHECKLIST_STATUS.PENDENTE],
        className
      )}
    >
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {label}
    </span>
  );
}

function InfoChip({ label, value }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground break-words">{value || '—'}</p>
    </div>
  );
}

const ANSWER_OPTIONS = [
  {
    value: CHECK_ANSWER.APROVADO,
    icon: CheckCircle2,
    labelKey: 'painel.comercial.agendamentos.checklist.answers.aprovado',
    active: 'bg-emerald-600 border-emerald-600 text-white',
    idle: 'border-border text-muted-foreground hover:border-emerald-400 hover:text-emerald-700',
  },
  {
    value: CHECK_ANSWER.REPROVADO,
    icon: XCircle,
    labelKey: 'painel.comercial.agendamentos.checklist.answers.reprovado',
    active: 'bg-red-600 border-red-600 text-white',
    idle: 'border-border text-muted-foreground hover:border-red-400 hover:text-red-700',
  },
  {
    value: CHECK_ANSWER.NAO_SE_APLICA,
    icon: MinusCircle,
    labelKey: 'painel.comercial.agendamentos.checklist.answers.naoSeAplica',
    active: 'bg-slate-500 border-slate-500 text-white',
    idle: 'border-border text-muted-foreground hover:border-slate-400 hover:text-slate-700',
  },
];

function CheckAnswerRow({ label, value, disabled, onChange, t, options = ANSWER_OPTIONS }) {
  const isRejected = value === CHECK_ANSWER.REPROVADO;
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between',
        isRejected ? 'border-red-200 bg-red-50/50' : 'border-border bg-background'
      )}
    >
      <p className="text-sm leading-snug sm:flex-1">{label}</p>
      <div className="flex shrink-0 gap-1.5">
        {options.map((opt) => {
          const Icon = opt.icon;
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(selected ? '' : opt.value)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-default',
                selected ? opt.active : opt.idle
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(opt.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const APPROVE_REJECT_OPTIONS = ANSWER_OPTIONS.filter(
  (o) => o.value === CHECK_ANSWER.APROVADO || o.value === CHECK_ANSWER.REPROVADO
);

export default function AgendamentoCarregamentoChecklistModal({
  open,
  onClose,
  bookings,
  saidas = [],
  vasilhames = [],
  entradas = [],
  permissionPrefix = 'painel_logistica_agendamentos',
  onSaveProgress,
  onLiberar,
}) {
  const { t, i18n } = useTranslation();
  const { user } = useInternalAuth();
  const photoInputRef = useRef(null);

  const list = normalizeBookings(bookings);
  const summary = summarizeSlotBookings(list);
  const booking = summary.first;
  const lockedByLiberation =
    Boolean(booking?.checklist_validado_em) &&
    areAllItemsApproved(parseStoredChecklist(booking?.checklist_respostas).items);
  const isCarregado = list.length > 0 && list.every((r) => r.status === 'concluido');
  const readOnly = isCarregado || lockedByLiberation;

  const builtItems = useMemo(
    () =>
      buildChecklistItemsFromSaidas({
        bookings: list,
        saidas,
        vasilhames,
        entradas,
      }),
    [list, saidas, vasilhames, entradas]
  );

  const [items, setItems] = useState([]);
  const [activeKey, setActiveKey] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const dirtyRef = useRef(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (!booking || initializedRef.current) return;
    initializedRef.current = true;
    const stored = parseStoredChecklist(booking.checklist_respostas);
    setItems(mergeChecklistItems(builtItems, stored.items));
    setActiveKey(null);
    setSaving(false);
    setUploading(false);
    setError('');
    dirtyRef.current = false;
  }, [open, booking, builtItems]);

  // Reconcilia quando saídas/vasilhames carregam depois da abertura, sem perder progresso local
  useEffect(() => {
    if (!open || !initializedRef.current || builtItems.length === 0) return;
    setItems((prev) => {
      if (prev.length === 0) {
        const stored = parseStoredChecklist(booking?.checklist_respostas);
        return mergeChecklistItems(builtItems, stored.items);
      }
      return mergeChecklistItems(builtItems, prev);
    });
  }, [builtItems, open, booking?.checklist_respostas]);

  const active = activeKey ? items.find((it) => it.item_key === activeKey) || null : null;
  const allApproved = areAllItemsApproved(items);
  const anyRejected = hasRejectedItem(items);
  const doneCount = items.filter(
    (it) => it.status === CHECKLIST_STATUS.APROVADO || it.status === CHECKLIST_STATUS.REPROVADO
  ).length;
  const operadorNome =
    user?.nome || user?.full_name || user?.username || user?.email || '—';

  const statusLabel = (status) =>
    t(`painel.comercial.agendamentos.checklist.status.${
      {
        [CHECKLIST_STATUS.PENDENTE]: 'pendente',
        [CHECKLIST_STATUS.EM_CONFERENCIA]: 'emConferencia',
        [CHECKLIST_STATUS.APROVADO]: 'aprovado',
        [CHECKLIST_STATUS.REPROVADO]: 'reprovado',
      }[status] || 'pendente'
    }`);

  const updateItem = (itemKey, updater) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.item_key !== itemKey) return it;
        const next = updater(it);
        const status = computeItemStatus(next.kind, next.checks);
        const wasFinal =
          it.status === CHECKLIST_STATUS.APROVADO || it.status === CHECKLIST_STATUS.REPROVADO;
        const isFinal =
          status === CHECKLIST_STATUS.APROVADO || status === CHECKLIST_STATUS.REPROVADO;
        return {
          ...next,
          status,
          conferido_em: isFinal ? (wasFinal && it.conferido_em ? it.conferido_em : new Date().toISOString()) : null,
          conferido_por_id: isFinal ? (user?.id != null ? String(user.id) : null) : null,
          conferido_por_nome: isFinal ? operadorNome : null,
        };
      })
    );
    dirtyRef.current = true;
    setError('');
  };

  const setAnswer = (key, value) => {
    if (!active || readOnly) return;
    updateItem(active.item_key, (it) => ({
      ...it,
      checks: { ...it.checks, [key]: value },
    }));
  };

  const persist = async (nextItems, { markValidated = false } = {}) => {
    const payload = buildChecklistPayloadV2({ items: nextItems, user });
    await onSaveProgress?.({
      payload,
      markValidated: markValidated || areAllItemsApproved(nextItems),
    });
    dirtyRef.current = false;
    return payload;
  };

  const saveIfDirty = async (currentItems) => {
    if (!dirtyRef.current || readOnly) return;
    try {
      await persist(currentItems);
    } catch {
      // best-effort; erro exibido apenas em ações explícitas
    }
  };

  const handleBackToList = async () => {
    setActiveKey(null);
    await saveIfDirty(items);
  };

  const handleClose = async () => {
    if (saving) return;
    onClose();
    await saveIfDirty(items);
  };

  const handleLiberar = async () => {
    if (!allApproved || readOnly) return;
    setSaving(true);
    setError('');
    try {
      const payload = await persist(items, { markValidated: true });
      const stamped = list.map((row) => ({
        ...row,
        checklist_respostas: payload,
        checklist_validado_em: new Date().toISOString(),
        checklist_operador_id: user?.id != null ? String(user.id) : null,
        checklist_operador_nome: operadorNome,
      }));
      await onLiberar?.(stamped);
    } catch (err) {
      setError(err?.message || t('painel.comercial.agendamentos.checklist.liberarError'));
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || !active || readOnly) return;
    setUploading(true);
    setError('');
    try {
      const urls = [];
      for (const file of files) {
        const url = await uploadFileToSupabase(file, 'fotos-cq');
        urls.push(url);
      }
      updateItem(active.item_key, (it) => ({
        ...it,
        fotos: [...(it.fotos || []), ...urls],
      }));
    } catch (err) {
      setError(err?.message || t('painel.comercial.agendamentos.checklist.photoError'));
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (url) => {
    if (!active || readOnly) return;
    updateItem(active.item_key, (it) => ({
      ...it,
      fotos: (it.fotos || []).filter((f) => f !== url),
    }));
  };

  if (!booking) return null;

  const horarioLabel =
    booking.horario === ENCAIXE_HORARIO
      ? t('painel.comercial.agendamentos.encaixe')
      : booking.horario;

  const checkDefs = active ? checksForKind(active.kind) : [];
  const sections = [...new Set(checkDefs.map((c) => c.section))];
  const sectionTitle = (section) =>
    t(`painel.comercial.agendamentos.checklist.sections.${section}`, { defaultValue: section });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && handleClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {/* Cabeçalho */}
        <DialogHeader className="space-y-2 border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-[#2575D1]" />
            {t('painel.comercial.agendamentos.checklist.title')}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('painel.comercial.agendamentos.modal.slotLabel', {
              date: formatDateBR(String(booking.data).slice(0, 10)),
              time: horarioLabel,
            })}
            {summary.codesLabel && summary.codesLabel !== '—' ? ` · ${summary.codesLabel}` : ''}
          </p>

          {items.length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">
                  {t('painel.comercial.agendamentos.checklist.progress', {
                    done: doneCount,
                    total: items.length,
                  })}
                </span>
                {allApproved ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t('painel.comercial.agendamentos.checklist.status.aprovado')}
                  </span>
                ) : anyRejected ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                    <XCircle className="h-3.5 w-3.5" />
                    {t('painel.comercial.agendamentos.checklist.status.reprovado')}
                  </span>
                ) : null}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    anyRejected ? 'bg-red-500' : 'bg-emerald-500'
                  )}
                  style={{ width: `${items.length ? (doneCount / items.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          ) : null}
        </DialogHeader>

        {/* Corpo */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              {t('painel.comercial.agendamentos.checklist.emptyItems')}
            </div>
          ) : !active ? (
            /* ---- Tela 1: lista de itens ---- */
            <div className="space-y-2 px-6 py-4">
              {anyRejected ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t('painel.comercial.agendamentos.checklist.rejectedBanner')}</span>
                </div>
              ) : null}
              {items.map((it) => {
                const s = computeChecksSummary(it.kind, it.checks);
                const Icon = it.kind === CHECKLIST_KIND.CONVENCIONAL ? Container : Package;
                return (
                  <button
                    key={it.item_key}
                    type="button"
                    onClick={() => setActiveKey(it.item_key)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-muted/40',
                      it.status === CHECKLIST_STATUS.REPROVADO
                        ? 'border-red-200 bg-red-50/40'
                        : it.status === CHECKLIST_STATUS.APROVADO
                          ? 'border-emerald-200 bg-emerald-50/40'
                          : 'border-border'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                        it.status === CHECKLIST_STATUS.APROVADO
                          ? 'bg-emerald-100 text-emerald-700'
                          : it.status === CHECKLIST_STATUS.REPROVADO
                            ? 'bg-red-100 text-red-700'
                            : 'bg-muted text-muted-foreground'
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{it.label}</p>
                        <StatusBadge status={it.status} label={statusLabel(it.status)} className="shrink-0" />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {it.saida_codigo} · {it.tipo_label} · {it.produto}
                        {it.lote && it.lote !== '—' ? ` · ${t('painel.comercial.agendamentos.checklist.fields.lote')} ${it.lote}` : ''}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {t('painel.comercial.agendamentos.checklist.checksProgress', {
                          answered: s.answered,
                          total: s.total,
                        })}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          ) : (
            /* ---- Tela 2: conferência do item ---- */
            <div className="space-y-4 px-6 py-4">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleBackToList}
                  className="inline-flex items-center gap-1 text-sm font-medium text-[#2575D1] hover:underline"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t('painel.comercial.agendamentos.checklist.backToItems')}
                </button>
                <StatusBadge status={active.status} label={statusLabel(active.status)} />
              </div>

              <div>
                <h3 className="text-base font-semibold text-foreground">{active.label}</h3>
                <p className="text-xs text-muted-foreground">
                  {t('painel.comercial.agendamentos.checklist.saidaId')}:{' '}
                  <span className="font-medium text-foreground">{active.saida_codigo}</span>
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <InfoChip
                  label={t('painel.comercial.agendamentos.checklist.fields.produto')}
                  value={active.produto}
                />
                <InfoChip
                  label={t('painel.comercial.agendamentos.checklist.fields.tipo')}
                  value={active.tipo_label}
                />
                <InfoChip
                  label={t('painel.comercial.agendamentos.checklist.fields.quantidade')}
                  value={active.quantidade}
                />
                <InfoChip
                  label={t('painel.comercial.agendamentos.checklist.fields.lote')}
                  value={active.lote}
                />
                {active.kind === CHECKLIST_KIND.CONVENCIONAL ? (
                  <>
                    <InfoChip
                      label={t('painel.comercial.agendamentos.checklist.fields.tanque')}
                      value={
                        [active.vasilhame_placa, active.vasilhame_barril]
                          .filter(Boolean)
                          .join(' / ') || '—'
                      }
                    />
                    <InfoChip
                      label={t('painel.comercial.agendamentos.checklist.fields.pesoLiquido')}
                      value={
                        active.peso_liquido != null
                          ? `${formatMassSafe(active.peso_liquido)} kg`
                          : '—'
                      }
                    />
                  </>
                ) : (
                  <InfoChip
                    label={t('painel.comercial.agendamentos.checklist.fields.embalagens')}
                    value={
                      active.quantidade_embalagens != null
                        ? String(active.quantidade_embalagens)
                        : '—'
                    }
                  />
                )}
                <InfoChip
                  label={t('painel.comercial.agendamentos.checklist.fields.fabricacao')}
                  value={formatChecklistDate(active.data_fabricacao, i18n.language)}
                />
                <InfoChip
                  label={t('painel.comercial.agendamentos.checklist.fields.validade')}
                  value={formatChecklistDate(active.data_validade, i18n.language)}
                />
              </div>

              {active.kind === CHECKLIST_KIND.CONVENCIONAL ? (
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('painel.comercial.agendamentos.checklist.sections.lacres')}
                    </p>
                    {active.lacres?.length > 0 ? (
                      <>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('painel.comercial.agendamentos.checklist.lacresCount', {
                            count: active.lacres.length,
                          })}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {active.lacres.map((l, i) => (
                            <span
                              key={`${l.numero}-${i}`}
                              className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2.5 py-1 font-mono text-sm font-medium text-foreground"
                            >
                              {l.numero}
                            </span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-amber-700">
                        {t('painel.comercial.agendamentos.checklist.noLacres')}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5 border-t border-border pt-3">
                    {checkDefs
                      .filter((c) => c.section === 'lacres')
                      .map((c) => (
                        <CheckAnswerRow
                          key={c.key}
                          label={t(c.labelKey)}
                          value={active.checks?.[c.key] || ''}
                          disabled={readOnly || saving}
                          onChange={(v) => setAnswer(c.key, v)}
                          options={APPROVE_REJECT_OPTIONS}
                          t={t}
                        />
                      ))}
                  </div>
                </div>
              ) : null}

              {sections
                .filter((section) => !(active.kind === CHECKLIST_KIND.CONVENCIONAL && section === 'lacres'))
                .map((section) => (
                <div key={section} className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {sectionTitle(section)}
                  </p>
                  {checkDefs
                    .filter((c) => c.section === section)
                    .map((c) => (
                      <CheckAnswerRow
                        key={c.key}
                        label={t(c.labelKey)}
                        value={active.checks?.[c.key] || ''}
                        disabled={readOnly || saving}
                        onChange={(v) => setAnswer(c.key, v)}
                        t={t}
                      />
                    ))}
                </div>
              ))}

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('painel.comercial.agendamentos.checklist.sections.fotos')}
                </p>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
                <div className="flex flex-wrap gap-2">
                  {(active.fotos || []).map((url) => (
                    <div key={url} className="group relative">
                      <SignedImage
                        url={url}
                        alt={t('painel.comercial.agendamentos.checklist.photoAlt')}
                        className="h-16 w-16 rounded-lg border object-cover"
                      />
                      {!readOnly ? (
                        <button
                          type="button"
                          onClick={() => removePhoto(url)}
                          className="absolute -right-1 -top-1 rounded-full border bg-white p-0.5 text-red-500 opacity-0 group-hover:opacity-100"
                          title={t('buttons.delete')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {!readOnly ? (
                    <button
                      type="button"
                      disabled={uploading || saving}
                      onClick={() => photoInputRef.current?.click()}
                      className="flex h-16 min-w-[7rem] items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 text-xs font-medium text-gray-500 hover:border-[#2575D1] hover:text-[#2575D1] disabled:opacity-50"
                    >
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Camera className="h-4 w-4" />
                      )}
                      {t('painel.comercial.agendamentos.checklist.attachPhotos')}
                    </button>
                  ) : null}
                </div>
              </div>

              {active.conferido_em ? (
                <p className="text-xs text-muted-foreground">
                  {t('painel.comercial.agendamentos.checklist.itemValidatedAt', {
                    date: new Date(active.conferido_em).toLocaleString(i18n.language || 'pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                    operador: active.conferido_por_nome || '—',
                  })}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="space-y-2 border-t border-border bg-muted/20 px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">
                {t('painel.comercial.agendamentos.checklist.responsible')}
              </p>
              <p className="font-semibold text-foreground">{operadorNome}</p>
            </div>
            {readOnly && booking.checklist_validado_em ? (
              <p className="text-xs text-emerald-700 font-medium">
                {t('painel.comercial.agendamentos.checklist.validatedAt', {
                  date: new Date(booking.checklist_validado_em).toLocaleString(
                    i18n.language || 'pt-BR',
                    {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }
                  ),
                  operador: booking.checklist_operador_nome || '—',
                })}
              </p>
            ) : null}
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 border-t border-border bg-muted/30 px-6 py-3">
          <Button type="button" variant="outline" onClick={handleClose} disabled={saving}>
            {readOnly ? t('buttons.close') : t('buttons.cancel')}
          </Button>
          {!readOnly ? (
            <Can anyOf={[`${permissionPrefix}.edit`, `${permissionPrefix}.view`]}>
              <Button
                type="button"
                disabled={!allApproved || saving}
                onClick={handleLiberar}
                className="text-white"
                style={{ background: allApproved ? '#059669' : '#94a3b8' }}
                title={
                  allApproved
                    ? ''
                    : anyRejected
                      ? t('painel.comercial.agendamentos.checklist.rejectedBlockedHint')
                      : t('painel.comercial.agendamentos.checklist.liberarBlockedHint')
                }
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                {t('painel.comercial.agendamentos.checklist.liberarExpedicao')}
              </Button>
            </Can>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatMassSafe(n) {
  try {
    return Number(n).toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
  } catch {
    return String(n);
  }
}

function formatChecklistDate(value, language = 'pt-BR') {
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
