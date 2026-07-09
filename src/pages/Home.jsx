import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { BarChart3, DollarSign, ClipboardList, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import moment from 'moment';
import ProductionTrackingTable from '@/components/production/ProductionTrackingTable';

const StatCard = ({ title, value, valueColor, subtitle, subtitleColor, icon: Icon, iconBg, footer, accentBorder, showEye, hidden, onToggleEye, alert }) => (
  <div className="bg-card rounded-xl border border-border overflow-hidden flex flex-col" style={{ borderBottom: accentBorder ? `3px solid ${accentBorder}` : undefined }}>
    <div className="p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</p>
        <div className="flex items-center gap-2">
          {showEye && (
            <button
              type="button"
              onClick={onToggleEye}
              className="w-8 h-8 rounded-lg flex items-center justify-center bg-muted hover:bg-gray-200 text-gray-600 hover:text-gray-800 cursor-pointer"
              title={hidden ? 'Mostrar' : 'Ocultar'}
            >
              {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: iconBg }}>
            <Icon className="w-4 h-4 text-white" />
          </div>
        </div>
      </div>
      <p className="text-3xl font-bold" style={{ color: valueColor || '#000' }}>{hidden ? '••••••' : value}</p>
      {subtitle && <p className="text-xs mt-1" style={{ color: subtitleColor || '#666' }}>{subtitle}</p>}
    </div>
    {footer && (
      <>
        <div className="border-t border-border" />
        <div className="px-5 py-3 flex flex-col gap-0.5">
          {footer.map((f, i) => (
            <p key={i} className="text-xs" style={{ color: f.color }}>{f.text}</p>
          ))}
        </div>
      </>
    )}
    {alert && (
      <div className="px-5 py-2.5 flex items-center gap-2" style={{ background: '#fef2f2' }}>
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: '#991b1b' }} />
        <p className="text-xs font-medium" style={{ color: '#991b1b' }}>{alert}</p>
      </div>
    )}
  </div>
);

export default function Home() {
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
  const openOrders = orders.filter(o => o.status !== 'Finalizado');
  const openVolume = openOrders.reduce((s, o) => s + (o.volume_pending || 0), 0);
  const lateOrders = openOrders.filter(o => o.expected_date && moment(o.expected_date).isBefore(now));

  const fmt = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtMoney = (n) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  const handleBypass = async (p) => {
    setBypassing(p.id);
    try {
      if (p.bypass_qc) {
        await base44.entities.Production.update(p.id, { bypass_qc: false });
        toast({ title: `By-pass removido — ${p.op_number}` });
      } else {
        const updates = { bypass_qc: true };
        if (p.status === 'Qualidade') {
          updates.status = 'Envase';
        }
        await base44.entities.Production.update(p.id, updates);
        toast({ title: `By-pass liberado — ${p.op_number}` });
      }
      load();
    } finally {
      setBypassing(null);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Home</h1>
        <p className="text-sm text-muted-foreground">Visão geral · {now.format('DD [de] MMMM [de] YYYY')}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard title="Volume Produzido no Mês" value={`${fmt(totalVolumeMonth)} L`} valueColor="#000"
          subtitle={`${finishedThisMonth.length} OP(s) finalizada(s)`} icon={BarChart3} iconBg="#1e56a0"
          showEye hidden={hideVolume} onToggleEye={() => setHideVolume(h => !h)}
          footer={[
            { text: hideVolume ? '+ •••••• em produção' : `+ ${fmt(inProgressVolume)} L em produção`, color: '#1e56a0' },
            { text: hideVolume ? 'Total provisionado: ••••••' : `Total provisionado: ${fmt(totalVolumeMonth + inProgressVolume)} L`, color: '#666' },
          ]} />
        <StatCard title="Receita Gerada no Mês" value={fmtMoney(revenueMonth)} valueColor="#00875a"
          subtitle="receita realizada" icon={DollarSign} iconBg="#00875a" accentBorder="#00875a" showEye
          hidden={hideRevenue} onToggleEye={() => setHideRevenue(h => !h)}
          footer={[
            { text: hideRevenue ? '+ •••••• em produção' : `+ ${fmtMoney(revenueInProcess)} em produção`, color: '#1e56a0' },
            { text: hideRevenue ? 'Total provisionado: ••••••' : `Total provisionado: ${fmtMoney(revenueMonth + revenueInProcess)}`, color: '#666' },
          ]} />
        <StatCard title="Pedidos em Aberto"
          value={<><span style={{ color: '#000' }}>{openOrders.length}</span> <span style={{ color: '#666' }}>pedidos</span></>}
          subtitle={`${fmt(openVolume)} L pendentes`} subtitleColor="#f59e0b"
          icon={ClipboardList} iconBg="#f59e0b" accentBorder="#f59e0b"
          alert={lateOrders.length > 0 ? `${lateOrders.length} pedido(s) em atraso · ${fmt(lateOrders.reduce((s, o) => s + (o.volume_pending || 0), 0))} L` : null} />
      </div>

      {/* Active Productions — redesigned */}
      <div className="bg-card rounded-xl border border-border">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Produções em andamento</h3>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-gray-600">{inProgressProds.length}</span>
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
