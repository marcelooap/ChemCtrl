import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext } from 'react-router-dom';
import { BarChart3, DollarSign, Trophy, Scale } from 'lucide-react';
import moment from 'moment';
import { fmtDate, fmtNumber, fmtCurrency } from '@/i18n/formatters';
import {
  ComposedChart, Bar, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import ExecutiveKpiCard from '@/components/dashboard/ExecutiveKpiCard';
import ProductDistributionSection from '@/components/dashboard/ProductDistributionSection';
import ClientVolumeRevenueChart from '@/components/dashboard/ClientVolumeRevenueChart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  computeExecutiveKpis,
  buildMonthlySeries,
  buildProductDistribution,
  buildClientVolumeRevenueSeries,
  buildProducoesFilterUrl,
  getFinishDate,
} from '@/lib/dashboardMetrics';
import { canAccessRoute } from '@/lib/permissions';

const COLORS = {
  blue: '#2563eb',
  blueCurrent: '#1d4ed8',
  green: '#00875a',
  amber: '#f59e0b',
  purple: '#7c3aed',
  gray: '#9ca3af',
};

const MONTH_KEYS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function ChartCard({ title, children, className }) {
  return (
    <div className={`bg-card rounded-xl border border-border p-5 ${className || ''}`}>
      <h3 className="text-sm font-semibold mb-4">{title}</h3>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useOutletContext();
  const { data: productions, loading } = useRealtimeEntity(
    'Production',
    () => base44.entities.Production.list('-created_date', 2000),
  );

  const today = useMemo(() => moment(), []);
  const [selectedMonth, setSelectedMonth] = useState(today.month());
  const [selectedYear, setSelectedYear] = useState(today.year());

  const referenceDate = useMemo(() => {
    const isCurrentPeriod = selectedMonth === today.month() && selectedYear === today.year();
    if (isCurrentPeriod) return today.clone().toDate();
    return moment({ year: selectedYear, month: selectedMonth, day: 15 }).toDate();
  }, [selectedMonth, selectedYear, today]);

  const yearOptions = useMemo(() => {
    const years = new Set([today.year(), selectedYear]);
    for (let y = today.year(); y >= today.year() - 5; y -= 1) years.add(y);
    productions.forEach((p) => {
      const finishDate = getFinishDate(p);
      if (finishDate) years.add(moment(finishDate).year());
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [productions, today, selectedYear]);

  const canNavigate = canAccessRoute(user, '/producoes');

  const fmtVol = (n) => fmtNumber(n || 0, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, i18n.language);

  const kpis = useMemo(() => computeExecutiveKpis(productions, referenceDate), [productions, referenceDate]);
  const monthlyData = useMemo(
    () => buildMonthlySeries(productions, selectedYear, referenceDate, i18n.language),
    [productions, selectedYear, referenceDate, i18n.language],
  );
  const distribution = useMemo(
    () => buildProductDistribution(productions, referenceDate, {
      year: selectedYear,
      month: selectedMonth,
    }),
    [productions, referenceDate, selectedYear, selectedMonth],
  );
  const clientVolumeRevenue = useMemo(
    () => buildClientVolumeRevenueSeries(productions, {
      year: selectedYear,
      month: selectedMonth,
      referenceDate,
    }),
    [productions, selectedYear, selectedMonth, referenceDate],
  );

  const navigateToProducoes = (product) => {
    if (!canNavigate) return;
    navigate(buildProducoesFilterUrl({ product, referenceDate }));
  };

  const getComparison = (change) => (change == null ? null : change);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" />
      </div>
    );
  }

  const isCurrentPeriod = selectedMonth === today.month() && selectedYear === today.year();
  const subtitleDate = isCurrentPeriod
    ? fmtDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric' }, i18n.language)
    : fmtDate(referenceDate, { month: 'long', year: 'numeric' }, i18n.language);
  const hasMonthlyData = monthlyData.some((m) => m.volume > 0 || m.revenue > 0 || m.avgPricePerKg > 0);
  const emptyMessage = t('dashboard.empty');
  const fmtAvgPrice = (n) => fmtCurrency(n || 0, 'BRL', i18n.language, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('dashboard.subtitleProduction', { date: subtitleDate })}</p>
        </div>
        <div className="bg-card rounded-xl shadow-sm border border-border px-3 py-2 flex items-end gap-2 flex-wrap">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('dashboard.filters.month')}</label>
            <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
              <SelectTrigger className="h-8 text-xs mt-0.5 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_KEYS.map((key, index) => (
                  <SelectItem key={key} value={String(index)} className="text-xs">
                    {t(`common.months.${key}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('dashboard.filters.year')}</label>
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="h-8 text-xs mt-0.5 w-[100px]">
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
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <ExecutiveKpiCard
          title={t('dashboard.stats.volumeProducedMonth')}
          value={kpis.hasCurrentData ? `${fmtVol(kpis.volumeCurrent)} L` : '-'}
          subtitle={t('dashboard.stats.massProduced', {
            mass: fmtNumber(kpis.massCurrent || 0, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, i18n.language),
          })}
          comparison={kpis.hasCurrentData ? getComparison(kpis.volumeChange) : undefined}
          comparisonLabel={kpis.hasCurrentData && kpis.volumeChange != null ? t('dashboard.stats.vsPreviousMonth') : undefined}
          icon={BarChart3}
          color={COLORS.blue}
          clickable={canNavigate}
          onClick={() => navigateToProducoes()}
        />
        <ExecutiveKpiCard
          title={t('dashboard.stats.revenueMonth')}
          value={kpis.hasCurrentData ? fmtCurrency(kpis.revenueCurrent, 'BRL', i18n.language) : '-'}
          comparison={kpis.hasCurrentData ? getComparison(kpis.revenueChange) : undefined}
          comparisonLabel={kpis.hasCurrentData && kpis.revenueChange != null ? t('dashboard.stats.vsPreviousMonth') : undefined}
          icon={DollarSign}
          color={COLORS.green}
          clickable={canNavigate}
          onClick={() => navigateToProducoes()}
        />
        <ExecutiveKpiCard
          title={t('dashboard.stats.topProduct')}
          value={kpis.topProduct ? kpis.topProduct.name : '-'}
          subtitle={kpis.topProduct
            ? `${fmtVol(kpis.topProduct.volume)} L · ${t('dashboard.stats.topProductShare', { percent: kpis.topProduct.percent.toFixed(1) })}`
            : undefined}
          icon={Trophy}
          color={COLORS.amber}
          clickable={canNavigate && !!kpis.topProduct}
          onClick={() => kpis.topProduct && navigateToProducoes(kpis.topProduct.name)}
        />
        <ExecutiveKpiCard
          title={t('dashboard.stats.avgPricePerKg')}
          value={`${fmtCurrency(kpis.avgPriceCurrent, 'BRL', i18n.language, {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
          })}/${t('common.units.kg')}`}
          comparison={kpis.massCurrent > 0 ? getComparison(kpis.avgPriceChange) : undefined}
          comparisonLabel={kpis.massCurrent > 0 && kpis.avgPriceChange != null ? t('dashboard.stats.vsPreviousMonth') : undefined}
          icon={Scale}
          color={COLORS.purple}
          clickable={canNavigate}
          onClick={() => navigateToProducoes()}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ChartCard title={t('dashboard.charts.volumeByMonth')}>
          {!hasMonthlyData ? (
            <p className="text-sm text-muted-foreground text-center py-16">{emptyMessage}</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <Tooltip formatter={(v) => [`${fmtVol(v)} L`, t('dashboard.charts.volumeLabel')]} />
                <Bar dataKey="volume" name={t('dashboard.charts.volumeLabel')} radius={[4, 4, 0, 0]}>
                  {monthlyData.map((entry) => (
                    <Cell
                      key={entry.monthIndex}
                      fill={entry.isCurrent ? COLORS.blueCurrent : COLORS.blue}
                    />
                  ))}
                </Bar>
                <Line
                  type="monotone"
                  dataKey="volume"
                  stroke={COLORS.gray}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  name={t('dashboard.charts.trendLabel')}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title={t('dashboard.charts.revenueByMonth')}>
          {!hasMonthlyData ? (
            <p className="text-sm text-muted-foreground text-center py-16">{emptyMessage}</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={monthlyData}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <Tooltip formatter={(v) => [fmtCurrency(v, 'BRL', i18n.language), t('dashboard.charts.revenueLabel')]} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke={COLORS.purple}
                  strokeWidth={2.5}
                  fill="url(#revenueGradient)"
                  dot={{ r: 4, fill: COLORS.purple }}
                  name={t('dashboard.charts.revenueLabel')}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ChartCard title={t('dashboard.charts.volumeRevenueByClient')}>
          <ClientVolumeRevenueChart
            data={clientVolumeRevenue}
            user={user}
            emptyMessage={emptyMessage}
          />
        </ChartCard>

        <ChartCard title={t('dashboard.charts.avgPricePerKgByMonth')}>
          {!hasMonthlyData ? (
            <p className="text-sm text-muted-foreground text-center py-16">{emptyMessage}</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={monthlyData}>
                <defs>
                  <linearGradient id="avgPriceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.amber} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={COLORS.amber} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="#9ca3af"
                  tickFormatter={(v) => fmtAvgPrice(v)}
                />
                <Tooltip
                  formatter={(v) => [
                    `${fmtAvgPrice(v)}/${t('common.units.kg')}`,
                    t('dashboard.charts.avgPricePerKgLabel'),
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="avgPricePerKg"
                  stroke={COLORS.amber}
                  strokeWidth={2.5}
                  fill="url(#avgPriceGradient)"
                  dot={{ r: 4, fill: COLORS.amber }}
                  name={t('dashboard.charts.avgPricePerKgLabel')}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <ProductDistributionSection
        key={`product-dist-${selectedYear}-${selectedMonth}`}
        title={t('dashboard.charts.productDistribution')}
        items={distribution.items}
        total={distribution.total}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}
