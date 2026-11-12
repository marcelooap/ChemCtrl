import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRightLeft,
  BarChart3,
  Factory,
  Filter,
  Layers,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@shared/components/ui/toggle-group';
import { formatNum, formatPercent } from '@transbordo/lib/format';
import {
  buildPainelTransbordoDashboardView,
  loadPainelTransbordoDashboard,
} from '@painel/lib/dashboardTransbordoData';
import {
  buildPainelLogisticaDashboardView,
  loadPainelLogisticaDashboard,
} from '@painel/lib/dashboardLogisticaData';
import DashboardLogisticaView from '@painel/components/dashboard/DashboardLogisticaView';

const VIEW = Object.freeze({
  TRANSBORDO: 'transbordo',
  LOGISTICA: 'logistica',
});

const COLORS = {
  total: '#1d4ed8',
  convencional: '#f59e0b',
  industrializado: '#00875a',
  filtrado: '#0891b2',
};

const MONTH_KEYS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const KPI_META = [
  {
    key: 'total',
    icon: Layers,
    color: COLORS.total,
    tint: 'rgba(29, 78, 216, 0.08)',
    ring: 'rgba(29, 78, 216, 0.18)',
    labelKey: 'volumeTotal',
  },
  {
    key: 'convencional',
    icon: ArrowRightLeft,
    color: COLORS.convencional,
    tint: 'rgba(245, 158, 11, 0.10)',
    ring: 'rgba(245, 158, 11, 0.20)',
    labelKey: 'volumeConvencional',
  },
  {
    key: 'industrializado',
    icon: Factory,
    color: COLORS.industrializado,
    tint: 'rgba(0, 135, 90, 0.09)',
    ring: 'rgba(0, 135, 90, 0.18)',
    labelKey: 'volumeIndustrializado',
  },
  {
    key: 'filtrado',
    icon: Filter,
    color: COLORS.filtrado,
    tint: 'rgba(8, 145, 178, 0.09)',
    ring: 'rgba(8, 145, 178, 0.18)',
    labelKey: 'volumeFiltrado',
  },
];

function VolumeKpiCard({ title, value, icon: Icon, color, tint, ring }) {
  const raw = String(value || '0 L');
  const unitMatch = raw.match(/^(.*)\s(L)$/);
  const amount = unitMatch ? unitMatch[1] : raw;
  const unit = unitMatch ? unitMatch[2] : '';

  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
      style={{
        backgroundImage: `linear-gradient(145deg, ${tint} 0%, transparent 58%)`,
      }}
    >
      <div
        className="absolute inset-y-0 left-0 w-1 rounded-l-2xl"
        style={{ background: color }}
        aria-hidden
      />
      <div className="relative flex flex-col gap-4 p-5 pl-6">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground leading-snug pt-0.5">
            {title}
          </p>
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105"
            style={{
              background: tint,
              boxShadow: `inset 0 0 0 1px ${ring}`,
            }}
          >
            <Icon style={{ color, width: 18, height: 18 }} />
          </div>
        </div>
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span
            className="text-[1.65rem] font-bold tracking-tight tabular-nums text-foreground truncate leading-none"
            title={raw}
          >
            {amount}
          </span>
          {unit ? (
            <span className="text-sm font-semibold text-muted-foreground">{unit}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const EMPTY_DASHBOARD = {
  totals: { total: 0, convencional: 0, industrializado: 0, filtrado: 0 },
  monthly: Array.from({ length: 12 }, (_, monthIndex) => ({
    monthIndex,
    monthLabel: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][monthIndex],
    total: 0,
    convencional: 0,
    industrializado: 0,
    filtrado: 0,
  })),
  daily: [],
  distribution: [
    { key: 'convencional', name: 'Convencional', volume: 0, percent: 0 },
    { key: 'industrializado', name: 'Industrializado', volume: 0, percent: 0 },
    { key: 'filtrado', name: 'Filtrado', volume: 0, percent: 0 },
  ],
  operators: [],
};

function ChartCard({ title, subtitle, children, className, action }) {
  return (
    <div
      className={`rounded-2xl border border-border/80 bg-card shadow-sm overflow-hidden ${className || ''}`}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-1">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
          {subtitle ? (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="px-5 pb-5 pt-3">{children}</div>
    </div>
  );
}

function truncateLabel(name, max = 16) {
  const s = String(name || '—').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function formatLitersCard(value) {
  return `${formatNum(value || 0, 0)} L`;
}

function formatAxisVolume(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    return `${formatNum(n / 1_000_000, 1)}M`;
  }
  if (abs >= 1_000) {
    return `${formatNum(n / 1_000, 0)}k`;
  }
  return formatNum(n, 0);
}

const SERIES_COLORS = {
  total: COLORS.total,
  convencional: COLORS.convencional,
  industrializado: COLORS.industrializado,
  filtrado: COLORS.filtrado,
};

function seriesLabel(t, keyOrName) {
  const key = String(keyOrName || '');
  if (SERIES_COLORS[key]) return t(`painel.dashboard.series.${key}`);
  return key;
}

function ChartTooltip({ active, payload, label, labelFormatter, t }) {
  if (!active || !payload?.length) return null;
  const title =
    typeof labelFormatter === 'function'
      ? labelFormatter(label, payload)
      : label;

  return (
    <div className="rounded-xl border border-border/70 bg-card/95 backdrop-blur-sm px-3.5 py-2.5 shadow-lg min-w-[168px]">
      {title ? (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          {title}
        </p>
      ) : null}
      <div className="space-y-1.5">
        {payload.map((entry) => (
          <div
            key={String(entry.dataKey || entry.name)}
            className="flex items-center justify-between gap-4 text-xs"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: entry.color || entry.fill }}
              />
              <span className="text-muted-foreground truncate">
                {seriesLabel(
                  t,
                  SERIES_COLORS[entry.name]
                    ? entry.name
                    : SERIES_COLORS[entry.dataKey]
                      ? entry.dataKey
                      : entry.name || entry.dataKey
                )}
              </span>
            </div>
            <span className="font-semibold tabular-nums text-foreground">
              {formatLitersCard(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderLegend(props, t) {
  const { payload } = props;
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 pt-3">
      {payload.map((entry) => (
        <span
          key={String(entry.value)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-foreground"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: entry.color }}
          />
          {t(`painel.dashboard.series.${entry.value}`)}
        </span>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const [view, setView] = useState(VIEW.TRANSBORDO);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [yearPayload, setYearPayload] = useState(null);
  const [logisticaPayload, setLogisticaPayload] = useState(null);

  const yearOptions = useMemo(() => {
    const years = new Set([currentYear, selectedYear]);
    for (let y = currentYear; y >= currentYear - 5; y -= 1) years.add(y);
    return Array.from(years).sort((a, b) => b - a);
  }, [currentYear, selectedYear]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (view === VIEW.LOGISTICA) {
        const data = await loadPainelLogisticaDashboard(selectedYear);
        setLogisticaPayload(data);
      } else {
        const data = await loadPainelTransbordoDashboard(selectedYear);
        setYearPayload(data);
      }
    } catch (err) {
      console.error('[Painel Dashboard]', err);
      setError(err?.message || t('painel.dashboard.loadErrorDescription'));
      if (view === VIEW.LOGISTICA) setLogisticaPayload(null);
      else setYearPayload(null);
    } finally {
      setLoading(false);
    }
  }, [selectedYear, view, t]);

  useEffect(() => {
    load();
  }, [load]);

  const dashboard = useMemo(() => {
    if (!yearPayload) return EMPTY_DASHBOARD;
    const computed = buildPainelTransbordoDashboardView(yearPayload, {
      year: selectedYear,
      month: selectedMonth,
    });
    return {
      ...EMPTY_DASHBOARD,
      ...computed,
      totals: { ...EMPTY_DASHBOARD.totals, ...(computed?.totals || {}) },
      monthly:
        Array.isArray(computed?.monthly) && computed.monthly.length === 12
          ? computed.monthly
          : EMPTY_DASHBOARD.monthly,
      daily: Array.isArray(computed?.daily) ? computed.daily : [],
      distribution:
        Array.isArray(computed?.distribution) && computed.distribution.length
          ? computed.distribution
          : EMPTY_DASHBOARD.distribution,
      operators: Array.isArray(computed?.operators) ? computed.operators : [],
    };
  }, [yearPayload, selectedYear, selectedMonth]);

  const logisticaDashboard = useMemo(() => {
    if (!logisticaPayload) return null;
    return buildPainelLogisticaDashboardView(logisticaPayload, {
      year: selectedYear,
      month: selectedMonth,
      t,
    });
  }, [logisticaPayload, selectedYear, selectedMonth, t]);

  const pieData = useMemo(
    () =>
      (dashboard.distribution || [])
        .filter((d) => (d.volume || 0) > 0)
        .map((item) => ({
          ...item,
          fill:
            item.key === 'industrializado'
              ? COLORS.industrializado
              : item.key === 'filtrado'
                ? COLORS.filtrado
                : COLORS.convencional,
        })),
    [dashboard.distribution]
  );

  const operatorChartData = useMemo(
    () =>
      (dashboard.operators || []).map((item) => ({
        ...item,
        label: truncateLabel(item.name, 16),
      })),
    [dashboard.operators]
  );

  const operatorChartHeight = Math.max(280, operatorChartData.length * 36);

  const hasMonthlyData = (dashboard.monthly || []).some(
    (m) => (m.total || 0) > 0
  );

  const hasDailyData = (dashboard.daily || []).some((d) => (d.volume || 0) > 0);

  const hasPeriodData = (dashboard.totals?.total || 0) > 0;

  const dailyTickInterval = useMemo(() => {
    const days = dashboard.daily?.length || 0;
    if (days <= 10) return 0;
    if (days <= 20) return 1;
    return 2;
  }, [dashboard.daily]);

  return (
    <div className="h-full min-h-0 overflow-y-auto w-full space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t('painel.dashboard.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('painel.dashboard.subtitle')}
          </p>
          <div className="mt-3">
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(v) => v && setView(v)}
              aria-label={t('painel.dashboard.viewLabel')}
              className="justify-start bg-card border border-border rounded-lg p-0.5 w-fit"
            >
              <ToggleGroupItem
                value={VIEW.TRANSBORDO}
                className="text-xs px-3 h-8 data-[state=on]:bg-[#2575D1] data-[state=on]:text-white"
              >
                {t('painel.dashboard.views.transbordo')}
              </ToggleGroupItem>
              <ToggleGroupItem
                value={VIEW.LOGISTICA}
                className="text-xs px-3 h-8 data-[state=on]:bg-[#2575D1] data-[state=on]:text-white"
              >
                {t('painel.dashboard.views.logistica')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-2.5 w-[140px]">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              {t('painel.dashboard.yearLabel')}
            </label>
            <Select
              value={String(selectedYear)}
              onValueChange={(v) => setSelectedYear(Number(v))}
            >
              <SelectTrigger className="h-8 text-xs mt-0.5 w-full bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={String(year)} className="text-xs">
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              {t('painel.dashboard.monthLabel')}
            </label>
            <Select
              value={String(selectedMonth)}
              onValueChange={(v) => setSelectedMonth(Number(v))}
            >
              <SelectTrigger className="h-8 text-xs mt-0.5 w-full bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_KEYS.map((key, index) => (
                  <SelectItem key={key} value={String(index)} className="text-xs">
                    {t(`painel.dashboard.months.${key}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {view === VIEW.LOGISTICA ? (
        <DashboardLogisticaView
          data={logisticaDashboard}
          loading={loading}
          error={error}
        />
      ) : loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" />
        </div>
      ) : error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              {t('painel.dashboard.loadErrorTitle')}
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
            {KPI_META.map(({ key, icon, color, tint, ring, labelKey }) => (
              <VolumeKpiCard
                key={key}
                title={t(`painel.dashboard.kpis.${labelKey}`)}
                value={formatLitersCard(dashboard.totals?.[key])}
                icon={icon}
                color={color}
                tint={tint}
                ring={ring}
              />
            ))}
          </div>

          <ChartCard
            title={t('painel.dashboard.charts.monthly')}
            subtitle={t('painel.dashboard.charts.monthlyHint', { year: selectedYear })}
          >
            {!hasMonthlyData ? (
              <p className="text-sm text-muted-foreground text-center py-16">
                {t('painel.dashboard.emptyYear')}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={340}>
                <BarChart
                  data={dashboard.monthly}
                  barGap={3}
                  barCategoryGap="22%"
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="4 6"
                    stroke="hsl(var(--border))"
                    strokeOpacity={0.7}
                  />
                  <XAxis
                    dataKey="monthLabel"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 500 }}
                    dy={6}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickFormatter={formatAxisVolume}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(148, 163, 184, 0.08)', radius: 8 }}
                    content={<ChartTooltip t={t} labelFormatter={(label) => label} />}
                  />
                  <Legend content={(props) => renderLegend(props, t)} />
                  {['total', 'convencional', 'industrializado', 'filtrado'].map((key) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      name={key}
                      fill={SERIES_COLORS[key]}
                      radius={[5, 5, 2, 2]}
                      maxBarSize={28}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title={t('painel.dashboard.charts.daily')}
            subtitle={t('painel.dashboard.charts.dailyHint', {
              month: t(`painel.dashboard.months.${MONTH_KEYS[selectedMonth]}`),
              year: selectedYear,
            })}
          >
            {!hasDailyData ? (
              <p className="text-sm text-muted-foreground text-center py-16">
                {t('painel.dashboard.emptyPeriod')}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart
                  data={dashboard.daily}
                  margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="dailyVolumeFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.total} stopOpacity={0.28} />
                      <stop offset="55%" stopColor={COLORS.total} stopOpacity={0.08} />
                      <stop offset="100%" stopColor={COLORS.total} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="4 6"
                    stroke="hsl(var(--border))"
                    strokeOpacity={0.7}
                  />
                  <XAxis
                    dataKey="dayLabel"
                    axisLine={false}
                    tickLine={false}
                    interval={dailyTickInterval}
                    tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 500 }}
                    dy={6}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickFormatter={formatAxisVolume}
                  />
                  <Tooltip
                    cursor={{
                      stroke: 'rgba(148, 163, 184, 0.45)',
                      strokeWidth: 1,
                      strokeDasharray: '4 4',
                    }}
                    content={
                      <ChartTooltip
                        t={t}
                        labelFormatter={(label) =>
                          t('painel.dashboard.charts.dailyDayLabel', { day: label })
                        }
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="volume"
                    name="total"
                    stroke={COLORS.total}
                    strokeWidth={2.5}
                    fill="url(#dailyVolumeFill)"
                    dot={false}
                    activeDot={{
                      r: 5,
                      strokeWidth: 2,
                      stroke: '#fff',
                      fill: COLORS.total,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 pb-2">
            <ChartCard title={t('painel.dashboard.charts.distribution')}>
              {!hasPeriodData ? (
                <p className="text-sm text-muted-foreground text-center py-16">
                  {t('painel.dashboard.emptyPeriod')}
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-[1.05fr_0.95fr] gap-5 items-center">
                  <div className="relative h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="volume"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={74}
                          outerRadius={108}
                          paddingAngle={3}
                          stroke="hsl(var(--card))"
                          strokeWidth={3}
                        >
                          {pieData.map((entry) => (
                            <Cell
                              key={entry.key}
                              fill={entry.fill}
                              style={{ filter: 'drop-shadow(0 1px 1px rgba(15,23,42,0.08))' }}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const item = payload[0]?.payload;
                            if (!item) return null;
                            return (
                              <div className="rounded-xl border border-border/70 bg-card/95 backdrop-blur-sm px-3.5 py-2.5 shadow-lg">
                                <div className="flex items-center gap-2 mb-1">
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ background: item.fill }}
                                  />
                                  <span className="text-xs font-semibold">
                                    {t(`painel.dashboard.series.${item.key}`)}
                                  </span>
                                </div>
                                <p className="text-sm font-bold tabular-nums">
                                  {formatLitersCard(item.volume)}
                                </p>
                                <p className="text-[11px] text-muted-foreground tabular-nums">
                                  {formatPercent(item.percent)}%
                                </p>
                              </div>
                            );
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {t('painel.dashboard.totalCenter')}
                      </span>
                      <span className="text-base font-bold tabular-nums tracking-tight mt-0.5">
                        {formatLitersCard(dashboard.totals?.total)}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    {(dashboard.distribution || []).map((item) => {
                      const color =
                        item.key === 'industrializado'
                          ? COLORS.industrializado
                          : item.key === 'filtrado'
                            ? COLORS.filtrado
                            : COLORS.convencional;
                      return (
                        <div
                          key={item.key}
                          className="rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ background: color }}
                              />
                              <span className="text-sm font-medium truncate">
                                {t(`painel.dashboard.series.${item.key}`)}
                              </span>
                            </div>
                            <span className="text-[11px] font-semibold tabular-nums text-muted-foreground shrink-0">
                              {formatPercent(item.percent)}%
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 rounded-full bg-border/60 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(100, Math.max(0, item.percent || 0))}%`,
                                background: color,
                              }}
                            />
                          </div>
                          <p className="mt-1.5 text-sm font-semibold tabular-nums tracking-tight">
                            {formatLitersCard(item.volume)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </ChartCard>

            <ChartCard
              title={t('painel.dashboard.charts.operators')}
              action={
                <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center">
                  <BarChart3 className="w-4 h-4 text-muted-foreground" />
                </div>
              }
            >
              {!hasPeriodData || operatorChartData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-16">
                  {t('painel.dashboard.emptyOperators')}
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={operatorChartHeight}>
                  <BarChart
                    data={operatorChartData}
                    layout="vertical"
                    margin={{ top: 4, left: 4, right: 56, bottom: 4 }}
                    barCategoryGap="28%"
                  >
                    <CartesianGrid
                      horizontal={false}
                      strokeDasharray="4 6"
                      stroke="hsl(var(--border))"
                      strokeOpacity={0.7}
                    />
                    <XAxis
                      type="number"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                      tickFormatter={formatAxisVolume}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={118}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: '#64748b', fontWeight: 500 }}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                      content={
                        <ChartTooltip
                          t={t}
                          labelFormatter={(_label, payload) =>
                            payload?.[0]?.payload?.name || ''
                          }
                        />
                      }
                    />
                    <Bar
                      dataKey="volume"
                      name="total"
                      fill={COLORS.total}
                      radius={[0, 8, 8, 0]}
                      barSize={18}
                      background={{ fill: 'rgba(148, 163, 184, 0.08)', radius: 8 }}
                    >
                      <LabelList
                        dataKey="volume"
                        position="right"
                        formatter={(v) => formatNum(v || 0, 0)}
                        style={{
                          fill: '#64748b',
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
