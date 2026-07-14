import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import {
  Eye, Package, Box as BoxIcon, Factory, Layers, Scale, Boxes,
  Cylinder, Container, Drum,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ProductionTrackingTable from '@/components/production/ProductionTrackingTable';
import ProductionViewDialog from '@/components/production/ProductionViewDialog';
import RawMaterialViewDialog from '@/components/estoque/RawMaterialViewDialog';
import ContainerViewDialog from '@/components/vasilhames/ContainerViewDialog';
import { canUseClientFilter, getUserClient, matchesClient } from '@/lib/permissions';
import { summarizePatioContainers } from '@/lib/containerUtils';
import { calcPackagingQty } from '@/lib/stockUtils';
import moment from 'moment';
import { fmtNumber, fmtVolume, fmtMass } from '@/i18n/formatters';
import { translateStockExpiryStatus } from '@/i18n/domainMaps';

function MiniKpi({ label, value, icon: Icon, iconClass, bgClass }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${bgClass}`}>
        <Icon className={`w-5 h-5 ${iconClass}`} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1 truncate">{label}</p>
      </div>
    </div>
  );
}

export default function TelaClientes() {
  const { t, i18n } = useTranslation();
  const { user } = useOutletContext();
  const [searchParams] = useSearchParams();
  const highlightProdId = searchParams.get('prod');
  const { data: allProductions, loading } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 500));
  const { data: allStocks } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 500));
  const { data: allContainers } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const [selectedClient, setSelectedClient] = useState('all');
  const [searchMP, setSearchMP] = useState('');
  const [searchContainer, setSearchContainer] = useState('');
  const [showStockDialog, setShowStockDialog] = useState(false);
  const [showContainersDialog, setShowContainersDialog] = useState(false);
  const [viewingProd, setViewingProd] = useState(null);
  const [viewContainers, setViewContainers] = useState([]);
  const [viewingMP, setViewingMP] = useState(null);
  const [viewingContainer, setViewingContainer] = useState(null);

  const fmt = (n) => fmtNumber(n, { minimumFractionDigits: 0 }, i18n.language);

  const externoClient = getUserClient(user);
  const showClientFilter = canUseClientFilter(user);
  const effectiveClient = externoClient || (showClientFilter && selectedClient !== 'all' ? selectedClient : null);

  const clientList = useMemo(() => {
    const allClients = new Set();
    [...allProductions, ...allStocks, ...allContainers].forEach(i => { if (i.client) allClients.add(i.client); });
    return Array.from(allClients).sort((a, b) => a.localeCompare(b, i18n.language));
  }, [allProductions, allStocks, allContainers, i18n.language]);

  const productions = useMemo(
    () => (effectiveClient ? allProductions.filter((p) => matchesClient(p, effectiveClient)) : allProductions),
    [allProductions, effectiveClient],
  );
  const stocks = useMemo(
    () => (effectiveClient ? allStocks.filter((s) => matchesClient(s, effectiveClient)) : allStocks),
    [allStocks, effectiveClient],
  );
  const containers = useMemo(
    () => (effectiveClient ? allContainers.filter((c) => matchesClient(c, effectiveClient)) : allContainers),
    [allContainers, effectiveClient],
  );

  const inProgressProds = useMemo(() =>
    productions.filter(p => !['Finalizado', 'Cancelado'].includes(p.status)),
    [productions]
  );

  const patiotContainers = useMemo(() =>
    containers.filter(c => c.status === 'No Pátio'),
    [containers]
  );

  const stocksWithBalance = useMemo(() =>
    stocks.filter(s => (s.current_stock || 0) > 0),
    [stocks]
  );

  const stockKpis = useMemo(() => {
    const distinctMps = new Set(stocksWithBalance.map(s => s.mp_code).filter(Boolean)).size;
    const totalStored = stocksWithBalance.reduce((s, i) => s + (i.current_stock || 0), 0);
    const totalPackaging = stocksWithBalance.reduce((s, i) => s + calcPackagingQty(i.current_stock, i.packaging_capacity), 0);
    return {
      distinctMps,
      totalLots: stocksWithBalance.length,
      totalStored,
      totalPackaging,
    };
  }, [stocksWithBalance]);

  const containerKpis = useMemo(() => summarizePatioContainers(patiotContainers), [patiotContainers]);

  const filteredStocks = useMemo(() => {
    const q = searchMP.toLowerCase();
    const base = stocksWithBalance;
    if (!q) return base;
    return base.filter(s => [s.mp_name, s.mp_code, s.lot, s.client].some(v => (v || '').toLowerCase().includes(q)));
  }, [stocksWithBalance, searchMP]);

  const filteredContainers = useMemo(() => {
    const q = searchContainer.toLowerCase();
    if (!q) return patiotContainers;
    return patiotContainers.filter(c => [c.container_number, c.barril_number, c.lot, c.product].some(v => (v || '').toLowerCase().includes(q)));
  }, [patiotContainers, searchContainer]);

  const stockDialogTotals = useMemo(() => ({
    currentStock: filteredStocks.reduce((s, i) => s + (i.current_stock || 0), 0),
    packaging: filteredStocks.reduce((s, i) => s + calcPackagingQty(i.current_stock, i.packaging_capacity), 0),
  }), [filteredStocks]);

  const containersDialogTotalVolume = useMemo(
    () => filteredContainers.reduce((s, c) => s + (c.volume || 0), 0),
    [filteredContainers],
  );

  const getMPStatus = (item) => {
    if (!item.expiry_date) return null;
    if (moment(item.expiry_date).isBefore(moment())) return 'Vencido';
    return 'Válido';
  };

  const handleViewProd = (p) => {
    setViewingProd(p);
    setViewContainers(
      allContainers.filter(
        (c) => c.op_number === p.op_number && matchesClient(c, effectiveClient || p.client),
      ),
    );
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('clients.screen.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {effectiveClient
              ? t('clients.screen.subtitleClient', { client: effectiveClient })
              : t('clients.screen.subtitleAll')}
          </p>
        </div>
        {showClientFilter && (
          <div className="w-64">
            <Select value={selectedClient} onValueChange={setSelectedClient}>
              <SelectTrigger><SelectValue placeholder={t('clients.screen.allClients')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('clients.screen.allClients')}</SelectItem>
                {clientList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="bg-card rounded-xl border border-border mb-6">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Factory className="w-4 h-4" style={{ color: '#2575D1' }} />
          <h3 className="text-sm font-semibold">{t('clients.screen.productionsInProgress')}</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-gray-600">{inProgressProds.length}</span>
        </div>
        <ProductionTrackingTable
          productions={inProgressProds}
          showBypass={false}
          showClient={!effectiveClient}
          highlightProdId={highlightProdId}
          maxRows={highlightProdId ? inProgressProds.length : 10}
          onView={handleViewProd}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Estoque KPI Card */}
        <div className="bg-card rounded-xl border border-border h-full flex flex-col">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Package className="w-4 h-4" style={{ color: '#2575D1' }} />
            <h3 className="text-sm font-semibold">{t('clients.screen.rawMaterialStock')}</h3>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-gray-600">{stocksWithBalance.length}</span>
          </div>
          <div className="p-5 flex-1">
            <div className="grid grid-cols-2 gap-3">
              <MiniKpi label={t('clients.screen.kpiDistinctMps')} value={stockKpis.distinctMps} icon={Package} iconClass="text-blue-600" bgClass="bg-blue-100" />
              <MiniKpi label={t('clients.screen.kpiTotalLots')} value={stockKpis.totalLots} icon={Layers} iconClass="text-purple-600" bgClass="bg-purple-100" />
              <MiniKpi label={t('clients.screen.kpiTotalStored')} value={fmt(stockKpis.totalStored)} icon={Scale} iconClass="text-green-600" bgClass="bg-green-100" />
              <MiniKpi label={t('clients.screen.kpiTotalPackaging')} value={fmt(stockKpis.totalPackaging)} icon={Boxes} iconClass="text-amber-600" bgClass="bg-amber-100" />
            </div>
          </div>
          <div className="px-5 py-4 border-t border-border">
            <Button variant="outline" onClick={() => setShowStockDialog(true)} className="w-full">
              {t('clients.screen.viewStock')}
            </Button>
          </div>
        </div>

        {/* Vasilhames KPI Card */}
        <div className="bg-card rounded-xl border border-border h-full flex flex-col">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <BoxIcon className="w-4 h-4" style={{ color: '#2575D1' }} />
            <h3 className="text-sm font-semibold">{t('clients.screen.containersInYard')}</h3>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-gray-600">{containerKpis.total}</span>
          </div>
          <div className="p-5 flex-1">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <MiniKpi label={t('clients.screen.kpiTotalContainers')} value={containerKpis.total} icon={BoxIcon} iconClass="text-blue-600" bgClass="bg-blue-100" />
              <MiniKpi label={t('clients.screen.kpiDistinctProducts')} value={containerKpis.distinctProducts} icon={Package} iconClass="text-purple-600" bgClass="bg-purple-100" />
              <MiniKpi label={t('clients.screen.kpiTotalVolume')} value={fmtVolume(containerKpis.totalVolume, 'L', i18n.language)} icon={Cylinder} iconClass="text-green-600" bgClass="bg-green-100" />
              <MiniKpi label={t('clients.screen.kpiIbcCount')} value={containerKpis.ibc} icon={Container} iconClass="text-amber-600" bgClass="bg-amber-100" />
              <MiniKpi label={t('clients.screen.kpiContentorCount')} value={containerKpis.contentor} icon={BoxIcon} iconClass="text-purple-600" bgClass="bg-purple-100" />
              <MiniKpi label={t('clients.screen.kpiDrumCount')} value={containerKpis.drum} icon={Drum} iconClass="text-cyan-600" bgClass="bg-cyan-100" />
            </div>
          </div>
          <div className="px-5 py-4 border-t border-border">
            <Button variant="outline" onClick={() => setShowContainersDialog(true)} className="w-full">
              {t('clients.screen.viewContainers')}
            </Button>
          </div>
        </div>
      </div>

      <ProductionViewDialog
        production={viewingProd}
        containers={viewContainers}
        stocks={stocks}
        open={!!viewingProd}
        onOpenChange={(open) => { if (!open) setViewingProd(null); }}
        simplified
      />

      {/* Estoque Dialog */}
      <Dialog open={showStockDialog} onOpenChange={setShowStockDialog}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('clients.screen.rawMaterialStock')}</DialogTitle>
          </DialogHeader>
          <div className="relative mb-3">
            <Input placeholder={t('common.searchPlaceholder')} value={searchMP} onChange={e => setSearchMP(e.target.value)} className="h-9 text-sm" />
          </div>
          {filteredStocks.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{t('clients.screen.noStock')}</div>
          ) : (
            <>
              <div className="overflow-x-auto flex-1 min-h-0 overflow-y-auto">
                <table className="w-full chemctrl-table">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold">{t('clients.screen.id')}</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">{t('clients.screen.mpCode')}</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">{t('common.product')}</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">{t('common.lot')}</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold">{t('clients.screen.initialBalance')}</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold">{t('clients.screen.currentBalance')}</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold">{t('clients.screen.unitShort')}</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold">{t('common.status')}</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold">{t('clients.screen.view')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStocks.map(item => {
                      const status = getMPStatus(item);
                      return (
                        <tr key={item.id} className="border-b border-border hover:bg-accent/30">
                          <td className="px-3 py-2 text-sm font-medium text-primary">{item.entry_id || t('common.notAvailable')}</td>
                          <td className="px-3 py-2 font-mono text-sm text-muted-foreground">{item.mp_code || t('common.notAvailable')}</td>
                          <td className="px-3 py-2 text-sm font-medium text-foreground">{item.mp_name}</td>
                          <td className="px-3 py-2 text-sm text-muted-foreground">{item.lot || t('common.notAvailable')}</td>
                          <td className="px-3 py-2 text-right text-sm text-foreground">{fmt(item.initial_stock)}</td>
                          <td className="px-3 py-2 text-right text-sm font-bold text-foreground">{fmt(item.current_stock)}</td>
                          <td className="px-3 py-2 text-center text-sm font-bold text-foreground">{item.unit}</td>
                          <td className="px-3 py-2 text-center">
                            {status === null ? (
                              <span className="text-sm text-muted-foreground">{t('common.notAvailable')}</span>
                            ) : status === 'Vencido' ? (
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{translateStockExpiryStatus(status)}</span>
                            ) : (
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">{translateStockExpiryStatus(status)}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button onClick={() => setViewingMP(item)} className="p-1 rounded hover:bg-accent"><Eye className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="shrink-0 border-t border-border bg-muted/50 px-4 py-3 mt-auto">
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {t('clients.screen.dialogTotalCurrentStock')}:{' '}
                    <span className="font-bold text-foreground">{fmt(stockDialogTotals.currentStock)}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {t('clients.screen.dialogTotalPackaging')}:{' '}
                    <span className="font-bold text-foreground">{fmt(stockDialogTotals.packaging)}</span>
                  </span>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Vasilhames Dialog */}
      <Dialog open={showContainersDialog} onOpenChange={setShowContainersDialog}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('clients.screen.containersInYard')}</DialogTitle>
          </DialogHeader>
          <div className="relative mb-3">
            <Input placeholder={t('common.searchPlaceholder')} value={searchContainer} onChange={e => setSearchContainer(e.target.value)} className="h-9 text-sm" />
          </div>
          {filteredContainers.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{t('clients.screen.noContainers')}</div>
          ) : (
            <>
              <div className="overflow-x-auto flex-1 min-h-0 overflow-y-auto">
                <table className="w-full chemctrl-table">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold">{t('clients.screen.packagingNumber')}</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">{t('common.product')}</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold">{t('production.packaging.volume')}</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold">{t('clients.screen.massKg')}</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">{t('common.lot')}</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold">{t('clients.screen.view')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContainers.map(c => (
                      <tr key={c.id} className="border-b border-border hover:bg-accent/30">
                        <td className="px-3 py-2 text-sm font-bold text-foreground">{c.container_number || t('common.notAvailable')}</td>
                        <td className="px-3 py-2 text-sm text-foreground">{c.product || t('common.notAvailable')}</td>
                        <td className="px-3 py-2 text-right text-sm font-bold text-primary">{fmtVolume(c.volume, 'L', i18n.language)}</td>
                        <td className="px-3 py-2 text-right text-sm font-bold text-green-600 dark:text-green-400">{fmtMass(c.net_weight, 'kg', i18n.language)}</td>
                        <td className="px-3 py-2 text-sm text-muted-foreground">{c.lot || t('common.notAvailable')}</td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => setViewingContainer(c)} className="p-1 rounded hover:bg-accent"><Eye className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="shrink-0 border-t border-border bg-muted/50 px-4 py-3 mt-auto">
                <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {t('clients.screen.dialogTotalVolume')}:{' '}
                    <span className="font-bold text-foreground">{fmtVolume(containersDialogTotalVolume, 'L', i18n.language)}</span>
                  </span>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <RawMaterialViewDialog item={viewingMP} open={!!viewingMP} onOpenChange={(open) => { if (!open) setViewingMP(null); }} readOnly />
      <ContainerViewDialog container={viewingContainer} open={!!viewingContainer} onOpenChange={(open) => { if (!open) setViewingContainer(null); }} readOnly />
    </div>
  );
}
