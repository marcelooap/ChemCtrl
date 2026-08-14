import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { base44 } from '@industrializacao/api/base44Client';
import { useRealtimeEntity } from '@industrializacao/hooks/useRealtimeEntity';
import { usePermissions } from '@industrializacao/lib/rbac/PermissionProvider';
import { Button } from '@shared/components/ui/button';
import { useToast } from '@shared/components/ui/use-toast';
import ConfirmDialog from '@industrializacao/components/ConfirmDialog';
import ProgramacaoFormDialog from '@industrializacao/components/programacao/ProgramacaoFormDialog';
import ProgramacaoViewDialog from '@industrializacao/components/programacao/ProgramacaoViewDialog';
import { fmtVolume, getIntlLocale } from '@/i18n/formatters';
import { deriveOrderFromProductions } from '@industrializacao/lib/orderProductionStatus';
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
  const [viewing, setViewing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: schedules, loading } = useRealtimeEntity(
    'ProductionSchedule',
    () => base44.entities.ProductionSchedule.list('scheduled_date', 2000)
  );
  const { data: recipes } = useRealtimeEntity(
    'Recipe',
    () => base44.entities.Recipe.list('-created_date', 500)
  );
  const { data: orders } = useRealtimeEntity(
    'Order',
    () => base44.entities.Order.list('-created_date', 500)
  );
  const { data: productions } = useRealtimeEntity(
    'Production',
    () => base44.entities.Production.list('-created_date', 500)
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

  const openView = (items) => {
    if (!items?.length) return;
    setViewing(items);
  };

  const openEdit = (row) => {
    setViewing(null);
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

  const confirmDelete = async () => {
    if (!deleteTarget?.id) return;
    await base44.entities.ProductionSchedule.delete(deleteTarget.id);
    toast({ title: t('programming.messages.deleted') });
    setDeleteTarget(null);
    setViewing(null);
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

        <div className="flex items-center justify-end gap-3 text-xs">
          <LegendDot className="bg-emerald-500" label={t('programming.available')} />
          <LegendDot className="bg-sky-500" label={t('programming.scheduled')} />
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

                  const items = byDay.get(cell.iso) || [];
                  const hasSchedule = items.length > 0;
                  const isToday = isSameISODate(cell.iso, today);
                  const isSaturday = cell.weekday === 6;
                  const dayVolume = items.reduce((sum, row) => sum + (Number(row.volume) || 0), 0);

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
                    >
                      <button
                        type="button"
                        disabled={!canCreate}
                        onClick={() => openCreate(cell.iso)}
                        className={`flex flex-col items-center w-full h-full min-h-[84px] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          canCreate ? '' : 'cursor-default'
                        }`}
                        aria-label={`${weekdayLabel} ${cell.day}`}
                      >
                        <span className={`block text-[11px] font-semibold tracking-wide ${tone.label}`}>
                          {weekdayLabel}
                        </span>
                        <span className={`mt-0.5 block text-lg font-semibold tabular-nums leading-none ${tone.day}`}>
                          {cell.day}
                        </span>
                        {hasSchedule ? (
                          <span className="mt-2 w-full space-y-0.5 px-0.5">
                            {items.slice(0, 2).map((row) => (
                              <span
                                key={row.id}
                                className={`block text-xs font-semibold leading-snug line-clamp-1 ${tone.product}`}
                              >
                                {row.product}
                              </span>
                            ))}
                            {items.length > 2 ? (
                              <span className={`block text-[10px] font-medium ${tone.extra}`}>
                                +{items.length - 2}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </button>

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

                      <span className={`absolute bottom-1.5 left-2 text-[11px] font-semibold tabular-nums ${tone.volume}`}>
                        {fmtVolume(dayVolume)}
                      </span>

                      {items.length > 0 ? (
                        <span className="absolute bottom-1.5 right-1.5 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none text-orange-700">
                          {items.length}
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
        open={!!viewing}
        onOpenChange={(open) => { if (!open) setViewing(null); }}
        items={viewing || []}
        canEdit={canEdit}
        canDelete={canDelete}
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
