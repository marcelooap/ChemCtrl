import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { Play, Package, RotateCcw, FileCheck, RefreshCw, ClipboardList, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import ProductionCard from '@/components/ProductionCard';
import ConfirmDialog from '@/components/ConfirmDialog';
import EnvaseDialog from '@/components/EnvaseDialog';
import { waitInterval } from '@/lib/brasilTime';
import { fmtDate, fmtNumber, fmtVolume, fmtMass } from '@/i18n/formatters';
import { translateProductionStatus } from '@/i18n/domainMaps';

const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) { return []; }
};

export default function OrdensProducao() {
  const { t, i18n } = useTranslation();
  const { user, isReadOnly } = useOutletContext();
  const { data: productions, loading, reload: load } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 200));
  const [filter, setFilter] = useState('all');
  const [showEnvase, setShowEnvase] = useState(false);
  const [showView, setShowView] = useState(false);
  const [selectedOP, setSelectedOP] = useState(null);
  const [viewingOP, setViewingOP] = useState(null);
  const [confirm, setConfirm] = useState({ open: false, title: '', message: '', onConfirm: () => {}, confirmLabel: t('buttons.yes'), confirmColor: '#2575D1' });
  const navigate = useNavigate();

  const canAnalyze = user && (user.nivel === 'administrador' || user.nivel === 'supervisor');

  const activeProds = productions.filter(p => !['Finalizado', 'Cancelado'].includes(p.status));
  const opNumeric = (op) => { const m = String(op || '').match(/(\d+)/); return m ? parseInt(m[1], 10) : 0; };
  const sortedProds = [...activeProds].sort((a, b) => opNumeric(a.op_number) - opNumeric(b.op_number));
  const filtered = filter === 'all' ? sortedProds : sortedProds.filter(p => p.status === filter);

  const startProduction = (prod) => {
    setConfirm({
      open: true,
      title: t('production.orders.startConfirm.title', { op: prod.op_number }),
      message: t('production.orders.startConfirm.message', {
        product: prod.product,
        lot: prod.lot,
        wait: waitInterval(prod.created_date, null),
      }),
      confirmLabel: t('production.orders.startConfirm.confirmLabel'),
      confirmColor: '#1e40af',
      onConfirm: async () => {
        const operatorName = user?.nome || user?.full_name || user?.email || '';
        await base44.entities.Production.update(prod.id, { status: 'Em Produção', start_time: new Date().toISOString(), operator: operatorName });
        navigate(`/producao/${prod.id}/checklist`);
      },
    });
  };

  const resumeProduction = (prod) => {
    setConfirm({
      open: true,
      title: t('production.orders.resumeConfirm.title', { op: prod.op_number }),
      message: t('production.orders.resumeConfirm.message', {
        product: prod.product,
        lot: prod.lot,
      }),
      confirmLabel: t('production.orders.resumeConfirm.confirmLabel'),
      confirmColor: '#1e40af',
      onConfirm: async () => {
        const updates = {};
        if (prod.pause_start_time) {
          const pauseMs = new Date().getTime() - new Date(prod.pause_start_time).getTime();
          updates.total_pause_ms = (prod.total_pause_ms || 0) + pauseMs;
          updates.pause_start_time = null;
        }
        await base44.entities.Production.update(prod.id, updates);
        navigate(`/producao/${prod.id}/checklist`);
      },
    });
  };

  const openView = (prod) => { setViewingOP(prod); setShowView(true); };

  const openEnvase = (prod) => {
    setSelectedOP(prod);
    setShowEnvase(true);
  };

  const fmt3 = (n) => fmtNumber(n, { minimumFractionDigits: 3, maximumFractionDigits: 3 }, i18n.language);

  const totalPendingVolume = activeProds.reduce((s, p) => s + (p.volume || 0), 0);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>;

  const renderActionButton = (prod) => {
    if (isReadOnly) return null;
    if (prod.status === 'Aguardando Início') {
      return <Button onClick={() => startProduction(prod)} className="w-full text-white" style={{ background: '#1e40af' }}><Play className="w-3.5 h-3.5 mr-1.5" /> {t('production.actions.start')}</Button>;
    }
    if (prod.status === 'Em Produção') {
      return <Button onClick={() => resumeProduction(prod)} className="w-full text-white" style={{ background: '#1e40af' }}><RotateCcw className="w-3.5 h-3.5 mr-1.5" /> {t('production.orders.resume')}</Button>;
    }
    if (prod.status === 'Qualidade') {
      if (canAnalyze) {
        return <Button onClick={() => navigate(`/qualidade/producoes?prod=${prod.id}`)} className="w-full text-white" style={{ background: '#6d28d9' }}><FileCheck className="w-3.5 h-3.5 mr-1.5" /> {t('production.orders.analyze')}</Button>;
      }
      return <Button disabled className="w-full text-white" style={{ background: '#94a3b8' }}>{t('production.orders.waitingQc')}</Button>;
    }
    if (prod.status === 'Envase') {
      return <Button onClick={() => openEnvase(prod)} className="w-full text-white" style={{ background: '#f59e0b' }}><Package className="w-3.5 h-3.5 mr-1.5" /> {t('production.orders.registerPackaging')}</Button>;
    }
    return null;
  };

  return (
    <div className="pb-20">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('production.ordersTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('production.orders.openCount', { count: activeProds.length })}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> {t('common.refresh')}
          </Button>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder={t('production.orders.allStages')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('production.orders.allStages')}</SelectItem>
              <SelectItem value="Aguardando Início">{translateProductionStatus('Aguardando Início')}</SelectItem>
              <SelectItem value="Em Produção">{translateProductionStatus('Em Produção')}</SelectItem>
              <SelectItem value="Qualidade">{translateProductionStatus('Qualidade')}</SelectItem>
              <SelectItem value="Envase">{translateProductionStatus('Envase')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(prod => (
          <ProductionCard key={prod.id} prod={prod} onView={openView}>
            {renderActionButton(prod)}
          </ProductionCard>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium mb-1">{t('production.orders.emptyTitle')}</p>
          <p className="text-sm">{t('production.orders.emptyDetail')}</p>
        </div>
      )}

      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t('production.orders.viewTitle', { op: viewingOP?.op_number, product: viewingOP?.product })}</DialogTitle></DialogHeader>
          {viewingOP && (
            <div>
              <div className="grid grid-cols-4 gap-3 text-sm mb-4 bg-muted/50 rounded-lg p-3">
              <div><p className="text-xs text-muted-foreground">{t('production.orders.waitingStart')}</p><p className="font-medium" style={{ color: '#1e40af' }}>{waitInterval(viewingOP.created_date, viewingOP.start_time)}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('common.lot')}</p><p className="font-medium">{viewingOP.lot}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('common.date')}</p><p className="font-medium">{fmtDate(viewingOP.date, undefined, i18n.language)}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('common.volume')}</p><p className="font-medium">{fmtVolume(viewingOP.volume, 'L', i18n.language)}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('common.mass')}</p><p className="font-medium">{fmtMass(viewingOP.mass, 'kg', i18n.language)}</p></div>
              </div>
              <h4 className="text-sm font-semibold mb-2">{t('production.orders.rawMaterials')}</h4>
              <table className="w-full text-sm border rounded-lg overflow-hidden">
                <thead><tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                  <th className="px-3 py-2 text-left">{t('production.orders.code')}</th><th className="px-3 py-2 text-left">{t('production.orders.rawMaterial')}</th><th className="px-3 py-2 text-left">{t('common.lot')}</th><th className="px-3 py-2 text-right">{t('production.orders.qtyOperationalKg')}</th>
                </tr></thead>
                <tbody>
                  {parseArr(viewingOP.raw_materials_used).map((mp, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs" style={{ color: '#1e40af' }}>{mp.mp_code}</td>
                      <td className="px-3 py-2">{mp.mp_name}</td>
                      <td className="px-3 py-2">{mp.lot || t('common.notAvailable')}</td>
                      <td className="px-3 py-2 text-right font-medium">{fmt3(mp.qty_operational)}</td>
                    </tr>
                  ))}
                  <tr className="border-t bg-muted/50 font-bold">
                    <td colSpan={3} className="px-3 py-2">{t('production.checklist.total').toUpperCase()}</td>
                    <td className="px-3 py-2 text-right" style={{ color: '#1e40af' }}>{fmt3(parseArr(viewingOP.raw_materials_used).reduce((s, m) => s + (m.qty_operational || 0), 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end mt-4">
            <Button variant="outline" onClick={() => setShowView(false)}>{t('buttons.close')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Envase Dialog */}
      <EnvaseDialog
        open={showEnvase}
        onOpenChange={setShowEnvase}
        production={selectedOP}
        onSave={load}
      />
      <ConfirmDialog
        open={confirm.open}
        onOpenChange={(open) => setConfirm(prev => ({ ...prev, open }))}
        title={confirm.title}
        message={confirm.message}
        onConfirm={confirm.onConfirm}
        confirmLabel={confirm.confirmLabel}
        confirmColor={confirm.confirmColor}
      />

      {/* Fixed footer bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-card border-t border-border shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#dbeafe' }}>
                <ClipboardList className="w-4 h-4" style={{ color: '#1e40af' }} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground leading-tight">{t('production.orders.openOps')}</p>
                <p className="text-lg font-bold leading-tight">{activeProds.length}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#fef3c7' }}>
                <Gauge className="w-4 h-4" style={{ color: '#d97706' }} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground leading-tight">{t('production.orders.pendingVolume')}</p>
                <p className="text-lg font-bold leading-tight">{fmtVolume(totalPendingVolume, 'L', i18n.language)}</p>
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> {t('common.refresh')}
          </Button>
        </div>
      </div>
    </div>
  );
}
