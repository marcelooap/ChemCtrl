import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Play, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import InventoryWizard from '@/components/inventario/InventoryWizard';
import { generateInventoryPDF } from '@/lib/pdfReports';
import moment from 'moment';

const parseArr = (v) => { if (!v) return []; if (Array.isArray(v)) return v; try { const p = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(p) ? p : []; } catch { return []; } };
const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 });
const fmtDateTime = (d) => d ? moment(d).format('DD/MM/YYYY HH:mm') : '—';

export default function Inventario() {
  const { user, isReadOnly } = useOutletContext();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: inventories, loading, reload } = useRealtimeEntity('Inventory', () => base44.entities.Inventory.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [statusFilter, setStatusFilter] = useState('todos');
  const [generatingPDF, setGeneratingPDF] = useState(null);

  const filtered = inventories.filter(inv => {
    const q = search.toLowerCase();
    const matchesSearch = !q || [inv.inventory_number, inv.clients, inv.products, inv.lots, inv.opened_by].some(v => (v || '').toLowerCase().includes(q));
    const matchesStatus = statusFilter === 'todos' || inv.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusBadge = (s) => {
    const c = { 'Aberto': 'bg-blue-100 text-blue-700', 'Em andamento': 'bg-amber-100 text-amber-700', 'Finalizado': 'bg-green-100 text-green-700' };
    return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${c[s] || c['Aberto']}`}>{s}</span>;
  };

  const handleStart = async (inv) => {
    try {
      const userName = user?.nome || user?.full_name || '—';
      await base44.entities.Inventory.update(inv.id, {
        status: 'Em andamento',
        start_date: new Date().toISOString(),
        started_by: userName,
      });
      navigate(`/inventario/${inv.id}`);
    } catch (e) {
      toast({ title: 'Erro ao iniciar inventário', description: e?.message || String(e), variant: 'destructive' });
    }
  };

  const handlePDF = async (inv) => {
    setGeneratingPDF(inv.id);
    try {
      const full = await base44.entities.Inventory.get(inv.id);
      generateInventoryPDF({ ...full, items: parseArr(full.items), clients: parseArr(full.clients), products: parseArr(full.products), lots: parseArr(full.lots) });
    } catch (e) {
      toast({ title: 'Erro ao gerar PDF', variant: 'destructive' });
    } finally {
      setGeneratingPDF(null);
    }
  };

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">📋 Inventário</h1>
          <p className="text-sm text-muted-foreground">Controle de inventários físicos · {inventories.length} registro(s)</p>
        </div>
        {!isReadOnly && (
          <Button onClick={() => setShowWizard(true)} style={{ background: '#2575D1' }} className="text-white hover:opacity-90">
            <Plus className="w-4 h-4 mr-2" /> Abrir Inventário
          </Button>
        )}
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar por número, cliente, produto..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="Aberto">Aberto</SelectItem>
              <SelectItem value="Em andamento">Em andamento</SelectItem>
              <SelectItem value="Finalizado">Finalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr style={{ background: '#F3F4F6' }}>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Nº Inventário</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Data Abertura</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Cliente</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Produto</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Usuário</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-sm text-muted-foreground">Nenhum inventário encontrado.</td></tr>
                ) : filtered.map(inv => {
                  const clients = inv.clients === 'TODOS' ? 'TODOS' : parseArr(inv.clients).join(', ');
                  const products = inv.products === 'TODOS' ? 'TODOS' : parseArr(inv.products).join(', ');
                  const isFinished = inv.status === 'Finalizado';
                  const canStart = inv.status === 'Aberto' && !isReadOnly;
                  return (
                    <tr key={inv.id} className="border-b border-border hover:bg-accent/30" style={{ background: '#FFFFFF' }}>
                      <td className="px-4 py-3 font-semibold text-sm" style={{ color: '#2575D1' }}>{inv.inventory_number}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDateTime(inv.opening_date)}</td>
                      <td className="px-4 py-3 text-sm">{clients || '—'}</td>
                      <td className="px-4 py-3 text-sm">{products || '—'}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{inv.opened_by || '—'}</td>
                      <td className="px-4 py-3 text-center">{statusBadge(inv.status)}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => navigate(`/inventario/${inv.id}`)} className="p-1.5 rounded hover:bg-muted" title="Visualizar">
                            <Eye className="w-4 h-4 text-gray-400" />
                          </button>
                          {canStart && (
                            <button onClick={() => handleStart(inv)} className="p-1.5 rounded hover:bg-muted" title="Iniciar Inventário">
                              <Play className="w-4 h-4 text-green-500" />
                            </button>
                          )}
                          <button onClick={() => handlePDF(inv)} disabled={!isFinished || generatingPDF === inv.id}
                            className="p-1.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed" title={isFinished ? 'Baixar PDF' : 'PDF disponível após finalização'}>
                            {generatingPDF === inv.id
                              ? <div className="w-4 h-4 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" />
                              : <FileText className="w-4 h-4 text-gray-400" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center gap-6 text-xs text-muted-foreground">
          <span>Total: {filtered.length}</span>
          <span>Abertos: <strong>{inventories.filter(i => i.status === 'Aberto').length}</strong></span>
          <span>Em andamento: <strong>{inventories.filter(i => i.status === 'Em andamento').length}</strong></span>
          <span>Finalizados: <strong>{inventories.filter(i => i.status === 'Finalizado').length}</strong></span>
        </div>
      </div>

      <InventoryWizard open={showWizard} onOpenChange={setShowWizard} onCreated={reload} />
    </div>
  );
}
