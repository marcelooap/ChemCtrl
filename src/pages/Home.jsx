import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { BarChart3, DollarSign, ClipboardList, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import moment from 'moment';
import { fmtDate, fmtVolume, fmtCurrency, fmtNumber } from '@/i18n/formatters';
import ProductionTrackingTable from '@/components/production/ProductionTrackingTable';

const StatCard = ({ title, value, valueColor, subtitle, subtitleColor, icon: Icon, iconBg, footer, accentBorder, showEye, hidden, onToggleEye, alert, showLabel, hideLabel }) => (
  <div className="bg-card rounded-xl border border-border overflow-hidden flex flex-col" style={{ borderBottom: accentBorder ? `3px solid ${accentBorder}` : undefined }}>
    <div className="p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
        <div className="flex items-center gap-2">
          {showEye && (
            <button
              type="button"
              onClick={onToggleEye}
              className="w-8 h-8 rounded-lg flex items-center justify-center bg-muted hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
              title={hidden ? showLabel : hideLabel}
            >
              {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: iconBg }}>
            <Icon className="w-4 h-4 text-white" />
          </div>
        </div>
      </div>
      <p className="text-3xl font-bold text-foreground" style={valueColor ? { color: valueColor } : undefined}>{hidden ? '••••••' : value}</p>
      {subtitle && <p className="text-xs mt-1 text-muted-foreground" style={subtitleColor ? { color: subtitleColor } : undefined}>{subtitle}</p>}
    </div>
    {footer && (
      <>
        <div className="border-t border-border" />
        <div className="px-5 py-3 flex flex-col gap-0.5">
          {footer.map((f, i) => (
            <p key={i} className={`text-xs ${f.color ? '' : 'text-muted-foreground'}`} style={f.color ? { color: f.color } : undefined}>{f.text}</p>
          ))}
        </div>
      </>
    )}
    {alert && (
      <div className="px-5 py-2.5 flex items-center gap-2 bg-red-50 dark:bg-red-950/40">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-700 dark:text-red-400" />
        <p className="text-xs font-medium text-red-700 dark:text-red-400">{alert}</p>
      </div>
    )}
  </div>
);

export default function Home() {
  const { t } = useTranslation();
  const { user } = useOutletContext();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: productions, loading, reload: load } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 200));
  const { data: orders } = useRealtimeEntity('Order', () => base44.entities.Order.list('-created_date', 200));
  const [bypassing, setBypassing] = useState(null);
  const [hideRevenue, setHideRevenue] = useState(true);
  const [hideVolume, setHideVolume] = useState(false);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>;

  const now = moment();
  const startOfMonth = now.clone().startOf('month');
  const finishedThisMonth = productions.filter(p => {
    if (p.status !== 'Finalizado') return false;
    const finishDate = p.end_time || p.updated_date;
    return finishDate && moment(finishDate).isSameOrAfter(startOfMonth);
  });
  const inProgressProds = productions.filter(p => !['Finalizado', 'Cancelado'].includes(p.status));
  const totalVolumeMonth = finishedThisMonth.reduce((s, p) => s + (p.volume || 0), 0);
  const inProgressVolume = inProgressProds.reduce((s, p) => s + (p.volume || 0), 0);
  const revenueMonth = finishedThisMonth.reduce((s, p) => s + ((p.mass || 0) * (p.unit_price || 0)), 0);
  const revenueInProcess = inProgressProds.reduce((s, p) => s + ((p.mass || 0) * (p.unit_price || 0)), 0);
  const openOrders = orders.filter(o => o.status !== 'Finalizado' && (o.volume_pending ?? 0) > 0);
  const openVolume = openOrders.reduce((s, o) => s + (o.volume_pending || 0), 0);
  // Atrasado só para pedidos sem OP aberta; Em produção prevalece
  const lateOrders = openOrders.filter(o =>
    o.status !== 'Em produção'
    && o.expected_date
    && moment(o.expected_date, 'YYYY-MM-DD').isBefore(now, 'day')
  );

  const handleBypass = async (p) => {
    setBypassing(p.id);
    try {
      if (p.bypass_qc) {
        await base44.entities.Production.update(p.id, { bypass_qc: false });
        toast({ title: t('dashboard.bypass.disabled', { op: p.op_number }) });
      } else {
        const updates = { bypass_qc: true };
        if (p.status === 'Qualidade') {
          updates.status = 'Envase';
        }
        await base44.entities.Production.update(p.id, updates);
        toast({ title: t('dashboard.bypass.enabled', { op: p.op_number }) });
      }
      load();
    } catch (err) {
      toast({ title: t('common.error'), description: err?.message, variant: 'destructive' });
    } finally {
      setBypassing(null);
    }
  };

  const subtitleDate = fmtDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('dashboard.homeTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('dashboard.subtitle', { date: subtitleDate })}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard title={t('dashboard.stats.volumeProducedMonth')} value={fmtVolume(totalVolumeMonth)}
          subtitle={t('dashboard.stats.finishedOps', { count: finishedThisMonth.length })} icon={BarChart3} iconBg="#1e56a0"
          showEye hidden={hideVolume} onToggleEye={() => setHideVolume(h => !h)}
          showLabel={t('common.show')} hideLabel={t('common.hide')}
          footer={[
            { text: hideVolume ? `+ ••••••` : t('dashboard.stats.inProgressVolume', { volume: fmtNumber(inProgressVolume, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }), color: '#1e56a0' },
            { text: hideVolume ? '••••••' : t('dashboard.stats.totalProvisioned', { volume: fmtNumber(totalVolumeMonth + inProgressVolume, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }), color: undefined },
          ]} />
        <StatCard title={t('dashboard.stats.revenueGeneratedMonth')} value={fmtCurrency(revenueMonth)} valueColor="#00875a"
          subtitle={t('dashboard.stats.revenueRealized')} icon={DollarSign} iconBg="#00875a" accentBorder="#00875a" showEye
          hidden={hideRevenue} onToggleEye={() => setHideRevenue(h => !h)}
          showLabel={t('common.show')} hideLabel={t('common.hide')}
          footer={[
            { text: hideRevenue ? `+ ••••••` : t('dashboard.stats.revenueInProduction', { amount: fmtCurrency(revenueInProcess) }), color: '#1e56a0' },
            { text: hideRevenue ? 'Total provisionado: ••••••' : t('dashboard.stats.revenueTotalProvisioned', { amount: fmtCurrency(revenueMonth + revenueInProcess) }), color: undefined },
          ]} />
        <StatCard title={t('dashboard.stats.openOrders')}
          value={<><span className="text-foreground">{openOrders.length}</span> <span className="text-muted-foreground">{t('dashboard.stats.ordersLabel')}</span></>}
          subtitle={t('dashboard.stats.pendingVolume', { volume: fmtNumber(openVolume, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })} subtitleColor="#f59e0b"
          icon={ClipboardList} iconBg="#f59e0b" accentBorder="#f59e0b"
          alert={lateOrders.length > 0 ? t('dashboard.stats.lateOrders', { count: lateOrders.length, volume: fmtNumber(lateOrders.reduce((s, o) => s + (o.volume_pending || 0), 0), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : null} />
      </div>

      <div className="bg-card rounded-xl border border-border">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{t('dashboard.stats.productionsInProgress')}</h3>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{inProgressProds.length}</span>
          </div>
        </div>
        <ProductionTrackingTable
          productions={inProgressProds}
          onBypass={handleBypass}
          bypassing={bypassing}
          onViewAll={() => navigate('/ordens')}
        />
      </div>
    </div>
  );
}
