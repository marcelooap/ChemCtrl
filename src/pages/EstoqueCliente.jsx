import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useOutletContext } from 'react-router-dom';
import { Package, Box as BoxIcon, Cylinder, FileText, Warehouse, Search, FileSpreadsheet } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { canUseClientFilter, getUserClient } from '@/lib/permissions';
import { generateClientStockPDF } from '@/lib/pdfReports';
import { exportEstoqueClienteExcel } from '@/lib/exportEstoqueClienteExcel';
import moment from 'moment';
import { useToast } from '@/components/ui/use-toast';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';

const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 });
const fmt3 = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 });

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
  const { user } = useOutletContext();
  const { toast } = useToast();
  const { data: stocks, loading } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 2000));
  const { data: containers } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const { data: tanks } = useRealtimeEntity('Tank', () => base44.entities.Tank.list('-created_date', 500));
  const [selectedClient, setSelectedClient] = useState('all');
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState('');

  const externoClient = getUserClient(user);
  const showClientFilter = canUseClientFilter(user);
  const effectiveClient = externoClient || (showClientFilter && selectedClient !== 'all' ? selectedClient : null);

  const clientList = useMemo(() => {
    const allClients = new Set();
    [...stocks, ...containers, ...tanks].forEach(i => { if (i.client) allClients.add(i.client); });
    return Array.from(allClients).sort();
  }, [stocks, containers, tanks]);

  const filteredStocks = useMemo(() => {
    let result = stocks;
    if (effectiveClient) result = result.filter(s => s.client === effectiveClient);
    const q = search.toLowerCase();
    if (q) result = result.filter(s => [s.mp_name, s.mp_code, s.lot, s.supplier].some(v => (v || '').toLowerCase().includes(q)));
    // Unify by product + lot — sum current_stock and initial_stock
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

  // Compute tank volumes same as Tankagem page — from stock entries (tank_entries) and containers
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
        client: effectiveClient || 'Todos os Clientes',
        stocks: filteredStocks,
        containers: filteredContainers,
        tanks: filteredTanks,
      });
      toast({ title: 'Relatório gerado com sucesso.' });
    } catch (e) {
      toast({ title: 'Erro ao gerar relatório.', variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const handleExcel = async () => {
    setGenerating(true);
    try {
      await exportEstoqueClienteExcel({
        client: effectiveClient || 'Todos os Clientes',
        stocks: filteredStocks,
        containers: filteredContainers,
      });
      toast({ title: 'Relatório Excel exportado com sucesso.' });
    } catch (e) {
      toast({ title: 'Erro ao exportar relatório.', variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Estoque Cliente</h1>
          <p className="text-sm text-muted-foreground">
            {effectiveClient ? `Cliente: ${effectiveClient}` : 'Todos os clientes'} · Estoque de matéria prima, vasilhames e tankagem
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          {showClientFilter && (
            <div className="w-full sm:w-56">
              <Select value={selectedClient} onValueChange={setSelectedClient}>
                <SelectTrigger><SelectValue placeholder="Todos os clientes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os clientes</SelectItem>
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
            {generating ? 'Gerando...' : 'Gerar Relatório PDF'}
          </Button>
          <Button
            onClick={handleExcel}
            disabled={generating || (filteredStocks.length === 0 && filteredContainers.length === 0 && filteredTanks.length === 0)}
            className="flex items-center gap-2 whitespace-nowrap"
            style={{ background: '#16a34a' }}
          >
            <FileSpreadsheet className="w-4 h-4" />
            {generating ? 'Gerando...' : 'Exportar Excel'}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <SummaryCard title="Matérias Primas" count={filteredStocks.length} icon={Package} color="#2563eb" />
        <SummaryCard title="Vasilhames" count={filteredContainers.length} icon={BoxIcon} color="#f59e0b" />
        <SummaryCard title="Tankagem" count={filteredTanks.length} icon={Cylinder} color="#7c3aed" />
      </div>

      {/* Search */}
      <div className="mb-4 relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="Buscar em todos os estoques..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Raw Materials Table */}
      <div className="bg-card rounded-xl border border-border mb-6">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Package className="w-4 h-4" style={{ color: '#2575D1' }} />
          <h3 className="text-sm font-semibold">Estoque de Matéria Prima</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-gray-600">{filteredStocks.length}</span>
        </div>
        {filteredStocks.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhum item em estoque.</div>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Cód. MP</th>
                  <th className="px-3 py-2 text-left">Produto</th>
                  {!effectiveClient && <th className="px-3 py-2 text-left">Cliente</th>}
                  <th className="px-3 py-2 text-left">Lote</th>
                  <th className="px-3 py-2 text-left">Fornecedor</th>
                  <th className="px-3 py-2 text-right">Saldo Inicial</th>
                  <th className="px-3 py-2 text-right">Saldo Atual</th>
                  <th className="px-3 py-2 text-center">Un.</th>
                  <th className="px-3 py-2 text-center">Validade</th>
                  <th className="px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredStocks.map(item => {
                  const status = getMPStatus(item);
                  return (
                    <tr key={item.id} className="border-b border-border hover:bg-accent/30">
                      <td className="px-3 py-2 font-mono text-sm text-muted-foreground">{item.mp_code || '—'}</td>
                      <td className="px-3 py-2 text-sm font-medium text-foreground">{item.mp_name}</td>
                      {!effectiveClient && <td className="px-3 py-2 text-sm text-muted-foreground">{item.client || '—'}</td>}
                      <td className="px-3 py-2 text-sm text-muted-foreground">{item.lot || '—'}</td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">{item.supplier || '—'}</td>
                      <td className="px-3 py-2 text-right text-sm text-foreground">{fmt(item.initial_stock)}</td>
                      <td className="px-3 py-2 text-right text-sm font-bold text-foreground">{fmt(item.current_stock)}</td>
                      <td className="px-3 py-2 text-center text-sm font-bold text-foreground">{item.unit}</td>
                      <td className="px-3 py-2 text-center text-sm text-muted-foreground">{item.expiry_date ? moment(item.expiry_date).format('DD/MM/YYYY') : '—'}</td>
                      <td className="px-3 py-2 text-center">
                        {status === null ? (
                          <span className="text-sm" style={{ color: '#9CA3AF' }}>—</span>
                        ) : status === 'Vencido' ? (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Vencido</span>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Válido</span>
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

      {/* Containers Table */}
      <div className="bg-card rounded-xl border border-border mb-6">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <BoxIcon className="w-4 h-4" style={{ color: '#2575D1' }} />
          <h3 className="text-sm font-semibold">Vasilhames</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-gray-600">{filteredContainers.length}</span>
        </div>
        {filteredContainers.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhum vasilhame encontrado.</div>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">N° Embalagem</th>
                  <th className="px-3 py-2 text-left">Barril</th>
                  {!effectiveClient && <th className="px-3 py-2 text-left">Cliente</th>}
                  <th className="px-3 py-2 text-left">Produto</th>
                  <th className="px-3 py-2 text-left">Lote</th>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-right">Volume (L)</th>
                  <th className="px-3 py-2 text-right">Líquido (kg)</th>
                  <th className="px-3 py-2 text-right">Bruto (kg)</th>
                  <th className="px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredContainers.map(c => (
                  <tr key={c.id} className="border-b border-border hover:bg-accent/30">
                    <td className="px-3 py-2 text-sm font-bold text-foreground">{c.container_number || '—'}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{c.barril_number || '—'}</td>
                    {!effectiveClient && <td className="px-3 py-2 text-sm text-muted-foreground">{c.client || '—'}</td>}
                    <td className="px-3 py-2 text-sm font-medium text-foreground">{c.product || '—'}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{c.lot || '—'}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{c.type || '—'}</td>
                    <td className="px-3 py-2 text-right text-sm font-bold text-primary">{fmt3(c.volume)}</td>
                    <td className="px-3 py-2 text-right text-sm text-green-600 dark:text-green-400">{fmt3(c.net_weight)}</td>
                    <td className="px-3 py-2 text-right text-sm text-foreground">{fmt3(c.gross_weight)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.status === 'No Pátio' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                        {c.status || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tanks Table */}
      <div className="bg-card rounded-xl border border-border">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Cylinder className="w-4 h-4" style={{ color: '#2575D1' }} />
          <h3 className="text-sm font-semibold">Tankagem</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-gray-600">{filteredTanks.length}</span>
        </div>
        {filteredTanks.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma tanka encontrada.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Tanka</th>
                  {!effectiveClient && <th className="px-3 py-2 text-left">Cliente</th>}
                  <th className="px-3 py-2 text-left">Produto</th>
                  <th className="px-3 py-2 text-left">Lote</th>
                  <th className="px-3 py-2 text-right">Volume Atual (L)</th>
                  <th className="px-3 py-2 text-center">Ocupação</th>
                </tr>
              </thead>
              <tbody>
                {filteredTanks.map(t => {
                  const volume = t.current_volume || 0;
                  const capacity = t.capacity || 26000;
                  const pct = Math.min(100, Math.round((volume / capacity) * 100));
                  return (
                    <tr key={t.id} className="border-b border-border hover:bg-accent/30">
                      <td className="px-3 py-2 text-sm font-bold text-foreground">{t.name || '—'}</td>
                      {!effectiveClient && <td className="px-3 py-2 text-sm text-muted-foreground">{t.client || '—'}</td>}
                      <td className="px-3 py-2 text-sm font-medium text-foreground">{t.computed_products.join(', ') || '—'}</td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">{t.computed_lot || '—'}</td>
                      <td className="px-3 py-2 text-right text-sm font-bold text-primary">{fmt(volume)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden min-w-[60px]">
                            <div className="h-full rounded-full transition-all bg-green-600" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground shrink-0">{pct}%</span>
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
