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
  isCarregado,
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
 * @param {{ title?: string, subtitle?: string, permissionPrefix?: string, allowBooking?: boolean, showViewSaida?: boolean, showTransporte?: boolean, showConcluirCarregamento?: boolean, compact?: boolean, hideHeader?: boolean, lockedSaida?: object|null, onBooked?: function }} props
 */
export default function AgendamentosGrade({
  title,
  subtitle,
  permissionPrefix = 'painel_comercial_agendamentos',
  allowBooking = true,
  showViewSaida = false,
  showTransporte = false,
  showConcluirCarregamento = false,
  compact = false,
  hideHeader = false,
  lockedSaida = null,
  onBooked,
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
  const [bookingLocked, setBookingLocked] = useState(false);

  const canBook = Boolean(allowBooking || lockedSaida);
  const canViewSaida = showViewSaida && !lockedSaida;
  const canTransporte = showTransporte && !lockedSaida;
  const canConcluir = showConcluirCarregamento && !lockedSaida;

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
          canViewSaida ? entities.vasilhames.list() : Promise.resolve([]),
          canViewSaida ? entities.estoque.list() : Promise.resolve([]),
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
    [weekStart, t, toast, canViewSaida]
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
      // Só bloqueia re-agendamento enquanto o slot ainda está ativo.
      if (row?.saida_id && row.status === 'agendado') set.add(String(row.saida_id));
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

  const bookLockedSaida = async (horario, tipo = 'regular') => {
    if (!lockedSaida?.id || bookingLocked) return;
    setBookingLocked(true);
    try {
      const key = `${selectedIso}|${horario}`;
      const existing = normalizeBookings(bookingMap.get(key));
      const existingAsSaidas = existing.map((row) => ({
        id: row.saida_id,
        codigo: row.saida_codigo,
        cliente_id: row.cliente_id,
        cliente_nome: row.cliente_nome,
      }));
      const alreadyOnSlot = existingAsSaidas.some(
        (s) => String(s.id) === String(lockedSaida.id)
      );
      await bookSlotSaidas({
        dateIso: selectedIso,
        horario,
        tipo,
        saidas: alreadyOnSlot ? existingAsSaidas : [...existingAsSaidas, lockedSaida],
        user,
        t,
      });
      toast({ title: t('painel.comercial.agendamentos.saveSuccess') });
      if (typeof onBooked === 'function') {
        await onBooked({ dateIso: selectedIso, horario, tipo, saida: lockedSaida });
        return;
      }
      await loadData({ silent: true });
    } catch (err) {
      toast({
        title: t('painel.comercial.agendamentos.errors.saveFailed'),
        description: err?.message,
        variant: 'destructive',
      });
    } finally {
      setBookingLocked(false);
    }
  };

  const encaixeGroups = useMemo(
    () =>
      groupSlotCarregamentos(bookingMap.get(`${selectedIso}|${ENCAIXE_HORARIO}`), {
        splitByCliente: true,
      }),
    [bookingMap, selectedIso]
  );

  const openSlot = (horario, tipo = 'regular', groupBookings = null) => {
    if (!canBook) return;
    if (lockedSaida) {
      const existing = normalizeBookings(
        bookingMap.get(`${selectedIso}|${horario}`)
      );
      if (isCarregado(existing)) return;
      bookLockedSaida(horario, tipo);
      return;
    }
    const isEncaixe = tipo === 'encaixe' || horario === ENCAIXE_HORARIO;
    const scoped = normalizeBookings(groupBookings);
    const existing =
      scoped.length > 0
        ? scoped
        : normalizeBookings(bookingMap.get(`${selectedIso}|${horario}`));
    // Horário já carregado: permanece preenchido, sem edição de agendamento.
    if (isCarregado(existing)) return;
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
      <div className={`flex items-center justify-center ${compact ? 'h-40' : 'h-64'}`}>
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`w-full relative ${compact ? 'space-y-3' : 'space-y-5'}`}>
      {bookingLocked ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-background/70">
          <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
        </div>
      ) : null}

      {hideHeader ? null : (
        <div>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      )}

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
              className={`relative rounded-xl border px-2 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                compact ? 'py-2' : 'py-3'
              } ${
                selected
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40'
              }`}
            >
              <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-80">
                {t(`painel.comercial.agendamentos.weekdays.${WEEKDAY_KEYS[index]}`)}
              </span>
              <span className={`mt-0.5 block font-semibold tabular-nums leading-none ${compact ? 'text-base' : 'text-lg'}`}>
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
        <div className={`border-b border-border flex flex-wrap items-center justify-between gap-3 ${compact ? 'px-3 py-3' : 'px-5 py-4'}`}>
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
            <LegendDot className="bg-sky-500" label={t('painel.comercial.agendamentos.carregado')} />
            <LegendDot className="bg-amber-400" label={t('painel.comercial.agendamentos.lunch')} />
          </div>
        </div>

        <div className={`${compact ? 'p-3 space-y-3' : 'p-5 space-y-5'}`}>
          <SlotSection compact={compact} title={t('painel.comercial.agendamentos.morning')}>
            {slots.morning.map((hora) => (
              <TimeSlotButton
                key={hora}
                hora={hora}
                bookings={bookingMap.get(`${selectedIso}|${hora}`)}
                onClick={canBook ? () => openSlot(hora, 'regular') : undefined}
                availableLabel={t('painel.comercial.agendamentos.available')}
                carregadoLabel={t('painel.comercial.agendamentos.carregado')}
                showViewSaida={canViewSaida}
                onView={openSaidaView}
                viewLabel={t('painel.comercial.agendamentos.viewSaida')}
                onEditTransporte={canTransporte ? setTransporteBookings : undefined}
                transporteLabel={t('painel.comercial.agendamentos.transporte.button')}
                onConcluir={canConcluir ? setConcluirBookings : undefined}
                concluirLabel={t('painel.comercial.agendamentos.concluir.button')}
                saidasCountLabel={(count) =>
                  t('painel.comercial.agendamentos.saidasCount', { count })
                }
                compact={compact}
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

          <SlotSection compact={compact} title={t('painel.comercial.agendamentos.afternoon')}>
            {slots.afternoon.map((hora) => (
              <TimeSlotButton
                key={hora}
                hora={hora}
                bookings={bookingMap.get(`${selectedIso}|${hora}`)}
                onClick={canBook ? () => openSlot(hora, 'regular') : undefined}
                availableLabel={t('painel.comercial.agendamentos.available')}
                carregadoLabel={t('painel.comercial.agendamentos.carregado')}
                showViewSaida={canViewSaida}
                onView={openSaidaView}
                viewLabel={t('painel.comercial.agendamentos.viewSaida')}
                onEditTransporte={canTransporte ? setTransporteBookings : undefined}
                transporteLabel={t('painel.comercial.agendamentos.transporte.button')}
                onConcluir={canConcluir ? setConcluirBookings : undefined}
                concluirLabel={t('painel.comercial.agendamentos.concluir.button')}
                saidasCountLabel={(count) =>
                  t('painel.comercial.agendamentos.saidasCount', { count })
                }
                compact={compact}
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
            <div
              className={
                compact
                  ? 'grid grid-cols-3 sm:grid-cols-4 gap-1.5'
                  : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2'
              }
            >
              {encaixeGroups.map((group) => (
                <TimeSlotButton
                  key={group.key}
                  hora={t('painel.comercial.agendamentos.encaixe')}
                  bookings={group.bookings}
                  onClick={
                    canBook
                      ? () => openSlot(ENCAIXE_HORARIO, 'encaixe', group.bookings)
                      : undefined
                  }
                  availableLabel={t('painel.comercial.agendamentos.available')}
                  carregadoLabel={t('painel.comercial.agendamentos.carregado')}
                  showViewSaida={canViewSaida}
                  onView={openSaidaView}
                  viewLabel={t('painel.comercial.agendamentos.viewSaida')}
                  onEditTransporte={canTransporte ? setTransporteBookings : undefined}
                  transporteLabel={t('painel.comercial.agendamentos.transporte.button')}
                  onConcluir={canConcluir ? setConcluirBookings : undefined}
                  concluirLabel={t('painel.comercial.agendamentos.concluir.button')}
                  saidasCountLabel={(count) =>
                    t('painel.comercial.agendamentos.saidasCount', { count })
                  }
                  compact={compact}
                  encaixe
                />
              ))}
              {canBook ? (
                <TimeSlotButton
                  hora={t('painel.comercial.agendamentos.encaixe')}
                  bookings={[]}
                  onClick={() => openSlot(ENCAIXE_HORARIO, 'encaixe', [])}
                  availableLabel={t('painel.comercial.agendamentos.encaixeNew')}
                  carregadoLabel={t('painel.comercial.agendamentos.carregado')}
                  compact={compact}
                  encaixe
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {canBook && !lockedSaida ? (
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
      ) : null}

      {canTransporte ? (
        <AgendamentoTransporteModal
          open={!!transporteBookings}
          booking={normalizeBookings(transporteBookings)[0] || null}
          permissionPrefix={permissionPrefix}
          onClose={() => setTransporteBookings(null)}
          onSave={handleSaveTransporte}
        />
      ) : null}

      {canConcluir ? (
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

      {canViewSaida ? (
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

function SlotSection({ title, children, compact = false }) {
  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </p>
      <div
        className={
          compact
            ? 'grid grid-cols-3 sm:grid-cols-4 gap-1.5'
            : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2'
        }
      >
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
  carregadoLabel,
  encaixe = false,
  showViewSaida = false,
  onView,
  viewLabel,
  onEditTransporte,
  transporteLabel,
  onConcluir,
  concluirLabel,
  saidasCountLabel,
  compact = false,
}) {
  const list = normalizeBookings(bookings);
  const summary = summarizeSlotBookings(list);
  const occupied = list.length > 0;
  const carregado = isCarregado(list);
  const interactive = typeof onClick === 'function' && !carregado;
  const showEye = occupied && showViewSaida;
  const showTruck = occupied && !carregado && Boolean(onEditTransporte);
  const showCheck = occupied && !carregado && Boolean(onConcluir);
  const filled = hasTransporte(summary.first);
  const hasSideActions = showTruck || showEye || showCheck;
  const minH = compact ? 'min-h-[56px]' : 'min-h-[72px]';

  const tone = carregado
    ? {
        shell: 'border-sky-200 bg-sky-50',
        hover: interactive ? 'hover:bg-sky-100/80' : '',
        icon: 'text-sky-600',
        title: 'text-sky-900',
        meta: 'text-sky-800',
        metaMuted: 'text-sky-700/80',
        badge: 'text-sky-700',
        eye: 'text-sky-700 hover:text-sky-900 hover:bg-sky-200/70',
      }
    : occupied
      ? {
          shell: 'border-red-200 bg-red-50',
          hover: interactive ? 'hover:bg-red-100/80' : '',
          icon: 'text-red-600',
          title: 'text-red-800',
          meta: 'text-red-800',
          metaMuted: 'text-red-700/80',
          badge: 'text-red-700/80',
          eye: 'text-red-700 hover:text-red-900 hover:bg-red-200/70',
        }
      : {
          shell: encaixe
            ? 'border-dashed border-emerald-300 bg-emerald-50/70'
            : 'border-emerald-200 bg-emerald-50',
          hover: interactive ? 'hover:bg-emerald-100/80' : '',
          icon: 'text-emerald-700',
          title: 'text-emerald-900',
          meta: 'text-emerald-700',
          metaMuted: 'text-emerald-700',
          badge: 'text-emerald-700',
          eye: '',
        };

  return (
    <div
      className={`relative ${minH} rounded-xl border transition-all ${tone.shell} ${tone.hover}`}
    >
      <button
        type="button"
        onClick={interactive ? onClick : undefined}
        disabled={!interactive}
        className={`w-full h-full ${minH} text-left px-3 ${compact ? 'py-2' : 'py-2.5'} rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          hasSideActions ? 'pr-10' : ''
        } ${interactive ? '' : 'cursor-default'}`}
      >
        <span className="flex items-center gap-1.5">
          {carregado ? (
            <CheckCircle2 className={`w-3.5 h-3.5 ${tone.icon}`} />
          ) : (
            <Clock className={`w-3.5 h-3.5 ${tone.icon}`} />
          )}
          <span className={`text-sm font-semibold tabular-nums ${tone.title}`}>{hora}</span>
        </span>
        {occupied ? (
          <span className="mt-1.5 block space-y-0.5">
            {carregado ? (
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${tone.badge}`}
              >
                <CheckCircle2 className="w-3 h-3" />
                {carregadoLabel || 'Carregado'}
              </span>
            ) : null}
            {summary.count > 1 ? (
              <span
                className={`block text-[10px] font-semibold uppercase tracking-wide ${tone.badge}`}
              >
                {saidasCountLabel?.(summary.count) || `${summary.count} saídas`}
              </span>
            ) : null}
            <span className={`block text-xs font-semibold truncate ${tone.meta}`}>
              {summary.codesLabel}
            </span>
            <span className={`block text-[11px] truncate ${tone.metaMuted}`}>
              {summary.clientesLabel}
            </span>
            {filled ? (
              <>
                <span className={`block text-[11px] truncate ${tone.meta}`}>
                  {summary.motorista}
                </span>
                <span className={`block text-[11px] font-mono truncate ${tone.metaMuted}`}>
                  {[summary.placa, summary.transportadora].filter(Boolean).join(' · ')}
                </span>
              </>
            ) : null}
          </span>
        ) : (
          <span className={`mt-1.5 block text-xs font-medium ${tone.meta}`}>
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
              className={`h-7 w-7 ${tone.eye}`}
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
