import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@chemblend/api/base44Client';
import { useRealtimeEntity } from '@chemblend/hooks/useRealtimeEntity';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { BarChart3, DollarSign, ClipboardList, Eye, EyeOff, AlertTriangle, ExternalLink } from 'lucide-react';
import { useToast } from '@shared/components/ui/use-toast';
import moment from 'moment';
import { fmtDate, fmtVolume, fmtCurrency, fmtNumber, getIntlLocale } from '@/i18n/formatters';
import { calcPriceWithoutTax } from '@chemblend/lib/recipePricing';
import ProductionTrackingTable from '@chemblend/components/production/ProductionTrackingTable';
import {
  isContainerFractional,
  productionOfContainer,
  containerDisplayVolume,
} from '@chemblend/lib/fractionalSupply';

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
  const { data: containers } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const { data: transfers } = useRealtimeEntity('Transfer', () => base44.entities.Transfer.list('-created_date', 500));
  const { data: stocks } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 500));
  const [bypassing, setBypassing] = useState(null);
  const [hideRevenue, setHideRevenue] = useState(true);
  const [hideVolume, setHideVolume] = useState(false);

  const fractionalYard = useMemo(() => {
    return (containers || []).filter((c) => {
      if ((c.status || 'No Pátio') !== 'No Pátio') return false;
      const prod = productionOfContainer(c, productions || []);
      return isContainerFractional(c, prod, transfers || []);
    });
  }, [containers, productions, transfers]);

  const stocksWmsNok = useMemo(
    () => (stocks || []).filter((s) => !s.status_wms),
    [stocks]
  );

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
  const revenueMonthWithoutTax = calcPriceWithoutTax(revenueMonth);
  const revenueInProcess = inProgressProds.reduce((s, p) => s + ((p.mass || 0) * (p.unit_price || 0)), 0);
  const openOrders = orders.filter(o => o.status !== 'Finalizado' && (o.volume_pending ?? 0) > 0);
  const openVolume = openOrders.reduce((s, o) => s + (o.volume_pending || 0), 0);
  // Atrasado só para pedidos sem OP aberta; Em produção prevalece
  const lateOrders = openOrders.filter(o =>
    o.status !== 'Em produção'
    && o.expected_date
    && moment(o.expected_date, 'YYYY-MM-DD').isBefore(now, 'day')
  );

  // Semana operacional: segunda a sábado (domingo pertence à semana que termina no sábado anterior)
  const weekStart = now.clone().startOf('isoWeek');
  const weekEnd = weekStart.clone().add(5, 'days').endOf('day');
  const getFinishDate = (p) => p.end_time || p.updated_date;
  const finishedThisWeek = productions.filter(p => {
    if (p.status !== 'Finalizado') return false;
    const finishDate = getFinishDate(p);
    return finishDate && moment(finishDate).isBetween(weekStart, weekEnd, undefined, '[]');
  });
  const weekVolume = finishedThisWeek.reduce((s, p) => s + (p.volume || 0), 0);
  const weekVolumeByDay = Array.from({ length: 6 }, (_, offset) => {
    const day = weekStart.clone().add(offset, 'days');
    const label = day.toDate().toLocaleDateString(getIntlLocale(), { weekday: 'short' });
    const volume = finishedThisWeek
      .filter(p => moment(getFinishDate(p)).isSame(day, 'day'))
      .reduce((s, p) => s + (p.volume || 0), 0);
    return { label: label.charAt(0).toUpperCase() + label.slice(1), volume };
  });

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
    <div className="pb-4">
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
          subtitle={hideRevenue ? '••••••' : t('dashboard.stats.revenueWithoutTax', { amount: fmtCurrency(revenueMonthWithoutTax) })}
          icon={DollarSign} iconBg="#00875a" accentBorder="#00875a" showEye
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
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold">{t('dashboard.stats.productionsInProgress')}</h3>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{inProgressProds.length}</span>
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-primary/10 text-primary"
                title={t('dashboard.stats.producedThisWeek')}
              >
                {fmtVolume(weekVolume)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('dashboard.stats.weekPeriod', { start: fmtDate(weekStart.toDate()), end: fmtDate(weekEnd.toDate()) })}
            </p>
          </div>
          <div className="flex items-start gap-1.5 sm:gap-2 shrink-0 overflow-x-auto">
            {weekVolumeByDay.map((day) => (
              <div key={day.label} className="flex flex-col items-center gap-1 min-w-[3.25rem]">
                <span className="inline-flex items-center justify-center w-full px-2 py-0.5 rounded-md text-[11px] font-semibold bg-orange-100 text-orange-800">
                  {day.label}
                </span>
                <span className="inline-flex items-center justify-center w-full px-2 py-0.5 rounded-md text-[11px] font-semibold bg-primary/10 text-primary tabular-nums">
                  {fmtVolume(day.volume)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <ProductionTrackingTable
          productions={inProgressProds}
          onBypass={handleBypass}
          bypassing={bypassing}
          onViewAll={() => navigate('/ordens')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        {/* Tanques fracionados no pátio */}
        <div className="bg-card rounded-xl border border-border flex flex-col min-h-0">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
            <div>
              <h3 className="text-sm font-semibold">{t('dashboard.fractionalYard.title')}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{t('dashboard.fractionalYard.subtitle')}</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-100 text-blue-800">
              {fractionalYard.length}
            </span>
          </div>
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                  <th className="px-4 py-3 font-medium">{t('dashboard.fractionalYard.columns.id')}</th>
                  <th className="px-4 py-3 font-medium">{t('dashboard.fractionalYard.columns.packaging')}</th>
                  <th className="px-4 py-3 font-medium">{t('dashboard.fractionalYard.columns.product')}</th>
                  <th className="px-4 py-3 font-medium">{t('dashboard.fractionalYard.columns.client')}</th>
                  <th className="px-4 py-3 font-medium">{t('dashboard.fractionalYard.columns.lot')}</th>
                  <th className="px-4 py-3 font-medium">{t('dashboard.fractionalYard.columns.volume')}</th>
                  <th className="px-4 py-3 font-medium text-center">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {fractionalYard.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      {t('dashboard.fractionalYard.empty')}
                    </td>
                  </tr>
                ) : (
                  fractionalYard.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 font-medium text-primary whitespace-nowrap">
                        {c.registration_id != null ? String(c.registration_id).padStart(2, '0') : '—'}
                      </td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">{c.container_number || '—'}</td>
                      <td className="px-4 py-3 text-foreground">{c.product || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.client || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{c.lot || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                          {`${fmtNumber(Math.round(containerDisplayVolume(c, productions) || 0), { minimumFractionDigits: 0, maximumFractionDigits: 0 })} L`}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => navigate(`/vasilhames?id=${c.id}`)}
                          className="inline-flex items-center justify-center p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          title={t('dashboard.fractionalYard.openItem')}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* MPs com Status WMS NOK */}
        <div className="bg-card rounded-xl border border-border flex flex-col min-h-0">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
            <div>
              <h3 className="text-sm font-semibold">{t('dashboard.wmsNok.title')}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{t('dashboard.wmsNok.subtitle')}</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-orange-100 text-orange-700">
              {stocksWmsNok.length}
            </span>
          </div>
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                  <th className="px-4 py-3 font-medium">{t('dashboard.wmsNok.columns.id')}</th>
                  <th className="px-4 py-3 font-medium">{t('dashboard.wmsNok.columns.code')}</th>
                  <th className="px-4 py-3 font-medium">{t('dashboard.wmsNok.columns.mp')}</th>
                  <th className="px-4 py-3 font-medium">{t('dashboard.wmsNok.columns.qty')}</th>
                  <th className="px-4 py-3 font-medium">{t('dashboard.wmsNok.columns.unit')}</th>
                  <th className="px-4 py-3 font-medium">{t('dashboard.wmsNok.columns.lot')}</th>
                  <th className="px-4 py-3 font-medium text-center">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {stocksWmsNok.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      {t('dashboard.wmsNok.empty')}
                    </td>
                  </tr>
                ) : (
                  stocksWmsNok.map((s) => (
                    <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 font-medium text-primary whitespace-nowrap">{s.entry_id || '—'}</td>
                      <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">{s.mp_code || '—'}</td>
                      <td className="px-4 py-3 text-foreground">{s.mp_name || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                          {fmtNumber(Math.round(Number(s.current_stock) || 0), { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{s.unit || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{s.lot || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => navigate(`/estoque?id=${s.id}`)}
                          className="inline-flex items-center justify-center p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          title={t('dashboard.wmsNok.openItem')}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
