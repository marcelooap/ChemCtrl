import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext } from 'react-router-dom';
import {
  BarChart3, DollarSign, Factory, Shield, Clock, TrendingUp,
  Package, CheckCircle2, XCircle, AlertCircle, Eye, EyeOff
} from 'lucide-react';
import moment from 'moment';
import { fmtDate, fmtNumber, fmtCurrency } from '@/i18n/formatters';
import { translateProductionStatus, translateQcStatus } from '@/i18n/domainMaps';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

const COLORS = {
  blue: '#2563eb',
  green: '#00875a',
  amber: '#f59e0b',
  red: '#dc2626',
  purple: '#7c3aed',
  cyan: '#0891b2',
  gray: '#6b7280',
};

const QC_COLORS = ['#00875a', '#dc2626', '#f59e0b'];
const STATUS_COLORS = ['#6b7280', '#2563eb', '#7c3aed', '#f59e0b', '#00875a', '#dc2626'];

function KPICard({ title, value, subtitle, icon: Icon, color, footer }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</p>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: color }}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {subtitle && <p className="text-xs mt-1 text-gray-500">{subtitle}</p>}
      {footer && <p className="text-xs mt-2 pt-2 border-t border-border" style={{ color }}>{footer}</p>}
    </div>
  );
}

function ChartCard({ title, children, className }) {
  return (
    <div className={`bg-card rounded-xl border border-border p-5 ${className || ''}`}>
      <h3 className="text-sm font-semibold mb-4">{title}</h3>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { user } = useOutletContext();
  const { data: productions, loading } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 500));
  const { data: orders } = useRealtimeEntity('Order', () => base44.entities.Order.list('-created_date', 500));
  const { data: qualityResults } = useRealtimeEntity('QualityResult', () => base44.entities.QualityResult.list('-created_date', 500));

  const [hideRevenue, setHideRevenue] = useState(false);
  const now = useMemo(() => moment(), []);

  const fmtVol = (n) => fmtNumber(n || 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const fmtDuration = (ms) => {
    if (!ms || ms < 0) return '—';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return t('common.duration.hoursMinutes', { hours: h, minutes: m });
    return t('common.duration.minutesOnly', { minutes: m });
  };

  const metrics = useMemo(() => {
    const startOfMonth = now.clone().startOf('month');
    const finishedThisMonth = productions.filter(p => {
      if (p.status !== 'Finalizado') return false;
      const finishDate = p.end_time || p.updated_date;
      return finishDate && moment(finishDate).isSameOrAfter(startOfMonth);
    });
    const finishedAll = productions.filter(p => p.status === 'Finalizado');
    const inProgress = productions.filter(p => !['Finalizado', 'Cancelado'].includes(p.status));
    const cancelled = productions.filter(p => p.status === 'Cancelado');

    const totalVolumeMonth = finishedThisMonth.reduce((s, p) => s + (p.volume || 0), 0);
    const totalVolumeAll = finishedAll.reduce((s, p) => s + (p.volume || 0), 0);
    const revenueMonth = finishedThisMonth.reduce((s, p) => s + ((p.mass || 0) * (p.unit_price || 0)), 0);
    const revenueAll = finishedAll.reduce((s, p) => s + ((p.mass || 0) * (p.unit_price || 0)), 0);

    const approved = qualityResults.filter(q => q.status === 'Aprovado');
    const reproved = qualityResults.filter(q => q.status === 'Reprovado');
    const restricted = qualityResults.filter(q => q.status === 'Com Restrição');
    const pending = qualityResults.filter(q => q.status === 'Pendente');
    const totalQC = qualityResults.length;
    const approvalRate = totalQC > 0 ? (approved.length / totalQC * 100) : 0;

    const finishedWithTime = finishedAll.filter(p => p.start_time && p.end_time);
    const avgProdMs = finishedWithTime.length > 0
      ? finishedWithTime.reduce((s, p) => {
          const ms = new Date(p.end_time).getTime() - new Date(p.start_time).getTime() - (p.total_pause_ms || 0);
          return s + (ms > 0 ? ms : 0);
        }, 0) / finishedWithTime.length
      : 0;

    const openOrders = orders.filter(o => o.status !== 'Finalizado');
    const openVolume = openOrders.reduce((s, o) => s + (o.volume_pending || 0), 0);

    return {
      totalVolumeMonth, totalVolumeAll, revenueMonth, revenueAll,
      finishedThisMonth: finishedThisMonth.length, finishedAll: finishedAll.length,
      inProgress: inProgress.length, cancelled: cancelled.length,
      approved: approved.length, reproved: reproved.length, restricted: restricted.length,
      pending: pending.length, approvalRate,
      avgProdMs, openOrders: openOrders.length, openVolume,
    };
  }, [productions, orders, qualityResults, now]);

  const monthlyData = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const m = now.clone().subtract(i, 'months');
      const label = m.format('MMM/YYYY');
      const monthProds = productions.filter(p => {
        if (p.status !== 'Finalizado') return false;
        const finishDate = p.end_time || p.updated_date;
        return finishDate && moment(finishDate).isSame(m, 'month') && moment(finishDate).isSame(m, 'year');
      });
      const volume = monthProds.reduce((s, p) => s + (p.volume || 0), 0);
      const revenue = monthProds.reduce((s, p) => s + ((p.mass || 0) * (p.unit_price || 0)), 0);
      months.push({ month: label, volume: Math.round(volume), revenue: Math.round(revenue) });
    }
    return months;
  }, [productions, now]);

  const statusData = useMemo(() => {
    const statuses = ['Aguardando Início', 'Em Produção', 'Qualidade', 'Envase', 'Finalizado', 'Cancelado'];
    return statuses.map(s => ({
      name: translateProductionStatus(s),
      quantidade: productions.filter(p => p.status === s).length,
    })).filter(d => d.quantidade > 0);
  }, [productions, t]);

  const qcData = useMemo(() => {
    const data = [];
    if (metrics.approved > 0) data.push({ name: translateQcStatus('Aprovado'), value: metrics.approved });
    if (metrics.reproved > 0) data.push({ name: translateQcStatus('Reprovado'), value: metrics.reproved });
    if (metrics.restricted > 0) data.push({ name: translateQcStatus('Com Restrição'), value: metrics.restricted });
    if (metrics.pending > 0) data.push({ name: translateQcStatus('Pendente'), value: metrics.pending });
    return data;
  }, [metrics, t]);

  const topProducts = useMemo(() => {
    const productMap = {};
    productions.filter(p => p.status === 'Finalizado').forEach(p => {
      const key = p.product || '—';
      if (!productMap[key]) productMap[key] = { volume: 0, count: 0 };
      productMap[key].volume += (p.volume || 0);
      productMap[key].count += 1;
    });
    return Object.entries(productMap)
      .map(([name, d]) => ({ name: name.substring(0, 20), volume: Math.round(d.volume), count: d.count }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);
  }, [productions]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>;

  const subtitleDate = fmtDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('dashboard.subtitleProduction', { date: subtitleDate })}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title={t('dashboard.stats.volumeMonth')}
          value={`${fmtVol(metrics.totalVolumeMonth)} L`}
          subtitle={t('dashboard.stats.finishedOps', { count: metrics.finishedThisMonth })}
          icon={BarChart3}
          color={COLORS.blue}
          footer={t('dashboard.stats.totalGeneral', { volume: fmtVol(metrics.totalVolumeAll) })}
        />
        <div className="bg-card rounded-xl border border-border p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('dashboard.stats.revenueGeneratedMonth')}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setHideRevenue(h => !h)}
                className="w-9 h-9 rounded-lg flex items-center justify-center bg-muted hover:bg-gray-200 text-gray-600 hover:text-gray-800 cursor-pointer"
                title={hideRevenue ? t('dashboard.stats.showRevenue') : t('dashboard.stats.hideRevenue')}
              >
                {hideRevenue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: COLORS.green }}>
                <DollarSign className="w-4 h-4 text-white" />
              </div>
            </div>
          </div>
          <p className="text-2xl font-bold tracking-wider">{hideRevenue ? '••••••' : fmtCurrency(metrics.revenueMonth)}</p>
          <p className="text-xs mt-1 text-gray-500">{hideRevenue ? t('dashboard.stats.hiddenValue') : t('dashboard.stats.revenueRealized')}</p>
          <p className="text-xs mt-2 pt-2 border-t border-border" style={{ color: COLORS.green }}>{hideRevenue ? '••••••' : t('dashboard.stats.revenueTotalProvisioned', { amount: fmtCurrency(metrics.revenueAll) })}</p>
        </div>
        <KPICard
          title={t('dashboard.stats.activeProductions')}
          value={metrics.inProgress}
          subtitle={t('dashboard.stats.opsInProgress')}
          icon={Factory}
          color={COLORS.amber}
          footer={t('dashboard.stats.cancelledCount', { count: metrics.cancelled })}
        />
        <KPICard
          title={t('dashboard.stats.openOrders')}
          value={metrics.openOrders}
          subtitle={t('dashboard.stats.pendingVolume', { volume: fmtVol(metrics.openVolume) })}
          icon={Package}
          color={COLORS.purple}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title={t('dashboard.stats.approvalRate')}
          value={`${metrics.approvalRate.toFixed(1)}%`}
          subtitle={t('dashboard.stats.approvedOf', { approved: metrics.approved, total: metrics.approved + metrics.reproved + metrics.restricted })}
          icon={Shield}
          color={COLORS.green}
        />
        <KPICard
          title={t('dashboard.stats.reprovedQc')}
          value={metrics.reproved}
          subtitle={metrics.restricted > 0 ? t('dashboard.stats.withRestriction', { count: metrics.restricted }) : t('dashboard.stats.noRestrictions')}
          icon={XCircle}
          color={COLORS.red}
        />
        <KPICard
          title={t('dashboard.stats.pendingQc')}
          value={metrics.pending}
          subtitle={t('dashboard.stats.awaitingAnalysis')}
          icon={AlertCircle}
          color={COLORS.amber}
        />
        <KPICard
          title={t('dashboard.stats.avgProductionTime')}
          value={fmtDuration(metrics.avgProdMs)}
          subtitle={t('dashboard.stats.completedOps', { count: metrics.finishedAll })}
          icon={Clock}
          color={COLORS.cyan}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ChartCard title={t('dashboard.charts.volumeByMonth')}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <Tooltip />
              <Bar dataKey="volume" fill={COLORS.blue} radius={[4, 4, 0, 0]} name={t('dashboard.charts.volumeLabel')} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={t('dashboard.charts.revenueByMonth')}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <Tooltip formatter={(v) => fmtCurrency(v)} />
              <Line type="monotone" dataKey="revenue" stroke={COLORS.green} strokeWidth={2.5} dot={{ r: 4 }} name={t('dashboard.charts.revenueLabel')} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ChartCard title={t('dashboard.charts.productionsByStatus')}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={statusData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} stroke="#9ca3af" width={100} />
              <Tooltip />
              <Bar dataKey="quantidade" radius={[0, 4, 4, 0]} name={t('dashboard.charts.quantityLabel')}>
                {statusData.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={t('dashboard.charts.qcDistribution')}>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={qcData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                {qcData.map((_, i) => <Cell key={i} fill={QC_COLORS[i % QC_COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <ChartCard title={t('dashboard.charts.topProducts')}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topProducts}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <Tooltip />
              <Bar dataKey="volume" fill={COLORS.cyan} radius={[4, 4, 0, 0]} name={t('dashboard.charts.volumeLabel')} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
