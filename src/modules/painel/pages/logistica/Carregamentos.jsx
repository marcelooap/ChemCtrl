import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Search, Undo2, X } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { RowActionButton } from '@shared/components/ui/RowActionButton';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import DateInputBr from '@shared/components/ui/DateInputBr';
import { useToast } from '@shared/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { entities } from '@transbordo/services/entities';
import SaidaViewDialog from '@transbordo/components/saida/SaidaViewDialog';
import PontualidadeStatsCard, {
  computePontualidadeStats,
} from '@painel/components/logistica/PontualidadeStatsCard';
import AtrasoResponsavelStatsCard, {
  computeAtrasoResponsavelStats,
} from '@painel/components/logistica/AtrasoResponsavelStatsCard';
import {
  ENCAIXE_HORARIO,
  formatDateBR,
  groupCarregamentosConcluidos,
  listAgendamentosConcluidos,
  normalizeBookings,
  reverterCarregamento,
} from '@painel/lib/agendamentosCarregamento';
import { checklistItemsFromBooking } from '@painel/lib/carregamentoChecklistConfig';
import { resolveVasilhameDaSaida } from '@transbordo/lib/vasilhameSaidaLink';

/** Destinos distintos das saídas do carregamento. */
function destinosLabelFromSaidas(saidas = []) {
  const names = [
    ...new Set(
      (saidas || [])
        .map((saida) => String(saida?.destino || '').trim())
        .filter(Boolean)
    ),
  ];
  if (names.length === 0) return '—';
  return names.join(' · ');
}

/** Tokens de busca do tanque (nº placa / nº barril) a partir dos itens das saídas. */
function tankSearchTokens(saidasResolvidas = [], vasilhames = []) {
  const tokens = [];
  for (const saida of saidasResolvidas || []) {
    for (const item of saida?.itens || []) {
      const vasilhame = resolveVasilhameDaSaida(item, vasilhames, {
        preferPatio: false,
      });
      const placa = String(
        item?.vasilhame_placa || vasilhame?.placa || vasilhame?.container_number || ''
      ).trim();
      const barril = String(
        item?.vasilhame_barril ?? vasilhame?.barril ?? vasilhame?.barril_number ?? ''
      ).trim();
      if (placa && placa !== '—' && placa !== '-') tokens.push(placa);
      if (barril && barril !== '—' && barril !== '-') tokens.push(barril);
    }
  }
  return tokens;
}

/** Mês (YYYY-MM) da data efetiva do carregamento. */
const rowMonthKey = (row) =>
  String(row?.data_carregamento || row?.data || '').slice(0, 7);

const currentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

export default function LogisticaCarregamentos() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [saidas, setSaidas] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [entradas, setEntradas] = useState([]);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [appliedDateFrom, setAppliedDateFrom] = useState('');
  const [appliedDateTo, setAppliedDateTo] = useState('');
  const [viewSaida, setViewSaida] = useState(null);
  const [viewAgendamento, setViewAgendamento] = useState(null);
  const [viewChecklistItems, setViewChecklistItems] = useState([]);
  const [viewPicker, setViewPicker] = useState(null);
  const [revertTarget, setRevertTarget] = useState(null);
  const [reverting, setReverting] = useState(false);
  const [statsMonth, setStatsMonth] = useState(currentMonthKey);

  const saidasById = useMemo(() => {
    const map = new Map();
    for (const s of saidas || []) {
      if (s?.id) map.set(String(s.id), s);
    }
    return map;
  }, [saidas]);

  const loadData = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const [concluidos, saidasList, vascs, ents] = await Promise.all([
          listAgendamentosConcluidos(),
          entities.saidas.list('-created_date'),
          entities.vasilhames.list(),
          entities.estoque.list(),
        ]);
        setRows(groupCarregamentosConcluidos(concluidos || []));
        setSaidas(saidasList || []);
        setVasilhames(vascs || []);
        setEntradas(ents || []);
      } catch (err) {
        console.error('[LogisticaCarregamentos] loadData:', err);
        toast({
          title: t('painel.logistica.carregamentos.loadErrorTitle'),
          description:
            err?.message || t('painel.logistica.carregamentos.loadErrorDescription'),
          variant: 'destructive',
        });
        setRows([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [t, toast]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const displayRows = useMemo(() => {
    return rows.map((row) => {
      const saidasGrupo = normalizeBookings(row.bookings)
        .map((b) => saidasById.get(String(b.saida_id)))
        .filter(Boolean);
      return {
        ...row,
        destinosLabel: destinosLabelFromSaidas(saidasGrupo),
        saidasResolvidas: saidasGrupo,
      };
    });
  }, [rows, saidasById]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = String(appliedDateFrom || '').slice(0, 10);
    const to = String(appliedDateTo || '').slice(0, 10);

    return displayRows.filter((row) => {
      const carregamentoDate = String(row.data_carregamento || row.data || '').slice(0, 10);

      if (from && (!carregamentoDate || carregamentoDate < from)) return false;
      if (to && (!carregamentoDate || carregamentoDate > to)) return false;

      if (!q) return true;
      const hay = [
        row.codesLabel,
        row.clientesLabel,
        row.destinosLabel,
        row.transportadora,
        row.motorista,
        row.placa,
        row.operador_nome,
        row.horario,
        row.hora_carregamento,
        formatDateBR(row.data),
        formatDateBR(row.data_carregamento),
        ...tankSearchTokens(row.saidasResolvidas, vasilhames),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [displayRows, search, appliedDateFrom, appliedDateTo, vasilhames]);

  const hasDateDraft = Boolean(dateFrom || dateTo);
  const hasDateFilter = Boolean(appliedDateFrom || appliedDateTo);

  const applyDateFilter = () => {
    setAppliedDateFrom(String(dateFrom || '').slice(0, 10));
    setAppliedDateTo(String(dateTo || '').slice(0, 10));
  };

  const clearDateFilter = () => {
    setDateFrom('');
    setDateTo('');
    setAppliedDateFrom('');
    setAppliedDateTo('');
  };

  // Meses disponíveis para o filtro do contador (sempre inclui o mês atual).
  const statsMonthOptions = useMemo(() => {
    const months = new Set([currentMonthKey()]);
    for (const row of rows) {
      const key = rowMonthKey(row);
      if (/^\d{4}-\d{2}$/.test(key)) months.add(key);
    }
    return [...months].sort((a, b) => b.localeCompare(a));
  }, [rows]);

  const statsMonthLabel = useCallback(
    (key) => {
      const [y, m] = key.split('-').map(Number);
      if (!y || !m) return key;
      const label = new Intl.DateTimeFormat(i18n.language, {
        month: 'long',
        year: 'numeric',
      }).format(new Date(y, m - 1, 1));
      return label.charAt(0).toUpperCase() + label.slice(1);
    },
    [i18n.language]
  );

  // Pontualidade e responsáveis dos atrasos no mês selecionado.
  const monthRows = useMemo(
    () => rows.filter((row) => rowMonthKey(row) === statsMonth),
    [rows, statsMonth]
  );
  const pontualidadeStats = useMemo(
    () => computePontualidadeStats(monthRows),
    [monthRows]
  );
  const atrasoResponsavelStats = useMemo(
    () => computeAtrasoResponsavelStats(monthRows),
    [monthRows]
  );

  const resolveSaida = (booking) => saidasById.get(String(booking?.saida_id));

  const openView = (row) => {
    const list = normalizeBookings(row?.bookings);
    if (list.length === 0) return;
    if (list.length === 1) {
      const booking = list[0];
      const saida = resolveSaida(booking);
      if (!saida) {
        toast({
          title: t('painel.logistica.carregamentos.viewSaidaMissingTitle'),
          description: t('painel.logistica.carregamentos.viewSaidaMissing'),
          variant: 'destructive',
        });
        return;
      }
      setViewChecklistItems(checklistItemsFromBooking(booking, saida.id));
      setViewAgendamento(booking);
      setViewSaida(saida);
      return;
    }
    setViewPicker(list);
  };

  const handleRevert = async () => {
    const row = revertTarget;
    if (!row) return;
    setReverting(true);
    try {
      await reverterCarregamento({ bookings: row.bookings });
      setRevertTarget(null);
      await loadData({ silent: true });
      toast({ title: t('painel.logistica.carregamentos.revertSuccess') });
    } catch (err) {
      console.error('[LogisticaCarregamentos] revert:', err);
      toast({
        title: t('painel.logistica.carregamentos.revertErrorTitle'),
        description:
          err?.message || t('painel.logistica.carregamentos.revertErrorDescription'),
        variant: 'destructive',
      });
    } finally {
      setReverting(false);
    }
  };

  const horarioLabel = (horario) =>
    horario === ENCAIXE_HORARIO
      ? t('painel.comercial.agendamentos.encaixe')
      : horario || '—';

  if (loading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">
            {t('painel.logistica.sections.carregamentos.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('painel.logistica.sections.carregamentos.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-stretch justify-end gap-3">
          <PontualidadeStatsCard
            className="h-full"
            stats={pontualidadeStats}
            title={t('painel.logistica.carregamentos.stats.title')}
            action={
              <Select value={statsMonth} onValueChange={setStatsMonth}>
                <SelectTrigger
                  className="h-7 w-[160px] text-xs"
                  aria-label={t('painel.logistica.carregamentos.stats.monthFilter')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statsMonthOptions.map((key) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      {statsMonthLabel(key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <AtrasoResponsavelStatsCard
            className="h-full"
            stats={atrasoResponsavelStats}
            title={t('painel.logistica.carregamentos.stats.atrasoTitle')}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col">
        <div className="shrink-0 px-5 py-3 border-b border-border flex flex-col items-start gap-2">
          <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="text-sm font-semibold text-foreground">
              {t('painel.logistica.carregamentos.tableTitle')}
            </h2>
            <span className="text-xs text-muted-foreground">
              {t('painel.logistica.carregamentos.tableCount', {
                count: filteredRows.length,
              })}
            </span>
          </div>
          <div className="flex flex-wrap items-end justify-start gap-2 w-full">
            <div className="relative w-full sm:w-[28rem] min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('painel.logistica.carregamentos.searchPlaceholder')}
                className="pl-9 h-9"
                title={t('painel.logistica.carregamentos.searchPlaceholder')}
              />
            </div>
            <div className="flex flex-wrap items-end gap-2 ml-2">
            <div className="space-y-1">
              <Label htmlFor="carreg-date-from" className="text-[11px] text-muted-foreground">
                {t('painel.logistica.carregamentos.dateFrom')}
              </Label>
              <DateInputBr
                value={dateFrom}
                onChange={setDateFrom}
                className="w-[160px]"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="carreg-date-to" className="text-[11px] text-muted-foreground">
                {t('painel.logistica.carregamentos.dateTo')}
              </Label>
              <DateInputBr
                value={dateTo}
                onChange={setDateTo}
                className="w-[160px]"
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-9"
              onClick={applyDateFilter}
              disabled={!hasDateDraft}
            >
              {t('painel.logistica.carregamentos.filterButton')}
            </Button>
            {hasDateFilter || hasDateDraft ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-muted-foreground"
                onClick={clearDateFilter}
                title={t('painel.logistica.carregamentos.clearDates')}
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
            </div>
          </div>
        </div>

        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm table-auto">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground sticky top-0 z-10">
                <th className="px-2.5 py-2.5 font-semibold whitespace-nowrap">
                  {t('painel.logistica.carregamentos.columns.saida')}
                </th>
                <th className="px-2.5 py-2.5 font-semibold whitespace-nowrap">
                  {t('painel.logistica.carregamentos.columns.cliente')}
                </th>
                <th className="px-2.5 py-2.5 font-semibold whitespace-nowrap">
                  {t('painel.logistica.carregamentos.columns.destino')}
                </th>
                <th className="px-2.5 py-2.5 font-semibold whitespace-nowrap text-center">
                  {t('painel.logistica.carregamentos.columns.transportadora')}
                </th>
                <th className="px-2.5 py-2.5 font-semibold whitespace-nowrap text-center">
                  {t('painel.logistica.carregamentos.columns.motorista')}
                </th>
                <th className="px-2.5 py-2.5 font-semibold whitespace-nowrap">
                  {t('painel.logistica.carregamentos.columns.placa')}
                </th>
                <th className="px-2.5 py-2.5 font-semibold whitespace-nowrap text-center">
                  {t('painel.logistica.carregamentos.columns.horarioAgendado')}
                </th>
                <th className="px-2.5 py-2.5 font-semibold whitespace-nowrap text-center">
                  {t('painel.logistica.carregamentos.columns.horarioCarregamento')}
                </th>
                <th className="px-2.5 py-2.5 font-semibold whitespace-nowrap text-center">
                  {t('painel.logistica.carregamentos.columns.status')}
                </th>
                <th className="px-2.5 py-2.5 font-semibold whitespace-nowrap text-center">
                  {t('painel.logistica.carregamentos.columns.operador')}
                </th>
                <th className="px-2.5 py-2.5 font-semibold whitespace-nowrap text-right">
                  {t('painel.logistica.carregamentos.columns.acoes')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
                    className="px-2.5 py-12 text-center text-sm text-muted-foreground"
                  >
                    {t('painel.logistica.carregamentos.empty')}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-2.5 py-2.5 font-medium text-primary whitespace-nowrap">
                      {row.codesLabel}
                    </td>
                    <td className="px-2.5 py-2.5 text-foreground whitespace-nowrap">
                      {row.clientesLabel}
                    </td>
                    <td className="px-2.5 py-2.5 text-muted-foreground whitespace-nowrap">
                      {row.destinosLabel}
                    </td>
                    <td className="px-2.5 py-2.5 text-foreground whitespace-nowrap text-center">
                      {row.transportadora || '—'}
                    </td>
                    <td className="px-2.5 py-2.5 text-foreground whitespace-nowrap text-center">
                      {row.motorista || '—'}
                    </td>
                    <td className="px-2.5 py-2.5 font-mono text-foreground whitespace-nowrap">
                      {row.placa || '—'}
                    </td>
                    <td className="px-2.5 py-2.5 text-muted-foreground whitespace-nowrap text-center">
                      <span className="block tabular-nums">{horarioLabel(row.horario)}</span>
                      <span className="block text-[11px]">{formatDateBR(row.data)}</span>
                    </td>
                    <td className="px-2.5 py-2.5 tabular-nums text-foreground whitespace-nowrap text-center">
                      <span className="block">{row.hora_carregamento || '—'}</span>
                      {row.data_carregamento ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {formatDateBR(row.data_carregamento)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap text-center">
                      <PontualidadeBadge status={row.pontualidade} t={t} />
                    </td>
                    <td className="px-2.5 py-2.5 text-foreground whitespace-nowrap text-center">
                      {row.operador_nome || '—'}
                    </td>
                    <td className="px-2.5 py-2.5 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <RowActionButton
                          title={t('painel.logistica.carregamentos.view')}
                          onClick={() => openView(row)}
                        >
                          <Eye />
                        </RowActionButton>
                        <RowActionButton
                          title={t('painel.logistica.carregamentos.revert')}
                          onClick={() => setRevertTarget(row)}
                        >
                          <Undo2 />
                        </RowActionButton>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!viewPicker} onOpenChange={(v) => !v && setViewPicker(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('painel.logistica.carregamentos.viewSaidaPickTitle')}</DialogTitle>
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
                      title: t('painel.logistica.carregamentos.viewSaidaMissingTitle'),
                      description: t('painel.logistica.carregamentos.viewSaidaMissing'),
                      variant: 'destructive',
                    });
                    return;
                  }
                  setViewChecklistItems(checklistItemsFromBooking(row, saida.id));
                  setViewAgendamento(row);
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

      <AlertDialog
        open={!!revertTarget}
        onOpenChange={(open) => {
          if (!open && !reverting) setRevertTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('painel.logistica.carregamentos.revertConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('painel.logistica.carregamentos.revertConfirmDescription', {
                saida: revertTarget?.codesLabel || '—',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reverting}>
              {t('buttons.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={reverting}
              onClick={(e) => {
                e.preventDefault();
                handleRevert();
              }}
            >
              {reverting
                ? t('painel.logistica.carregamentos.reverting')
                : t('painel.logistica.carregamentos.revertConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SaidaViewDialog
        open={!!viewSaida}
        saida={viewSaida}
        vasilhames={vasilhames}
        entradas={entradas}
        variant="agendamento"
        checklistItems={viewChecklistItems}
        showPrintEtiqueta={false}
        showRelatorioSaida={false}
        agendamento={viewAgendamento}
        onClose={() => {
          setViewSaida(null);
          setViewAgendamento(null);
          setViewChecklistItems([]);
        }}
      />
    </div>
  );
}

function PontualidadeBadge({ status, t }) {
  const dentro = status === 'dentro';
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${
        dentro
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-red-200 bg-red-50 text-red-800'
      }`}
    >
      {dentro
        ? t('painel.logistica.carregamentos.status.dentro')
        : t('painel.logistica.carregamentos.status.fora')}
    </span>
  );
}
