import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { base44 } from '@industrializacao/api/base44Client';
import { useRealtimeEntity } from '@industrializacao/hooks/useRealtimeEntity';
import { usePermissions } from '@industrializacao/lib/rbac/PermissionProvider';
import { Button } from '@shared/components/ui/button';
import { useToast } from '@shared/components/ui/use-toast';
import ConfirmDialog from '@industrializacao/components/ConfirmDialog';
import ProgramacaoFormDialog from '@industrializacao/components/programacao/ProgramacaoFormDialog';
import ProgramacaoViewDialog from '@industrializacao/components/programacao/ProgramacaoViewDialog';
import ProducedToggle from '@industrializacao/components/programacao/ProducedToggle';
import { fmtVolume, getIntlLocale } from '@/i18n/formatters';
import { deriveOrderFromProductions } from '@industrializacao/lib/orderProductionStatus';
import {
  buildProducedPayload,
  getDayProgress,
  isScheduleProduced,
} from '@industrializacao/lib/programacaoStatus';
import {
  addMonths,
  getMonthWeeksMonSat,
  isSameISODate,
  scheduleDateKey,
  startOfMonth,
  todayISO,
} from '@industrializacao/lib/programacaoCalendar';

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export default function Programacao() {
  const { t, i18n } = useTranslation();
  const { user, isReadOnly } = useOutletContext();
  const { hasPermission } = usePermissions();
  const { toast } = useToast();
  const locale = getIntlLocale(i18n.language);
  const reduceMotion = useReducedMotion();

  const canCreate = hasPermission('programming.create') && !isReadOnly;
  const canEdit = hasPermission('programming.edit') && !isReadOnly;
  const canDelete = hasPermission('programming.delete') && !isReadOnly;

  const [monthCursor, setMonthCursor] = useState(() => startOfMonth());
  const [monthDir, setMonthDir] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [formDateIso, setFormDateIso] = useState(null);
  const [editing, setEditing] = useState(null);
  const [viewingDate, setViewingDate] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [togglingIds, setTogglingIds] = useState(() => new Set());
  const [producedOverrides, setProducedOverrides] = useState({});

  const { data: schedules, loading } = useRealtimeEntity(
    'ProductionSchedule',
    () => base44.entities.ProductionSchedule.list('scheduled_date', 2000)
  );
  const { data: recipes } = useRealtimeEntity(
    'Recipe',
    () => base44.entities.Recipe.list('-created_date', 2000)
  );
  const { data: orders } = useRealtimeEntity(
    'Order',
    () => base44.entities.Order.list('-created_date', 2000)
  );
  const { data: productions } = useRealtimeEntity(
    'Production',
    () => base44.entities.Production.list('-created_date', 2000)
  );

  const enrichedOrders = useMemo(
    () => (orders || []).map((order) => ({
      ...order,
      ...deriveOrderFromProductions(order, productions),
    })),
    [orders, productions]
  );

  const year = monthCursor.getFullYear();
  const monthIndex = monthCursor.getMonth();
  const weeks = useMemo(() => getMonthWeeksMonSat(year, monthIndex), [year, monthIndex]);
  const today = todayISO();
  const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

  const byDay = useMemo(() => {
    const map = new Map();
    for (const row of schedules || []) {
      const key = scheduleDateKey(row);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  }, [schedules]);

  const goMonth = (delta) => {
    setMonthDir(delta);
    setMonthCursor((current) => addMonths(current, delta));
  };

  const openCreate = (iso) => {
    if (!canCreate) return;
    setEditing(null);
    setFormDateIso(iso);
    setFormOpen(true);
  };

  const withProducedOverride = (row) => {
    if (!row?.id || !Object.prototype.hasOwnProperty.call(producedOverrides, row.id)) return row;
    return { ...row, produced: producedOverrides[row.id], produced_at: producedOverrides[row.id] ? (row.produced_at || new Date().toISOString()) : null };
  };

  const isProduced = (row) => {
    if (row?.id && Object.prototype.hasOwnProperty.call(producedOverrides, row.id)) {
      return Boolean(producedOverrides[row.id]);
    }
    return isScheduleProduced(row);
  };

  const viewingItems = viewingDate
    ? (byDay.get(viewingDate) || []).map(withProducedOverride)
    : [];

  const openView = (items) => {
    const date = items?.[0] ? scheduleDateKey(items[0]) : null;
    if (!date) return;
    setViewingDate(date);
  };

  const openEdit = (row) => {
    setViewingDate(null);
    setEditing(row);
    setFormDateIso(scheduleDateKey(row));
    setFormOpen(true);
  };

  const handleSave = async ({ product, client, volume, scheduled_date, order_id }) => {
    const vol = parseFloat(String(volume).replace(',', '.'));
    if (!product || !client) {
      toast({ title: t('programming.messages.fillRequired'), variant: 'destructive' });
      return;
    }
    if (!Number.isFinite(vol) || vol <= 0) {
      toast({ title: t('programming.messages.invalidVolume'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        product,
        client,
        volume: vol,
        scheduled_date,
        order_id: order_id || null,
        created_by: user?.nome || user?.full_name || user?.usuario || null,
      };
      if (editing?.id) {
        await base44.entities.ProductionSchedule.update(editing.id, payload);
        toast({ title: t('programming.messages.updated') });
      } else {
        await base44.entities.ProductionSchedule.create(payload);
        toast({ title: t('programming.messages.created') });
      }
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      toast({
        title: t('common.error'),
        description: err?.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleProduced = async (row) => {
    if (!canEdit || !row?.id || togglingIds.has(row.id)) return;
    const next = !isProduced(row);
    setProducedOverrides((prev) => ({ ...prev, [row.id]: next }));
    setTogglingIds((prev) => new Set(prev).add(row.id));
    try {
      const updated = await base44.entities.ProductionSchedule.update(
        row.id,
        buildProducedPayload(next, user)
      );
      if (isScheduleProduced(updated) !== next) {
        toast({
          title: t('programming.messages.producedUnavailable'),
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: t('common.error'),
        description: err?.message,
        variant: 'destructive',
      });
    } finally {
      setProducedOverrides((prev) => {
        const copy = { ...prev };
        delete copy[row.id];
        return copy;
      });
      setTogglingIds((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(row.id);
        return nextSet;
      });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget?.id) return;
    const remaining = viewingItems.filter((row) => row.id !== deleteTarget.id);
    await base44.entities.ProductionSchedule.delete(deleteTarget.id);
    toast({ title: t('programming.messages.deleted') });
    setDeleteTarget(null);
    if (remaining.length === 0) setViewingDate(null);
  };

  const monthMotion = {
    initial: reduceMotion || monthDir === 0 ? false : { opacity: 0.4, x: monthDir * 56 },
    animate: { opacity: 1, x: 0 },
    transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
  };

  const monthName = monthCursor
    .toLocaleDateString(locale, { month: 'long' })
    .replace(/^\p{L}/u, (ch) => ch.toUpperCase());
  const monthLabel = t('programming.monthTitle', { month: monthName, year });

  if (loading && (!schedules || schedules.length === 0)) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto pb-8">
      <div className="w-full space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('programming.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('programming.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => goMonth(-1)}
            aria-label={t('programming.prevMonth')}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1 overflow-hidden">
            <motion.p
              key={monthKey}
              {...monthMotion}
              className="text-center text-sm font-medium text-foreground capitalize"
            >
              {monthLabel}
            </motion.p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => goMonth(1)}
            aria-label={t('programming.nextMonth')}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 text-xs">
          <LegendDot className="bg-emerald-500" label={t('programming.available')} />
          <LegendDot className="bg-sky-500" label={t('programming.scheduled')} />
          <LegendDot className="bg-zinc-400" label={t('programming.completed')} />
          <LegendDot className="bg-orange-400" label={t('programming.weekdaysFull.sat')} />
        </div>

        <div className="overflow-hidden">
          <motion.div key={monthKey} {...monthMotion} className="space-y-2">
            <div className="hidden sm:grid grid-cols-6 gap-2 px-1">
              {WEEKDAY_KEYS.map((key) => (
                <p
                  key={key}
                  className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-center"
                >
                  {t(`programming.weekdays.${key}`)}
                </p>
              ))}
            </div>

            {weeks.map((days, weekIndex) => (
              <div key={`${monthKey}-w${weekIndex}`} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                {days.map((cell, idx) => {
                  if (!cell) {
                    return <div key={`empty-${weekIndex}-${idx}`} className="hidden md:block" />;
                  }

                  const weekdayLabel = t(`programming.weekdaysFull.${WEEKDAY_KEYS[cell.weekday - 1]}`);

                  if (!cell.inMonth) {
                    return (
                      <div
                        key={cell.iso}
                        className="relative min-h-[118px] overflow-hidden rounded-xl border border-border bg-card px-2 pt-3 pb-9 text-center"
                        aria-hidden
                      >
                        <span className="block text-[11px] font-semibold tracking-wide text-muted-foreground">
                          {weekdayLabel}
                        </span>
                        <span className="mt-0.5 block text-lg font-semibold tabular-nums leading-none text-muted-foreground">
                          {cell.day}
                        </span>
                        <svg
                          className="pointer-events-none absolute inset-0 h-full w-full text-zinc-300 dark:text-zinc-600"
                          aria-hidden
                        >
                          <line x1="8%" y1="88%" x2="92%" y2="12%" stroke="currentColor" strokeWidth="2" />
                        </svg>
                      </div>
                    );
                  }

                  const items = (byDay.get(cell.iso) || []).map(withProducedOverride);
                  const hasSchedule = items.length > 0;
                  const isToday = isSameISODate(cell.iso, today);
                  const isSaturday = cell.weekday === 6;
                  const progress = getDayProgress(items);

                  const tone = isSaturday
                    ? {
                        shell: 'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30',
                        label: 'text-orange-800 dark:text-orange-200',
                        day: 'text-orange-950 dark:text-orange-50',
                        product: 'text-orange-900 dark:text-orange-100',
                        extra: 'text-orange-700 dark:text-orange-300',
                        eye: 'text-orange-700 hover:text-orange-900 hover:bg-orange-200/70 dark:text-orange-300',
                        volume: 'text-orange-800 dark:text-orange-200',
                      }
                    : progress.allProduced
                      ? {
                          shell: 'border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/40',
                          label: 'text-zinc-600 dark:text-zinc-300',
                          day: 'text-zinc-800 dark:text-zinc-100',
                          product: 'text-zinc-600 dark:text-zinc-300',
                          extra: 'text-zinc-400 dark:text-zinc-500',
                          eye: 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200/70 dark:text-zinc-400',
                          volume: 'text-zinc-500 dark:text-zinc-400',
                        }
                      : hasSchedule
                        ? {
                            shell: 'border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30',
                            label: 'text-sky-800 dark:text-sky-200',
                            day: 'text-sky-950 dark:text-sky-50',
                            product: 'text-sky-900 dark:text-sky-100',
                            extra: 'text-sky-700 dark:text-sky-300',
                            eye: 'text-sky-700 hover:text-sky-900 hover:bg-sky-200/70 dark:text-sky-300',
                            volume: 'text-sky-800 dark:text-sky-200',
                          }
                        : {
                            shell: 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30',
                            label: 'text-emerald-800 dark:text-emerald-200',
                            day: 'text-emerald-950 dark:text-emerald-50',
                            product: 'text-emerald-900 dark:text-emerald-100',
                            extra: 'text-emerald-700 dark:text-emerald-300',
                            eye: '',
                            volume: 'text-emerald-800 dark:text-emerald-200',
                          };

                  return (
                    <div
                      key={cell.iso}
                      className={`relative min-h-[118px] rounded-xl border px-2 pt-3 pb-9 text-center transition-all ${tone.shell} ${
                        canCreate ? 'hover:brightness-[0.98] cursor-pointer' : ''
                      } ${isToday ? 'ring-1 ring-primary/40' : ''}`}
                      onClick={canCreate ? () => openCreate(cell.iso) : undefined}
                    >
                      <button
                        type="button"
                        disabled={!canCreate}
                        onClick={(e) => {
                          e.stopPropagation();
                          openCreate(cell.iso);
                        }}
                        className={`flex flex-col items-center w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          canCreate ? 'cursor-pointer' : 'cursor-default'
                        }`}
                        aria-label={`${weekdayLabel} ${cell.day}`}
                      >
                        <span className={`block text-[11px] font-semibold tracking-wide ${tone.label}`}>
                          {weekdayLabel}
                        </span>
                        <span className={`mt-0.5 block text-lg font-semibold tabular-nums leading-none ${tone.day}`}>
                          {cell.day}
                        </span>
                      </button>

                      {hasSchedule ? (
                        <div className="mt-1.5 w-full space-y-0.5 px-0.5">
                          {items.map((row) => {
                            const produced = isProduced(row);
                            return (
                              <div
                                key={row.id}
                                className={`flex items-center gap-0.5 min-w-0 rounded-md ${
                                  canEdit ? 'cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.04]' : ''
                                }`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (canEdit) handleToggleProduced(row);
                                }}
                              >
                                <ProducedToggle
                                  produced={produced}
                                  disabled={!canEdit}
                                  busy={togglingIds.has(row.id)}
                                  label={
                                    produced
                                      ? t('programming.markPending', { product: row.product })
                                      : t('programming.markProduced', { product: row.product })
                                  }
                                  onToggle={() => handleToggleProduced(row)}
                                  className={tone.product}
                                />
                                <span
                                  className={`min-w-0 flex-1 text-left text-[11px] font-semibold leading-snug line-clamp-1 ${
                                    produced ? `line-through ${tone.extra}` : tone.product
                                  }`}
                                  title={row.product}
                                >
                                  {row.product}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      {hasSchedule ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={`absolute top-1.5 right-1.5 z-10 h-7 w-7 ${tone.eye}`}
                          title={t('programming.view.button')}
                          aria-label={t('programming.view.button')}
                          onClick={(e) => {
                            e.stopPropagation();
                            openView(items);
                          }}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      ) : null}

                      {hasSchedule ? (
                        <span
                          className={`absolute bottom-1.5 left-2 text-[11px] font-semibold tabular-nums ${tone.volume}`}
                          title={t('programming.remainingVolume', { volume: fmtVolume(progress.remainingVolume) })}
                        >
                          {fmtVolume(progress.remainingVolume)}
                        </span>
                      ) : null}

                      {progress.remainingCount > 0 ? (
                        <span
                          className="absolute bottom-1.5 right-1.5 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none text-orange-700"
                          title={t('programming.remainingCount', { count: progress.remainingCount })}
                        >
                          {progress.remainingCount}
                        </span>
                      ) : hasSchedule ? (
                        <span
                          className="absolute bottom-1.5 right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300"
                          title={t('programming.completed')}
                        >
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </span>
                      ) : null}

                      {isToday ? (
                        <span
                          className="absolute top-2 left-2 h-1.5 w-1.5 rounded-full bg-primary"
                          title={t('common.today')}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </motion.div>
        </div>
      </div>

      <ProgramacaoFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        dateIso={formDateIso}
        editing={editing}
        recipes={recipes}
        orders={enrichedOrders}
        saving={saving}
        onSave={handleSave}
      />

      <ProgramacaoViewDialog
        open={!!viewingDate}
        onOpenChange={(open) => { if (!open && !deleteTarget) setViewingDate(null); }}
        items={viewingItems}
        dismissible={!deleteTarget}
        canEdit={canEdit}
        canDelete={canDelete}
        canMarkProduced={canEdit}
        togglingIds={togglingIds}
        onToggleProduced={handleToggleProduced}
        onEdit={openEdit}
        onDelete={(row) => {
          if (!row) return;
          setDeleteTarget(row);
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title={t('programming.deleteConfirm.title')}
        message={t('programming.deleteConfirm.message', { product: deleteTarget?.product })}
        confirmLabel={t('buttons.delete')}
        confirmColor="#DC2626"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function LegendDot({ className, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}
