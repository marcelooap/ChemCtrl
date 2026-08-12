import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, Eye, Truck, UtensilsCrossed } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { useToast } from '@shared/components/ui/use-toast';
import { entities } from '@transbordo/services/entities';
import {
  isSaidaExpedida,
  listSaidaIdsExpedidas,
} from '@transbordo/lib/saidaExpedicao';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import AgendamentoSlotModal from '@painel/components/comercial/AgendamentoSlotModal';
import AgendamentoTransporteModal from '@painel/components/comercial/AgendamentoTransporteModal';
import AgendamentoConcluirCarregamentoModal from '@painel/components/comercial/AgendamentoConcluirCarregamentoModal';
import SaidaViewDialog from '@transbordo/components/saida/SaidaViewDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import {
  ENCAIXE_HORARIO,
  addDays,
  bookSlotSaidas,
  concluirCarregamento,
  getDefaultSelectedDate,
  getSlotsForWeekday,
  getWeekDays,
  groupSlotCarregamentos,
  hasTransporte,
  indexAgendamentosBySlot,
  isSameISODate,
  listAgendamentosByRange,
  normalizeBookings,
  releaseSlotBookings,
  startOfWeekMonday,
  summarizeSlotBookings,
  todayISO,
  toISODate,
  parseISODate,
  updateTransporte,
} from '@painel/lib/agendamentosCarregamento';

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

/**
 * Grade semanal de agendamentos de carregamento (Comercial e Logística).
 * @param {{ title: string, subtitle: string, permissionPrefix?: string, showViewSaida?: boolean, showTransporte?: boolean, showConcluirCarregamento?: boolean }} props
 */
export default function AgendamentosGrade({
  title,
  subtitle,
  permissionPrefix = 'painel_comercial_agendamentos',
  showViewSaida = false,
  showTransporte = false,
  showConcluirCarregamento = false,
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { user } = useInternalAuth();

  const [weekStart, setWeekStart] = useState(() => startOfWeekMonday());
  const [selectedIso, setSelectedIso] = useState(() => getDefaultSelectedDate());
  const [loading, setLoading] = useState(true);
  const [agendamentos, setAgendamentos] = useState([]);
  const [saidas, setSaidas] = useState([]);
  const [expedidasIds, setExpedidasIds] = useState(() => new Set());
  const [vasilhames, setVasilhames] = useState([]);
  const [entradas, setEntradas] = useState([]);
  const [activeSlot, setActiveSlot] = useState(null);
  const [viewSaida, setViewSaida] = useState(null);
  const [viewPicker, setViewPicker] = useState(null);
  const [transporteBookings, setTransporteBookings] = useState(null);
  const [concluirBookings, setConcluirBookings] = useState(null);

  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const today = todayISO();
  const selectedWeekday = weekDays.find((d) => d.iso === selectedIso)?.weekday || 1;
  const slots = useMemo(() => getSlotsForWeekday(selectedWeekday), [selectedWeekday]);
  const bookingMap = useMemo(() => indexAgendamentosBySlot(agendamentos), [agendamentos]);

  /** Saídas ainda Aguardando (não expedidas) — únicas elegíveis para agendar. */
  const saidasAguardando = useMemo(
    () => (saidas || []).filter((s) => !isSaidaExpedida(s?.id, expedidasIds)),
    [saidas, expedidasIds]
  );

  const loadData = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      const fromIso = toISODate(weekStart);
      const toIso = toISODate(addDays(weekStart, 4));
      try {
        const [bookings, saidasList, vascs, ents, expedidas] = await Promise.all([
          listAgendamentosByRange(fromIso, toIso),
          entities.saidas.list('-created_date'),
          showViewSaida ? entities.vasilhames.list() : Promise.resolve([]),
          showViewSaida ? entities.estoque.list() : Promise.resolve([]),
          listSaidaIdsExpedidas(),
        ]);
        setAgendamentos(bookings || []);
        setSaidas(saidasList || []);
        setExpedidasIds(expedidas instanceof Set ? expedidas : new Set());
        setVasilhames(vascs || []);
        setEntradas(ents || []);
      } catch (err) {
        console.error('[AgendamentosGrade] loadData:', err);
        toast({
          title: t('painel.comercial.agendamentos.loadErrorTitle'),
          description:
            err?.message || t('painel.comercial.agendamentos.loadErrorDescription'),
          variant: 'destructive',
        });
        setAgendamentos([]);
        setSaidas([]);
        setExpedidasIds(new Set());
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [weekStart, t, toast, showViewSaida]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const goWeek = (delta) => {
    const nextStart = addDays(weekStart, delta * 7);
    setWeekStart(nextStart);
    const days = getWeekDays(nextStart);
    const stillInWeek = days.some((d) => d.iso === selectedIso);
    if (!stillInWeek) {
      const todayInWeek = days.find((d) => d.iso === today);
      setSelectedIso(todayInWeek?.iso || days[0].iso);
    }
  };

  const scheduledSaidaIds = useMemo(() => {
    const set = new Set();
    for (const row of agendamentos) {
      if (row?.saida_id) set.add(String(row.saida_id));
    }
    return set;
  }, [agendamentos]);

  const occupiedSlotCountByDay = useMemo(() => {
    const map = new Map();
    for (const key of bookingMap.keys()) {
      const day = key.split('|')[0];
      map.set(day, (map.get(day) || 0) + 1);
    }
    return map;
  }, [bookingMap]);

  const stats = useMemo(() => {
    const allHorarios = [...slots.morning, ...slots.afternoon, ENCAIXE_HORARIO];
    let occupied = 0;
    for (const hora of allHorarios) {
      const list = bookingMap.get(`${selectedIso}|${hora}`);
      if (list?.length) occupied += 1;
    }
    return { total: allHorarios.length, occupied, free: allHorarios.length - occupied };
  }, [slots, bookingMap, selectedIso]);

  const encaixeGroups = useMemo(
    () =>
      groupSlotCarregamentos(bookingMap.get(`${selectedIso}|${ENCAIXE_HORARIO}`), {
        splitByCliente: true,
      }),
    [bookingMap, selectedIso]
  );

  const openSlot = (horario, tipo = 'regular', groupBookings = null) => {
    const isEncaixe = tipo === 'encaixe' || horario === ENCAIXE_HORARIO;
    const scoped = normalizeBookings(groupBookings);
    setActiveSlot({
      key: `${selectedIso}|${horario}`,
      dateIso: selectedIso,
      horario,
      tipo: isEncaixe ? 'encaixe' : tipo,
      // Encaixe: null = novo carregamento; array = editar só esse grupo (cliente).
      // Regular: undefined → sincroniza o horário inteiro.
      groupBookings: isEncaixe ? scoped : undefined,
      scopeSaidaIds: isEncaixe
        ? new Set(scoped.map((b) => String(b.saida_id)).filter(Boolean))
        : null,
    });
  };

  const resolveSaida = (booking) =>
    (saidas || []).find((s) => String(s.id) === String(booking?.saida_id));

  const openSaidaView = (bookings) => {
    const list = normalizeBookings(bookings);
    if (list.length === 0) return;
    if (list.length === 1) {
      const saida = resolveSaida(list[0]);
      if (!saida) {
        toast({
          title: t('painel.comercial.agendamentos.viewSaidaMissingTitle'),
          description: t('painel.comercial.agendamentos.viewSaidaMissing'),
          variant: 'destructive',
        });
        return;
      }
      setViewSaida(saida);
      return;
    }
    setViewPicker(list);
  };

  const activeBookings =
    activeSlot?.groupBookings !== undefined
      ? normalizeBookings(activeSlot.groupBookings)
      : activeSlot
        ? bookingMap.get(activeSlot.key) || []
        : [];

  const handleBook = async (selectedSaidas) => {
    if (!activeSlot) return;
    await bookSlotSaidas({
      dateIso: activeSlot.dateIso,
      horario: activeSlot.horario,
      tipo: activeSlot.tipo,
      saidas: selectedSaidas,
      user,
      t,
      scopeSaidaIds: activeSlot.scopeSaidaIds,
    });
    toast({ title: t('painel.comercial.agendamentos.saveSuccess') });
    await loadData({ silent: true });
  };

  const handleRelease = async (bookings) => {
    await releaseSlotBookings(bookings);
    toast({ title: t('painel.comercial.agendamentos.releaseSuccess') });
    await loadData({ silent: true });
  };

  const handleSaveTransporte = async ({ transportadora, motorista, placa }) => {
    const list = normalizeBookings(transporteBookings);
    if (list.length === 0) return;
    await updateTransporte({
      bookings: list,
      transportadora,
      motorista,
      placa,
      t,
    });
    toast({ title: t('painel.comercial.agendamentos.transporte.saveSuccess') });
    await loadData({ silent: true });
  };

  const handleConcluirCarregamento = async ({ horaCarregamento }) => {
    const list = normalizeBookings(concluirBookings);
    if (list.length === 0) return;
    await concluirCarregamento({
      bookings: list,
      horaCarregamento,
      user,
      t,
    });
    toast({ title: t('painel.comercial.agendamentos.concluir.saveSuccess') });
    await loadData({ silent: true });
  };

  const locale = i18n.language || 'pt-BR';
  const selectedDateLabel = parseISODate(selectedIso).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const weekLabel = t('painel.comercial.agendamentos.weekRange', {
    start: weekDays[0].date.toLocaleDateString(locale, { day: '2-digit', month: 'short' }),
    end: weekDays[4].date.toLocaleDateString(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => goWeek(-1)}
          aria-label={t('painel.comercial.agendamentos.prevWeek')}
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <p className="flex-1 text-center text-sm font-medium text-foreground capitalize">
          {weekLabel}
        </p>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => goWeek(1)}
          aria-label={t('painel.comercial.agendamentos.nextWeek')}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {weekDays.map((day, index) => {
          const selected = isSameISODate(day.iso, selectedIso);
          const isToday = isSameISODate(day.iso, today);
          const dayBookings = occupiedSlotCountByDay.get(day.iso) || 0;
          return (
            <button
              key={day.iso}
              type="button"
              aria-pressed={selected}
              onClick={() => setSelectedIso(day.iso)}
              className={`relative rounded-xl border px-2 py-3 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selected
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40'
              }`}
            >
              <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-80">
                {t(`painel.comercial.agendamentos.weekdays.${WEEKDAY_KEYS[index]}`)}
              </span>
              <span className="mt-0.5 block text-lg font-semibold tabular-nums leading-none">
                {day.date.getDate()}
              </span>
              <span
                className={`mt-1.5 block text-[10px] font-medium ${
                  selected ? 'text-primary-foreground/80' : 'text-muted-foreground'
                }`}
              >
                {dayBookings > 0
                  ? t('painel.comercial.agendamentos.dayBooked', { count: dayBookings })
                  : t('painel.comercial.agendamentos.dayFree')}
              </span>
              {isToday ? (
                <span
                  className={`absolute top-2 right-2 h-1.5 w-1.5 rounded-full ${
                    selected ? 'bg-primary-foreground' : 'bg-primary'
                  }`}
                  title={t('common.today')}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground capitalize">{selectedDateLabel}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('painel.comercial.agendamentos.slotSummary', {
                free: stats.free,
                occupied: stats.occupied,
                total: stats.total,
              })}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <LegendDot className="bg-emerald-500" label={t('painel.comercial.agendamentos.available')} />
            <LegendDot className="bg-red-500" label={t('painel.comercial.agendamentos.occupied')} />
            <LegendDot className="bg-amber-400" label={t('painel.comercial.agendamentos.lunch')} />
          </div>
        </div>

        <div className="p-5 space-y-5">
          <SlotSection title={t('painel.comercial.agendamentos.morning')}>
            {slots.morning.map((hora) => (
              <TimeSlotButton
                key={hora}
                hora={hora}
                bookings={bookingMap.get(`${selectedIso}|${hora}`)}
                onClick={() => openSlot(hora, 'regular')}
                availableLabel={t('painel.comercial.agendamentos.available')}
                showViewSaida={showViewSaida}
                onView={openSaidaView}
                viewLabel={t('painel.comercial.agendamentos.viewSaida')}
                onEditTransporte={showTransporte ? setTransporteBookings : undefined}
                transporteLabel={t('painel.comercial.agendamentos.transporte.button')}
                onConcluir={showConcluirCarregamento ? setConcluirBookings : undefined}
                concluirLabel={t('painel.comercial.agendamentos.concluir.button')}
                saidasCountLabel={(count) =>
                  t('painel.comercial.agendamentos.saidasCount', { count })
                }
              />
            ))}
          </SlotSection>

          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
            <UtensilsCrossed className="w-4 h-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-none">
                {t('painel.comercial.agendamentos.lunch')}
              </p>
              <p className="text-xs mt-1 opacity-80">
                {t('painel.comercial.agendamentos.lunchRange')}
              </p>
            </div>
          </div>

          <SlotSection title={t('painel.comercial.agendamentos.afternoon')}>
            {slots.afternoon.map((hora) => (
              <TimeSlotButton
                key={hora}
                hora={hora}
                bookings={bookingMap.get(`${selectedIso}|${hora}`)}
                onClick={() => openSlot(hora, 'regular')}
                availableLabel={t('painel.comercial.agendamentos.available')}
                showViewSaida={showViewSaida}
                onView={openSaidaView}
                viewLabel={t('painel.comercial.agendamentos.viewSaida')}
                onEditTransporte={showTransporte ? setTransporteBookings : undefined}
                transporteLabel={t('painel.comercial.agendamentos.transporte.button')}
                onConcluir={showConcluirCarregamento ? setConcluirBookings : undefined}
                concluirLabel={t('painel.comercial.agendamentos.concluir.button')}
                saidasCountLabel={(count) =>
                  t('painel.comercial.agendamentos.saidasCount', { count })
                }
              />
            ))}
          </SlotSection>

          <div className="pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {t('painel.comercial.agendamentos.encaixe')}
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              {t('painel.comercial.agendamentos.encaixeHint')}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2">
              {encaixeGroups.map((group) => (
                <TimeSlotButton
                  key={group.key}
                  hora={t('painel.comercial.agendamentos.encaixe')}
                  bookings={group.bookings}
                  onClick={() => openSlot(ENCAIXE_HORARIO, 'encaixe', group.bookings)}
                  availableLabel={t('painel.comercial.agendamentos.available')}
                  showViewSaida={showViewSaida}
                  onView={openSaidaView}
                  viewLabel={t('painel.comercial.agendamentos.viewSaida')}
                  onEditTransporte={showTransporte ? setTransporteBookings : undefined}
                  transporteLabel={t('painel.comercial.agendamentos.transporte.button')}
                  onConcluir={showConcluirCarregamento ? setConcluirBookings : undefined}
                  concluirLabel={t('painel.comercial.agendamentos.concluir.button')}
                  saidasCountLabel={(count) =>
                    t('painel.comercial.agendamentos.saidasCount', { count })
                  }
                  encaixe
                />
              ))}
              <TimeSlotButton
                hora={t('painel.comercial.agendamentos.encaixe')}
                bookings={[]}
                onClick={() => openSlot(ENCAIXE_HORARIO, 'encaixe', [])}
                availableLabel={t('painel.comercial.agendamentos.encaixeNew')}
                encaixe
              />
            </div>
          </div>
        </div>
      </div>

      <AgendamentoSlotModal
        open={!!activeSlot}
        slot={activeSlot}
        bookings={activeBookings}
        saidas={saidasAguardando}
        scheduledSaidaIds={scheduledSaidaIds}
        permissionPrefix={permissionPrefix}
        onClose={() => setActiveSlot(null)}
        onBook={handleBook}
        onRelease={handleRelease}
      />

      {showTransporte ? (
        <AgendamentoTransporteModal
          open={!!transporteBookings}
          booking={normalizeBookings(transporteBookings)[0] || null}
          permissionPrefix={permissionPrefix}
          onClose={() => setTransporteBookings(null)}
          onSave={handleSaveTransporte}
        />
      ) : null}

      {showConcluirCarregamento ? (
        <AgendamentoConcluirCarregamentoModal
          open={!!concluirBookings}
          bookings={concluirBookings}
          permissionPrefix={permissionPrefix}
          onClose={() => setConcluirBookings(null)}
          onConfirm={handleConcluirCarregamento}
        />
      ) : null}

      <Dialog open={!!viewPicker} onOpenChange={(v) => !v && setViewPicker(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('painel.comercial.agendamentos.viewSaidaPickTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            {normalizeBookings(viewPicker).map((row) => (
              <button
                key={row.id}
                type="button"
                className="w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted/40"
                onClick={() => {
                  const saida = resolveSaida(row);
                  setViewPicker(null);
                  if (!saida) {
                    toast({
                      title: t('painel.comercial.agendamentos.viewSaidaMissingTitle'),
                      description: t('painel.comercial.agendamentos.viewSaidaMissing'),
                      variant: 'destructive',
                    });
                    return;
                  }
                  setViewSaida(saida);
                }}
              >
                <span className="font-medium text-primary">{row.saida_codigo || '—'}</span>
                <span className="ml-2 text-muted-foreground">{row.cliente_nome || '—'}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {showViewSaida ? (
        <SaidaViewDialog
          open={!!viewSaida}
          saida={viewSaida}
          vasilhames={vasilhames}
          entradas={entradas}
          variant="agendamento"
          onClose={() => setViewSaida(null)}
        />
      ) : null}
    </div>
  );
}

function SlotSection({ title, children }) {
  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2">
        {children}
      </div>
    </section>
  );
}

function TimeSlotButton({
  hora,
  bookings,
  onClick,
  availableLabel,
  encaixe = false,
  showViewSaida = false,
  onView,
  viewLabel,
  onEditTransporte,
  transporteLabel,
  onConcluir,
  concluirLabel,
  saidasCountLabel,
}) {
  const list = normalizeBookings(bookings);
  const summary = summarizeSlotBookings(list);
  const occupied = list.length > 0;
  const showEye = occupied && showViewSaida;
  const showTruck = occupied && Boolean(onEditTransporte);
  const showCheck = occupied && Boolean(onConcluir);
  const filled = hasTransporte(summary.first);
  const hasSideActions = showTruck || showEye || showCheck;

  return (
    <div
      className={`relative min-h-[72px] rounded-xl border transition-all ${
        occupied
          ? 'border-red-200 bg-red-50 hover:bg-red-100/80'
          : encaixe
            ? 'border-dashed border-emerald-300 bg-emerald-50/70 hover:bg-emerald-100/80'
            : 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100/80'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`w-full h-full min-h-[72px] text-left px-3 py-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          hasSideActions ? 'pr-10' : ''
        }`}
      >
        <span className="flex items-center gap-1.5">
          <Clock
            className={`w-3.5 h-3.5 ${occupied ? 'text-red-600' : 'text-emerald-700'}`}
          />
          <span
            className={`text-sm font-semibold tabular-nums ${
              occupied ? 'text-red-800' : 'text-emerald-900'
            }`}
          >
            {hora}
          </span>
        </span>
        {occupied ? (
          <span className="mt-1.5 block space-y-0.5">
            {summary.count > 1 ? (
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-red-700/80">
                {saidasCountLabel?.(summary.count) || `${summary.count} saídas`}
              </span>
            ) : null}
            <span className="block text-xs font-semibold text-red-800 truncate">
              {summary.codesLabel}
            </span>
            <span className="block text-[11px] text-red-700/80 truncate">
              {summary.clientesLabel}
            </span>
            {filled ? (
              <>
                <span className="block text-[11px] text-red-800/90 truncate">
                  {summary.motorista}
                </span>
                <span className="block text-[11px] font-mono text-red-700/80 truncate">
                  {[summary.placa, summary.transportadora].filter(Boolean).join(' · ')}
                </span>
              </>
            ) : null}
          </span>
        ) : (
          <span className="mt-1.5 block text-xs font-medium text-emerald-700">
            {availableLabel}
          </span>
        )}
      </button>

      {hasSideActions ? (
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-0.5">
          {showTruck ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${
                filled
                  ? 'text-red-800 hover:text-red-950 hover:bg-red-200/70'
                  : 'text-red-600 hover:text-red-800 hover:bg-red-200/70'
              }`}
              title={transporteLabel}
              aria-label={transporteLabel}
              onClick={(e) => {
                e.stopPropagation();
                onEditTransporte?.(list);
              }}
            >
              <Truck className="w-4 h-4" />
            </Button>
          ) : null}
          {showCheck ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-200/70"
              title={concluirLabel}
              aria-label={concluirLabel}
              onClick={(e) => {
                e.stopPropagation();
                onConcluir?.(list);
              }}
            >
              <CheckCircle2 className="w-4 h-4" />
            </Button>
          ) : null}
          {showEye ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-red-700 hover:text-red-900 hover:bg-red-200/70"
              title={viewLabel}
              aria-label={viewLabel}
              onClick={(e) => {
                e.stopPropagation();
                onView?.(list);
              }}
            >
              <Eye className="w-4 h-4" />
            </Button>
          ) : null}
        </div>
      ) : null}
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
