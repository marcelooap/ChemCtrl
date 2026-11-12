import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Timer,
  Truck,
  UserRound,
  Building2,
} from 'lucide-react';
import {
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
import { RowActionButton } from '@shared/components/ui/RowActionButton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@shared/components/ui/dialog';
import { usePermissions } from '@industrializacao/lib/rbac/PermissionProvider';
import { formatNum, formatPercent } from '@transbordo/lib/format';
import { formatAtrasoDuration } from '@painel/lib/dashboardLogisticaMetrics';

const CARREGAMENTOS_PATH = '/painel/logistica/carregamentos';

const COLORS = {
  pontual: '#059669',
  atraso: '#dc2626',
  intertank: '#f59e0b',
  cliente: '#2563eb',
  naoInformado: '#94a3b8',
  total: '#1d4ed8',
};

function KpiCard({ title, value, subtitle, icon: Icon, color, tint, ring }) {
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm"
      style={{ backgroundImage: `linear-gradient(145deg, ${tint} 0%, transparent 58%)` }}
    >
      <div className="absolute inset-y-0 left-0 w-1 rounded-l-2xl" style={{ background: color }} />
      <div className="relative flex flex-col gap-3 p-5 pl-6">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground leading-snug pt-0.5">
            {title}
          </p>
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: tint, boxShadow: `inset 0 0 0 1px ${ring}` }}
          >
            <Icon style={{ color, width: 18, height: 18 }} />
          </div>
        </div>
        <p className="text-[1.65rem] font-bold tracking-tight tabular-nums leading-none">
          {value}
        </p>
        {subtitle ? (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card shadow-sm overflow-hidden">
      <div className="px-5 pt-5 pb-1">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {subtitle ? (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        ) : null}
      </div>
      <div className="px-5 pb-5 pt-3">{children}</div>
    </div>
  );
}

function ChartTooltipBox({ title, rows }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/95 backdrop-blur-sm px-3.5 py-2.5 shadow-lg min-w-[168px]">
      {title ? (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          {title}
        </p>
      ) : null}
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              {row.color ? (
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: row.color }} />
              ) : null}
              <span className="text-muted-foreground truncate">{row.label}</span>
            </div>
            <span className="font-semibold tabular-nums">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricPill({ label, value, tone }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    red: 'bg-red-50 text-red-800 border-red-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    blue: 'bg-sky-50 text-sky-800 border-sky-200',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${tones[tone] || tones.slate}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-xl font-bold tabular-nums mt-1">{value}</p>
    </div>
  );
}

export default function DashboardLogisticaView({ data, loading, error }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canAccessPath } = usePermissions();
  const canOpenCarregamentos = canAccessPath(CARREGAMENTOS_PATH);
  /** @type {[{ type: 'motivo'|'responsavel', key: string, title: string }|null, Function]} */
  const [saidasDrill, setSaidasDrill] = useState(null);

  const openCarregamentoSaida = (saidaCodigo) => {
    const code = String(saidaCodigo || '').trim();
    if (!canOpenCarregamentos || !code || code === '—') return;
    const params = new URLSearchParams({ q: code });
    navigate(`${CARREGAMENTOS_PATH}?${params.toString()}`);
  };

  useEffect(() => {
    setSaidasDrill(null);
  }, [data?.year, data?.month]);

  const totals = data?.totals || {
    total: 0,
    pontuais: 0,
    atrasados: 0,
    atrasosIntertank: 0,
    atrasosCliente: 0,
    atrasosNaoInformado: 0,
    pontualidadePct: 0,
    atrasoPct: 0,
    intertankPctOfAtrasos: 0,
    clientePctOfAtrasos: 0,
    horasAtrasoTotal: 0,
    mediaMinutosAtraso: 0,
  };

  const responsibilityCards = useMemo(
    () =>
      (data?.responsibilityDistribution || []).filter(
        (d) => d.key === 'intertank' || d.key === 'cliente'
      ),
    [data?.responsibilityDistribution]
  );

  const pieData = useMemo(
    () => responsibilityCards.filter((d) => (d.value || 0) > 0),
    [responsibilityCards]
  );

  const motivosChartData = useMemo(() => {
    return (data?.motivosResumo || []).map((item) => {
      const label =
        item.motivo === 'SEM JUSTIFICATIVA INFORMADA'
          ? t('painel.dashboard.logistics.analysis.semJustificativa')
          : item.label || item.motivo;
      const short =
        label.length > 28 ? `${label.slice(0, 26)}…` : label;
      return {
        ...item,
        label,
        shortLabel: short,
        fill:
          item.intertank >= item.cliente && item.intertank >= item.nao_informado
            ? COLORS.intertank
            : item.cliente >= item.nao_informado
              ? COLORS.cliente
              : COLORS.naoInformado,
      };
    });
  }, [data?.motivosResumo, t]);

  const saidasDrillRows = useMemo(() => {
    if (!saidasDrill) return [];
    const rows = (data?.atrasos || []).filter((r) => {
      if (saidasDrill.type === 'motivo') return r.motivoKey === saidasDrill.key;
      return r.responsavel === saidasDrill.key;
    });
    return rows.flatMap((r) =>
      Array.isArray(r.saidas) && r.saidas.length > 0 ? r.saidas : [r]
    );
  }, [data?.atrasos, saidasDrill]);

  const motivosChartHeight = Math.max(220, motivosChartData.length * 42 + 48);

  const hasMonthly = (data?.monthly || []).some((m) => (m.total || 0) > 0);
  const hasAtrasosMensais = (data?.monthlyAtrasos || []).some((m) => (m.total || 0) > 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-card p-5">
        <p className="text-sm font-semibold text-destructive">
          {t('painel.dashboard.loadErrorTitle')}
        </p>
        <p className="text-sm text-muted-foreground mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3.5">
        <KpiCard
          title={t('painel.dashboard.logistics.kpis.total')}
          value={formatNum(totals.total, 0)}
          subtitle={t('painel.dashboard.logistics.kpis.totalHint')}
          icon={Truck}
          color={COLORS.total}
          tint="rgba(29, 78, 216, 0.08)"
          ring="rgba(29, 78, 216, 0.18)"
        />
        <KpiCard
          title={t('painel.dashboard.logistics.kpis.pontuais')}
          value={formatNum(totals.pontuais, 0)}
          subtitle={`${formatPercent(totals.pontualidadePct)}% ${t('painel.dashboard.logistics.kpis.ofTotal')}`}
          icon={CheckCircle2}
          color={COLORS.pontual}
          tint="rgba(5, 150, 105, 0.10)"
          ring="rgba(5, 150, 105, 0.20)"
        />
        <KpiCard
          title={t('painel.dashboard.logistics.kpis.atrasados')}
          value={formatNum(totals.atrasados, 0)}
          subtitle={`${formatPercent(totals.atrasoPct)}% ${t('painel.dashboard.logistics.kpis.ofTotal')}`}
          icon={AlertTriangle}
          color={COLORS.atraso}
          tint="rgba(220, 38, 38, 0.08)"
          ring="rgba(220, 38, 38, 0.18)"
        />
        <KpiCard
          title={t('painel.dashboard.logistics.kpis.intertank')}
          value={formatNum(totals.atrasosIntertank, 0)}
          subtitle={`${formatPercent(totals.intertankPctOfAtrasos)}% ${t('painel.dashboard.logistics.kpis.ofLate')}`}
          icon={Building2}
          color={COLORS.intertank}
          tint="rgba(245, 158, 11, 0.10)"
          ring="rgba(245, 158, 11, 0.20)"
        />
        <KpiCard
          title={t('painel.dashboard.logistics.kpis.cliente')}
          value={formatNum(totals.atrasosCliente, 0)}
          subtitle={`${formatPercent(totals.clientePctOfAtrasos)}% ${t('painel.dashboard.logistics.kpis.ofLate')}`}
          icon={UserRound}
          color={COLORS.cliente}
          tint="rgba(37, 99, 235, 0.09)"
          ring="rgba(37, 99, 235, 0.18)"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <MetricPill
          label={t('painel.dashboard.logistics.perf.pontualidade')}
          value={`${formatPercent(totals.pontualidadePct)}%`}
          tone="green"
        />
        <MetricPill
          label={t('painel.dashboard.logistics.perf.atrasos')}
          value={`${formatPercent(totals.atrasoPct)}%`}
          tone="red"
        />
        <MetricPill
          label={t('painel.dashboard.logistics.perf.intertank')}
          value={`${formatPercent(totals.intertankPctOfAtrasos)}%`}
          tone="amber"
        />
        <MetricPill
          label={t('painel.dashboard.logistics.perf.cliente')}
          value={`${formatPercent(totals.clientePctOfAtrasos)}%`}
          tone="blue"
        />
        <MetricPill
          label={t('painel.dashboard.logistics.perf.horasAtraso')}
          value={`${formatNum(totals.horasAtrasoTotal, 1)} h`}
          tone="slate"
        />
      </div>
      {totals.atrasados > 0 ? (
        <p className="text-xs text-muted-foreground -mt-3">
          {t('painel.dashboard.logistics.perf.mediaAtraso', {
            value: formatAtrasoDuration(totals.mediaMinutosAtraso),
          })}
        </p>
      ) : null}

      <ChartCard
        title={t('painel.dashboard.logistics.charts.monthly')}
        subtitle={t('painel.dashboard.logistics.charts.monthlyHint')}
      >
        {!hasMonthly ? (
          <p className="text-sm text-muted-foreground text-center py-16">
            {t('painel.dashboard.logistics.emptyYear')}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data.monthly} barGap={3} barCategoryGap="22%">
              <CartesianGrid vertical={false} strokeDasharray="4 6" stroke="hsl(var(--border))" />
              <XAxis dataKey="monthLabel" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={40} tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip
                cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload;
                  return (
                    <ChartTooltipBox
                      title={label}
                      rows={[
                        { label: t('painel.dashboard.logistics.charts.total'), value: row.total, color: COLORS.total },
                        { label: t('painel.dashboard.logistics.charts.dentro'), value: row.dentro, color: COLORS.pontual },
                        { label: t('painel.dashboard.logistics.charts.fora'), value: row.fora, color: COLORS.atraso },
                        { label: t('painel.dashboard.logistics.perf.pontualidade'), value: `${formatPercent(row.pontualidadePct)}%` },
                      ]}
                    />
                  );
                }}
              />
              <Legend
                formatter={(v) =>
                  v === 'dentro'
                    ? t('painel.dashboard.logistics.charts.dentro')
                    : t('painel.dashboard.logistics.charts.fora')
                }
              />
              <Bar dataKey="dentro" name="dentro" fill={COLORS.pontual} radius={[5, 5, 2, 2]} maxBarSize={28} />
              <Bar dataKey="fora" name="fora" fill={COLORS.atraso} radius={[5, 5, 2, 2]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <ChartCard title={t('painel.dashboard.logistics.charts.responsibility')}>
          {pieData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-16">
              {t('painel.dashboard.logistics.emptyLate')}
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div className="relative h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={68}
                      outerRadius={100}
                      paddingAngle={3}
                      stroke="hsl(var(--card))"
                      strokeWidth={3}
                      cursor="pointer"
                      onClick={(_, index) => {
                        const item = pieData[index];
                        if (!item?.key || !(item.value > 0)) return;
                        setSaidasDrill({
                          type: 'responsavel',
                          key: item.key,
                          title: item.name,
                        });
                      }}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.key} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const item = payload[0]?.payload;
                        return (
                          <ChartTooltipBox
                            title={item.name}
                            rows={[
                              { label: t('painel.dashboard.logistics.charts.count'), value: item.value, color: item.color },
                              { label: '%', value: `${formatPercent(item.percent)}%` },
                            ]}
                          />
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {t('painel.dashboard.logistics.charts.lateTotal')}
                  </span>
                  <span className="text-base font-bold tabular-nums">{totals.atrasados}</span>
                </div>
              </div>
              <div className="space-y-2.5">
                {responsibilityCards.map((item) => {
                  const active =
                    saidasDrill?.type === 'responsavel' &&
                    saidasDrill.key === item.key;
                  const clickable = (item.value || 0) > 0;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      disabled={!clickable}
                      onClick={() => {
                        if (!clickable) return;
                        setSaidasDrill({
                          type: 'responsavel',
                          key: item.key,
                          title: item.name,
                        });
                      }}
                      className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                        active
                          ? 'border-[#2575D1] bg-sky-50'
                          : clickable
                            ? 'border-border/70 bg-muted/25 hover:bg-muted/45 cursor-pointer'
                            : 'border-border/70 bg-muted/25 opacity-60 cursor-default'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: item.color }}
                          />
                          <span className="text-sm font-medium">{item.name}</span>
                        </div>
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          {formatPercent(item.percent)}%
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm font-semibold tabular-nums">
                        {item.value}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard
          title={t('painel.dashboard.logistics.charts.atrasosMensais')}
          subtitle={t('painel.dashboard.logistics.charts.atrasosMensaisHint')}
        >
          {!hasAtrasosMensais ? (
            <p className="text-sm text-muted-foreground text-center py-16">
              {t('painel.dashboard.logistics.emptyLate')}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.monthlyAtrasos} barGap={3} barCategoryGap="22%">
                <CartesianGrid vertical={false} strokeDasharray="4 6" stroke="hsl(var(--border))" />
                <XAxis dataKey="monthLabel" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={40} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip
                  cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload;
                    const total = row.total || 0;
                    const pctOf = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
                    return (
                      <ChartTooltipBox
                        title={label}
                        rows={[
                          { label: t('painel.dashboard.logistics.charts.lateTotal'), value: total },
                          { label: 'Intertank', value: `${row.intertank} (${formatPercent(pctOf(row.intertank))}%)`, color: COLORS.intertank },
                          { label: t('painel.dashboard.logistics.kpis.clienteShort'), value: `${row.cliente} (${formatPercent(pctOf(row.cliente))}%)`, color: COLORS.cliente },
                        ]}
                      />
                    );
                  }}
                />
                <Legend />
                <Bar dataKey="intertank" name="Intertank" fill={COLORS.intertank} radius={[5, 5, 2, 2]} maxBarSize={28} />
                <Bar dataKey="cliente" name={t('painel.dashboard.logistics.kpis.clienteShort')} fill={COLORS.cliente} radius={[5, 5, 2, 2]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <section className="rounded-2xl border border-border/80 bg-card shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Timer className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">
              {t('painel.dashboard.logistics.analysis.title')}
            </h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t('painel.dashboard.logistics.analysis.subtitle')}
          </p>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <div className="flex items-end justify-between gap-3 mb-2">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('painel.dashboard.logistics.analysis.motivosTitle')}
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t('painel.dashboard.logistics.analysis.motivosChartHint')}
                </p>
              </div>
            </div>
            {motivosChartData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t('painel.dashboard.logistics.emptyLate')}
              </p>
            ) : (
              <div className="rounded-xl border border-border/70 bg-muted/10 px-2 py-3">
                <ResponsiveContainer width="100%" height={motivosChartHeight}>
                  <BarChart
                    data={motivosChartData}
                    layout="vertical"
                    margin={{ top: 4, right: 28, left: 4, bottom: 4 }}
                    barCategoryGap="28%"
                  >
                    <CartesianGrid
                      horizontal={false}
                      strokeDasharray="4 6"
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                    />
                    <YAxis
                      type="category"
                      dataKey="shortLabel"
                      width={168}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(148,163,184,0.10)' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const item = payload[0]?.payload;
                        return (
                          <ChartTooltipBox
                            title={item.label}
                            rows={[
                              {
                                label: t('painel.dashboard.logistics.charts.count'),
                                value: item.count,
                                color: item.fill,
                              },
                              {
                                label: '%',
                                value: `${formatPercent(item.percent)}%`,
                              },
                            ]}
                          />
                        );
                      }}
                    />
                    <Bar
                      dataKey="count"
                      name="count"
                      radius={[0, 6, 6, 0]}
                      barSize={18}
                      cursor="pointer"
                      onClick={(entry) => {
                        const item = entry?.motivo ? entry : entry?.payload;
                        if (!item?.motivo) return;
                        setSaidasDrill({
                          type: 'motivo',
                          key: item.motivo,
                          title:
                            item.motivo === 'SEM JUSTIFICATIVA INFORMADA'
                              ? t('painel.dashboard.logistics.analysis.semJustificativa')
                              : item.label || item.motivo,
                        });
                      }}
                    >
                      {motivosChartData.map((entry) => (
                        <Cell
                          key={entry.motivo}
                          fill={
                            saidasDrill?.type === 'motivo' &&
                            saidasDrill.key === entry.motivo
                              ? COLORS.total
                              : entry.fill
                          }
                        />
                      ))}
                      <LabelList
                        dataKey="count"
                        position="right"
                        style={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </section>

      <Dialog
        open={Boolean(saidasDrill)}
        onOpenChange={(open) => {
          if (!open) setSaidasDrill(null);
        }}
      >
        <DialogContent className="flex max-h-[90vh] w-[min(960px,calc(100vw-1.5rem))] max-w-4xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="space-y-1 border-b border-border px-6 py-4 text-left">
            <DialogTitle>
              {saidasDrill?.type === 'responsavel'
                ? t('painel.dashboard.logistics.analysis.modalResponsavelTitle')
                : t('painel.dashboard.logistics.analysis.modalTitle')}
            </DialogTitle>
            <DialogDescription>
              {saidasDrill?.title}
              {saidasDrillRows.length > 0
                ? ` · ${saidasDrillRows.length} ${t('painel.dashboard.logistics.analysis.modalCount')}`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
            <div className="overflow-x-auto rounded-xl border border-border/70">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 sticky top-0">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2.5 font-semibold">
                      {t('painel.dashboard.logistics.table.saida')}
                    </th>
                    <th className="px-3 py-2.5 font-semibold">
                      {t('painel.dashboard.logistics.table.data')}
                    </th>
                    <th className="px-3 py-2.5 font-semibold">
                      {t('painel.dashboard.logistics.table.cliente')}
                    </th>
                    <th className="px-3 py-2.5 font-semibold">
                      {t('painel.dashboard.logistics.table.agendamento')}
                    </th>
                    <th className="px-3 py-2.5 font-semibold">
                      {t('painel.dashboard.logistics.table.real')}
                    </th>
                    <th className="px-3 py-2.5 font-semibold">
                      {t('painel.dashboard.logistics.table.atraso')}
                    </th>
                    <th className="px-3 py-2.5 font-semibold">
                      {t('painel.dashboard.logistics.table.operador')}
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-right">
                      {t('painel.dashboard.logistics.table.acoes')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {saidasDrillRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-10 text-center text-muted-foreground"
                      >
                        {t('painel.dashboard.logistics.emptyLate')}
                      </td>
                    </tr>
                  ) : (
                    saidasDrillRows.map((row) => {
                      const saidaCode = String(row.saidaCodigo || '').trim();
                      const canNavigate =
                        canOpenCarregamentos &&
                        Boolean(saidaCode) &&
                        saidaCode !== '—';
                      return (
                        <tr key={row.id} className="border-t border-border/60">
                          <td className="px-3 py-2.5 whitespace-nowrap font-medium tabular-nums">
                            {row.saidaCodigo || '—'}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                            {row.dataLabel}
                          </td>
                          <td
                            className="px-3 py-2.5 max-w-[180px] truncate"
                            title={row.cliente}
                          >
                            {row.cliente}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {row.horarioAgendado}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {row.horarioReal}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap font-medium text-red-700">
                            {row.atrasoLabel}
                          </td>
                          <td
                            className="px-3 py-2.5 max-w-[160px] truncate"
                            title={row.operador}
                          >
                            {row.operador || '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <RowActionButton
                              disabled={!canNavigate}
                              title={
                                canNavigate
                                  ? t('painel.dashboard.logistics.analysis.openCarregamento')
                                  : canOpenCarregamentos
                                    ? t('painel.dashboard.logistics.analysis.openCarregamentoMissing')
                                    : t('painel.dashboard.logistics.analysis.openCarregamentoDenied')
                              }
                              onClick={() => openCarregamentoSaida(saidaCode)}
                            >
                              <ExternalLink />
                            </RowActionButton>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
