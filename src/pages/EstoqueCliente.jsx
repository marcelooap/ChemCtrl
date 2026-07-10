import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useOutletContext } from 'react-router-dom';
import { Package, Box as BoxIcon, Cylinder, FileText, Search, FileSpreadsheet } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { canUseClientFilter, getUserClient } from '@/lib/permissions';
import { generateClientStockPDF } from '@/lib/pdfReports';
import { exportEstoqueClienteExcel } from '@/lib/exportEstoqueClienteExcel';
import { useToast } from '@/components/ui/use-toast';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { fmtDate, fmtNumber, fmtVolume, fmtMass, fmtPercent } from '@/i18n/formatters';
import { translateStockExpiryStatus, translateContainerStatus } from '@/i18n/domainMaps';
import moment from 'moment';

const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

function SummaryCard({ title, count, icon: Icon, color }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 flex items-center gap-4">
      <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0" style={{ background: color }}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</p>
        <p className="text-2xl font-bold">{count}</p>
      </div>
    </div>
  );
}

export default function EstoqueCliente() {
  const { t, i18n } = useTranslation();
  const { user } = useOutletContext();
  const { toast } = useToast();
  const { data: stocks, loading } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 2000));
  const { data: containers } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const { data: tanks } = useRealtimeEntity('Tank', () => base44.entities.Tank.list('-created_date', 500));
  const [selectedClient, setSelectedClient] = useState('all');
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState('');

  const fmt = (n) => fmtNumber(n, { minimumFractionDigits: 0 }, i18n.language);

  const externoClient = getUserClient(user);
  const showClientFilter = canUseClientFilter(user);
  const effectiveClient = externoClient || (showClientFilter && selectedClient !== 'all' ? selectedClient : null);

  const clientList = useMemo(() => {
    const allClients = new Set();
    [...stocks, ...containers, ...tanks].forEach(i => { if (i.client) allClients.add(i.client); });
    return Array.from(allClients).sort((a, b) => a.localeCompare(b, i18n.language));
  }, [stocks, containers, tanks, i18n.language]);

  const filteredStocks = useMemo(() => {
    let result = stocks;
    if (effectiveClient) result = result.filter(s => s.client === effectiveClient);
    const q = search.toLowerCase();
    if (q) result = result.filter(s => [s.mp_name, s.mp_code, s.lot, s.supplier].some(v => (v || '').toLowerCase().includes(q)));
    const lotMap = {};
    const lotOrder = [];
    result.forEach(s => {
      const key = `${s.mp_code || s.mp_name}||${s.lot || 'Sem Lote'}`;
      if (!lotMap[key]) {
        lotMap[key] = { ...s, initial_stock: 0, current_stock: 0, _count: 0 };
        lotOrder.push(key);
      }
      lotMap[key].initial_stock += (s.initial_stock || 0);
      lotMap[key].current_stock += (s.current_stock || 0);
      lotMap[key]._count += 1;
    });
    return lotOrder.map(k => lotMap[k]).filter(s => (s.current_stock || 0) > 0);
  }, [stocks, effectiveClient, search]);

  const filteredContainers = useMemo(() => {
    let result = containers.filter(c => c.status === 'No Pátio');
    if (effectiveClient) result = result.filter(c => c.client === effectiveClient);
    const q = search.toLowerCase();
    if (q) result = result.filter(c => [c.container_number, c.barril_number, c.lot, c.product].some(v => (v || '').toLowerCase().includes(q)));
    return result;
  }, [containers, effectiveClient, search]);

  const tanksWithData = useMemo(() => {
    return tanks.map(tank => {
      let volume = 0;
      let latestLot = tank.lot || '';
      let latestDate = 0;
      const products = new Set();

      stocks.forEach(s => {
        if (!s.tank_storage) return;
        const tankEntries = parseArr(s.tank_entries);
        if (tankEntries.length) {
          tankEntries.forEach(te => {
            if (te.tank_name === tank.name && te.volume) {
              volume += te.volume;
              if (s.mp_name) products.add(s.mp_name);
              const d = new Date(s.created_date || s.entry_date || 0).getTime();
              if (d > latestDate) { latestDate = d; latestLot = s.lot || latestLot; }
            }
          });
        }
        if (!tankEntries.length && s.tank_name === tank.name && s.tank_volume) {
          volume += s.tank_volume;
          if (s.mp_name) products.add(s.mp_name);
          const d = new Date(s.created_date || s.entry_date || 0).getTime();
          if (d > latestDate) { latestDate = d; latestLot = s.lot || latestLot; }
        }
      });

      containers.forEach(c => {
        const isTank = (c.type || '').toLowerCase().includes('tank');
        if (isTank && c.container_number === tank.name && c.volume) {
          volume += c.volume;
          if (c.product) products.add(c.product);
          const d = new Date(c.created_date || 0).getTime();
          if (d > latestDate) { latestDate = d; latestLot = c.lot || latestLot; }
        }
      });

      return { ...tank, current_volume: volume, computed_lot: latestLot, computed_products: Array.from(products) };
    });
  }, [tanks, stocks, containers]);

  const filteredTanks = useMemo(() => {
    let result = tanksWithData;
    if (effectiveClient) result = result.filter(t => t.client === effectiveClient);
    const q = search.toLowerCase();
    if (q) result = result.filter(t => [t.name, t.computed_lot, ...t.computed_products].some(v => (v || '').toLowerCase().includes(q)));
    return result;
  }, [tanksWithData, effectiveClient, search]);

  const getMPStatus = (item) => {
    if (!item.expiry_date) return null;
    if (moment(item.expiry_date).isBefore(moment())) return 'Vencido';
    return 'Válido';
  };

  const handlePDF = async () => {
    setGenerating(true);
    try {
      generateClientStockPDF({
        client: effectiveClient || t('clients.stock.allClientsLabel'),
        stocks: filteredStocks,
        containers: filteredContainers,
        tanks: filteredTanks,
      });
      toast({ title: t('clients.stock.reportSuccess') });
    } catch (e) {
      toast({ title: t('clients.stock.reportError'), variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const handleExcel = async () => {
    setGenerating(true);
    try {
      await exportEstoqueClienteExcel({
        client: effectiveClient || t('clients.stock.allClientsLabel'),
        stocks: filteredStocks,
        containers: filteredContainers,
      });
      toast({ title: t('clients.stock.excelSuccess') });
    } catch (e) {
      toast({ title: t('clients.stock.excelError'), variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('clients.stock.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {effectiveClient
              ? t('clients.stock.subtitleClient', { client: effectiveClient })
              : t('clients.stock.subtitleAll')}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          {showClientFilter && (
            <div className="w-full sm:w-56">
              <Select value={selectedClient} onValueChange={setSelectedClient}>
                <SelectTrigger><SelectValue placeholder={t('clients.screen.allClients')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('clients.screen.allClients')}</SelectItem>
                  {clientList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            onClick={handlePDF}
            disabled={generating || (filteredStocks.length === 0 && filteredContainers.length === 0 && filteredTanks.length === 0)}
            className="flex items-center gap-2 whitespace-nowrap"
            style={{ background: '#2575D1' }}
          >
            <FileText className="w-4 h-4" />
            {generating ? t('clients.stock.generating') : t('clients.stock.generatePdf')}
          </Button>
          <Button
            onClick={handleExcel}
            disabled={generating || (filteredStocks.length === 0 && filteredContainers.length === 0 && filteredTanks.length === 0)}
            className="flex items-center gap-2 whitespace-nowrap"
            style={{ background: '#16a34a' }}
          >
            <FileSpreadsheet className="w-4 h-4" />
            {generating ? t('clients.stock.generating') : t('clients.stock.exportExcel')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <SummaryCard title={t('clients.stock.rawMaterials')} count={filteredStocks.length} icon={Package} color="#2563eb" />
        <SummaryCard title={t('clients.stock.containers')} count={filteredContainers.length} icon={BoxIcon} color="#f59e0b" />
        <SummaryCard title={t('clients.stock.tankage')} count={filteredTanks.length} icon={Cylinder} color="#7c3aed" />
      </div>

      <div className="mb-4 relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder={t('clients.stock.searchAll')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="bg-card rounded-xl border border-border mb-6">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Package className="w-4 h-4" style={{ color: '#2575D1' }} />
          <h3 className="text-sm font-semibold">{t('clients.screen.rawMaterialStock')}</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-gray-600">{filteredStocks.length}</span>
        </div>
        {filteredStocks.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{t('clients.screen.noStock')}</div>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">{t('clients.screen.mpCode')}</th>
                  <th className="px-3 py-2 text-left">{t('common.product')}</th>
                  {!effectiveClient && <th className="px-3 py-2 text-left">{t('common.client')}</th>}
                  <th className="px-3 py-2 text-left">{t('common.lot')}</th>
                  <th className="px-3 py-2 text-left">{t('clients.stock.supplier')}</th>
                  <th className="px-3 py-2 text-right">{t('clients.screen.initialBalance')}</th>
                  <th className="px-3 py-2 text-right">{t('clients.screen.currentBalance')}</th>
                  <th className="px-3 py-2 text-center">{t('clients.screen.unitShort')}</th>
                  <th className="px-3 py-2 text-center">{t('clients.stock.expiry')}</th>
                  <th className="px-3 py-2 text-center">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredStocks.map(item => {
                  const status = getMPStatus(item);
                  return (
                    <tr key={item.id} className="border-b border-border hover:bg-accent/30">
                      <td className="px-3 py-2 font-mono text-sm text-muted-foreground">{item.mp_code || t('common.notAvailable')}</td>
                      <td className="px-3 py-2 text-sm font-medium text-foreground">{item.mp_name}</td>
                      {!effectiveClient && <td className="px-3 py-2 text-sm text-muted-foreground">{item.client || t('common.notAvailable')}</td>}
                      <td className="px-3 py-2 text-sm text-muted-foreground">{item.lot || t('common.notAvailable')}</td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">{item.supplier || t('common.notAvailable')}</td>
                      <td className="px-3 py-2 text-right text-sm text-foreground">{fmt(item.initial_stock)}</td>
                      <td className="px-3 py-2 text-right text-sm font-bold text-foreground">{fmt(item.current_stock)}</td>
                      <td className="px-3 py-2 text-center text-sm font-bold text-foreground">{item.unit}</td>
                      <td className="px-3 py-2 text-center text-sm text-muted-foreground">{item.expiry_date ? fmtDate(item.expiry_date, undefined, i18n.language) : t('common.notAvailable')}</td>
                      <td className="px-3 py-2 text-center">
                        {status === null ? (
                          <span className="text-sm" style={{ color: '#9CA3AF' }}>{t('common.notAvailable')}</span>
                        ) : status === 'Vencido' ? (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{translateStockExpiryStatus(status)}</span>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">{translateStockExpiryStatus(status)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-card rounded-xl border border-border mb-6">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <BoxIcon className="w-4 h-4" style={{ color: '#2575D1' }} />
          <h3 className="text-sm font-semibold">{t('clients.stock.containers')}</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-gray-600">{filteredContainers.length}</span>
        </div>
        {filteredContainers.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{t('clients.stock.noContainers')}</div>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">{t('clients.screen.packagingNumber')}</th>
                  <th className="px-3 py-2 text-left">{t('clients.stock.barrel')}</th>
                  {!effectiveClient && <th className="px-3 py-2 text-left">{t('common.client')}</th>}
                  <th className="px-3 py-2 text-left">{t('common.product')}</th>
                  <th className="px-3 py-2 text-left">{t('common.lot')}</th>
                  <th className="px-3 py-2 text-left">{t('common.type')}</th>
                  <th className="px-3 py-2 text-right">{t('production.packaging.volume')}</th>
                  <th className="px-3 py-2 text-right">{t('production.packaging.netWeight')}</th>
                  <th className="px-3 py-2 text-right">{t('production.packaging.grossWeight')}</th>
                  <th className="px-3 py-2 text-center">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredContainers.map(c => (
                  <tr key={c.id} className="border-b border-border hover:bg-accent/30">
                    <td className="px-3 py-2 text-sm font-bold text-foreground">{c.container_number || t('common.notAvailable')}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{c.barril_number || t('common.notAvailable')}</td>
                    {!effectiveClient && <td className="px-3 py-2 text-sm text-muted-foreground">{c.client || t('common.notAvailable')}</td>}
                    <td className="px-3 py-2 text-sm font-medium text-foreground">{c.product || t('common.notAvailable')}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{c.lot || t('common.notAvailable')}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{c.type || t('common.notAvailable')}</td>
                    <td className="px-3 py-2 text-right text-sm font-bold text-primary">{fmtVolume(c.volume, 'L', i18n.language)}</td>
                    <td className="px-3 py-2 text-right text-sm text-green-600 dark:text-green-400">{fmtMass(c.net_weight, 'kg', i18n.language)}</td>
                    <td className="px-3 py-2 text-right text-sm text-foreground">{fmtMass(c.gross_weight, 'kg', i18n.language)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.status === 'No Pátio' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                        {c.status ? translateContainerStatus(c.status) : t('common.notAvailable')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-card rounded-xl border border-border">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Cylinder className="w-4 h-4" style={{ color: '#2575D1' }} />
          <h3 className="text-sm font-semibold">{t('clients.stock.tankage')}</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-gray-600">{filteredTanks.length}</span>
        </div>
        {filteredTanks.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{t('clients.stock.noTanks')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">{t('clients.stock.tank')}</th>
                  {!effectiveClient && <th className="px-3 py-2 text-left">{t('common.client')}</th>}
                  <th className="px-3 py-2 text-left">{t('common.product')}</th>
                  <th className="px-3 py-2 text-left">{t('common.lot')}</th>
                  <th className="px-3 py-2 text-right">{t('clients.stock.currentVolumeL')}</th>
                  <th className="px-3 py-2 text-center">{t('clients.stock.occupation')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredTanks.map(tank => {
                  const volume = tank.current_volume || 0;
                  const capacity = tank.capacity || 26000;
                  const pct = Math.min(100, Math.round((volume / capacity) * 100));
                  return (
                    <tr key={tank.id} className="border-b border-border hover:bg-accent/30">
                      <td className="px-3 py-2 text-sm font-bold text-foreground">{tank.name || t('common.notAvailable')}</td>
                      {!effectiveClient && <td className="px-3 py-2 text-sm text-muted-foreground">{tank.client || t('common.notAvailable')}</td>}
                      <td className="px-3 py-2 text-sm font-medium text-foreground">{tank.computed_products.join(', ') || t('common.notAvailable')}</td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">{tank.computed_lot || t('common.notAvailable')}</td>
                      <td className="px-3 py-2 text-right text-sm font-bold text-primary">{fmt(volume)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden min-w-[60px]">
                            <div className="h-full rounded-full transition-all bg-green-600" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground shrink-0">{fmtPercent(pct / 100, { maximumFractionDigits: 0 }, i18n.language)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
