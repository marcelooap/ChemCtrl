import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Eye, Building2, Package, Box as BoxIcon, Factory } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import ProductionTrackingTable from '@/components/production/ProductionTrackingTable';
import RawMaterialViewDialog from '@/components/estoque/RawMaterialViewDialog';
import ContainerViewDialog from '@/components/vasilhames/ContainerViewDialog';
import { canUseClientFilter, getUserClient } from '@/lib/permissions';
import moment from 'moment';

const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 });
const fmt3 = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 });

export default function TelaClientes() {
  const { user } = useOutletContext();
  const [searchParams] = useSearchParams();
  const highlightProdId = searchParams.get('prod');
  const { data: allProductions, loading } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 500));
  const { data: allStocks } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 500));
  const { data: allContainers } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const [selectedClient, setSelectedClient] = useState('all');
  const [searchMP, setSearchMP] = useState('');
  const [searchContainer, setSearchContainer] = useState('');
  const [viewingMP, setViewingMP] = useState(null);
  const [viewingContainer, setViewingContainer] = useState(null);

  const externoClient = getUserClient(user);
  const showClientFilter = canUseClientFilter(user);
  const effectiveClient = externoClient || (showClientFilter && selectedClient !== 'all' ? selectedClient : null);

  const clientList = useMemo(() => {
    const allClients = new Set();
    [...allProductions, ...allStocks, ...allContainers].forEach(i => { if (i.client) allClients.add(i.client); });
    return Array.from(allClients).sort();
  }, [allProductions, allStocks, allContainers]);

  const productions = useMemo(() => effectiveClient ? allProductions.filter(p => p.client === effectiveClient) : allProductions, [allProductions, effectiveClient]);
  const stocks = useMemo(() => effectiveClient ? allStocks.filter(s => s.client === effectiveClient) : allStocks, [allStocks, effectiveClient]);
  const containers = useMemo(() => effectiveClient ? allContainers.filter(c => c.client === effectiveClient) : allContainers, [allContainers, effectiveClient]);

  const inProgressProds = useMemo(() =>
    productions.filter(p => !['Finalizado', 'Cancelado'].includes(p.status)),
    [productions]
  );

  const patiotContainers = useMemo(() =>
    containers.filter(c => c.status === 'No Pátio'),
    [containers]
  );

  const filteredStocks = useMemo(() => {
    const q = searchMP.toLowerCase();
    if (!q) return stocks;
    return stocks.filter(s => [s.mp_name, s.mp_code, s.lot, s.client].some(v => (v || '').toLowerCase().includes(q)));
  }, [stocks, searchMP]);

  const filteredContainers = useMemo(() => {
    const q = searchContainer.toLowerCase();
    if (!q) return patiotContainers;
    return patiotContainers.filter(c => [c.container_number, c.barril_number, c.lot, c.product].some(v => (v || '').toLowerCase().includes(q)));
  }, [patiotContainers, searchContainer]);

  const getMPStatus = (item) => {
    if (!item.expiry_date) return null;
    if (moment(item.expiry_date).isBefore(moment())) return 'Vencido';
    return 'Válido';
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Tela Clientes</h1>
          <p className="text-sm text-muted-foreground">
            {effectiveClient ? `Cliente: ${effectiveClient}` : 'Todos os clientes'} · Acompanhamento de produção, estoque e vasilhames
          </p>
        </div>
        {showClientFilter && (
          <div className="w-64">
            <Select value={selectedClient} onValueChange={setSelectedClient}>
              <SelectTrigger><SelectValue placeholder="Todos os clientes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os clientes</SelectItem>
                {clientList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Q1 — Production Tracking */}
      <div className="bg-card rounded-xl border border-border mb-6">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Factory className="w-4 h-4" style={{ color: '#2575D1' }} />
          <h3 className="text-sm font-semibold">Produções em andamento</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-gray-600">{inProgressProds.length}</span>
        </div>
        <ProductionTrackingTable
          productions={inProgressProds}
          showBypass={false}
          showClient={!effectiveClient}
          highlightProdId={highlightProdId}
          maxRows={highlightProdId ? inProgressProds.length : 10}
        />
      </div>

      {/* Q2 — Raw Material Stock */}
      <div className="bg-card rounded-xl border border-border mb-6">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4" style={{ color: '#2575D1' }} />
            <h3 className="text-sm font-semibold">Estoque de Matéria Prima</h3>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-gray-600">{filteredStocks.length}</span>
          </div>
          <div className="relative w-40">
            <Input placeholder="Buscar..." value={searchMP} onChange={e => setSearchMP(e.target.value)} className="h-7 text-xs" />
          </div>
        </div>
        {filteredStocks.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhum item em estoque.</div>
        ) : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold">ID</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold">Cód. MP</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold">Produto</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold">Lote</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold">Saldo Inicial</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold">Saldo Atual</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold">Un.</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold">Status</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold">Ver</th>
                </tr>
              </thead>
              <tbody>
                {filteredStocks.map(item => {
                  const status = getMPStatus(item);
                  return (
                    <tr key={item.id} className="border-b border-border hover:bg-accent/30">
                      <td className="px-3 py-2 text-sm font-medium text-primary">{item.entry_id || '—'}</td>
                      <td className="px-3 py-2 font-mono text-sm text-muted-foreground">{item.mp_code || '—'}</td>
                      <td className="px-3 py-2 text-sm font-medium text-foreground">{item.mp_name}</td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">{item.lot || '—'}</td>
                      <td className="px-3 py-2 text-right text-sm text-foreground">{fmt(item.initial_stock)}</td>
                      <td className="px-3 py-2 text-right text-sm font-bold text-foreground">{fmt(item.current_stock)}</td>
                      <td className="px-3 py-2 text-center text-sm font-bold text-foreground">{item.unit}</td>
                      <td className="px-3 py-2 text-center">
                        {status === null ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : status === 'Vencido' ? (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Vencido</span>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Válido</span>
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
        )}
      </div>

      {/* Q3 — Containers in Pátio */}
      <div className="bg-card rounded-xl border border-border">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BoxIcon className="w-4 h-4" style={{ color: '#2575D1' }} />
            <h3 className="text-sm font-semibold">Vasilhames no Pátio</h3>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-gray-600">{filteredContainers.length}</span>
          </div>
          <div className="relative w-40">
            <Input placeholder="Buscar..." value={searchContainer} onChange={e => setSearchContainer(e.target.value)} className="h-7 text-xs" />
          </div>
        </div>
        {filteredContainers.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhum vasilhame no pátio.</div>
        ) : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold">N° Embalagem</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold">Produto</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold">Volume (L)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold">Massa (kg)</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold">Lote</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold">Ver</th>
                </tr>
              </thead>
              <tbody>
                {filteredContainers.map(c => (
                  <tr key={c.id} className="border-b border-border hover:bg-accent/30">
                    <td className="px-3 py-2 text-sm font-bold text-foreground">{c.container_number || '—'}</td>
                    <td className="px-3 py-2 text-sm text-foreground">{c.product || '—'}</td>
                    <td className="px-3 py-2 text-right text-sm font-bold text-primary">{fmt3(c.volume)}</td>
                    <td className="px-3 py-2 text-right text-sm font-bold text-green-600 dark:text-green-400">{fmt3(c.net_weight)}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{c.lot || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => setViewingContainer(c)} className="p-1 rounded hover:bg-accent"><Eye className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RawMaterialViewDialog item={viewingMP} open={!!viewingMP} onOpenChange={(open) => { if (!open) setViewingMP(null); }} readOnly />
      <ContainerViewDialog container={viewingContainer} open={!!viewingContainer} onOpenChange={(open) => { if (!open) setViewingContainer(null); }} readOnly />
    </div>
  );
}
