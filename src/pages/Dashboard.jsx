import React, { useMemo } from 'react';
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
import {
  computeExecutiveKpis,
  buildMonthlySeries,
  buildProductDistribution,
  buildClientVolumeRevenueSeries,
  buildProducoesFilterUrl,
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

  const now = useMemo(() => moment(), []);
  const canNavigate = canAccessRoute(user, '/producoes');

  const fmtVol = (n) => fmtNumber(n || 0, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, i18n.language);

  const kpis = useMemo(() => computeExecutiveKpis(productions, now.toDate()), [productions, now]);
  const monthlyData = useMemo(
    () => buildMonthlySeries(productions, now.year(), now.toDate(), i18n.language),
    [productions, now, i18n.language],
  );
  const distribution = useMemo(
    () => buildProductDistribution(productions, now.toDate()),
    [productions, now],
  );
  const clientVolumeRevenue = useMemo(
    () => buildClientVolumeRevenueSeries(productions, { year: now.year(), referenceDate: now.toDate() }),
    [productions, now],
  );

  const navigateToProducoes = (product) => {
    if (!canNavigate) return;
    navigate(buildProducoesFilterUrl({ product, referenceDate: now.toDate() }));
  };

  const getComparison = (change) => (change == null ? null : change);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" />
      </div>
    );
  }

  const subtitleDate = fmtDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric' }, i18n.language);
  const hasMonthlyData = monthlyData.some((m) => m.volume > 0 || m.revenue > 0);
  const emptyMessage = t('dashboard.empty');

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('dashboard.subtitleProduction', { date: subtitleDate })}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <ExecutiveKpiCard
          title={t('dashboard.stats.volumeProducedMonth')}
          value={kpis.hasCurrentData ? `${fmtVol(kpis.volumeCurrent)} L` : '-'}
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
          value={kpis.avgPriceCurrent != null
            ? `${fmtCurrency(kpis.avgPriceCurrent, 'BRL', i18n.language)}/${t('common.units.kg')}`
            : '-'}
          comparison={kpis.avgPriceCurrent != null ? getComparison(kpis.avgPriceChange) : undefined}
          comparisonLabel={kpis.avgPriceCurrent != null && kpis.avgPriceChange != null ? t('dashboard.stats.vsPreviousMonth') : undefined}
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

      <ChartCard title={t('dashboard.charts.volumeRevenueByClient')} className="mb-6">
        <ClientVolumeRevenueChart
          data={clientVolumeRevenue}
          user={user}
          emptyMessage={emptyMessage}
        />
      </ChartCard>

      <ProductDistributionSection
        title={t('dashboard.charts.productDistribution')}
        items={distribution.items}
        total={distribution.total}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}
