import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext } from 'react-router-dom';
import { Search, Eye, Pencil, Truck, FileText, Printer, Loader2, Plus, ArrowUpRight, History, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { generateBoletaPDF, generateVasilhamesReportPDF } from '@/lib/pdfReports';
import { printContainerLabel } from '@/lib/labelprint';
import { zeroOutTankaStock } from '@/lib/tankUtils';
import { PACKAGING_TYPES } from '@/lib/packagingTypes';
import { brasiliaDate } from '@/lib/brasilTime';
import AddTankDialog from '@/components/vasilhames/AddTankDialog';
import HistoryDialog from '@/components/vasilhames/HistoryDialog';
import moment from 'moment';

const parseArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);

// Finds the transfer (transbordo) related to a container, whether it's an origin or a destination.
const findTransferForContainer = (container, transfers) => {
  if (!container || !transfers) return null;
  // Destination: created from a transbordo, op_number === transfer_number
  if (container.op_number && container.op_number.startsWith('TB')) {
    const t = transfers.find(tr => tr.transfer_number === container.op_number);
    if (t) return { transfer: t, role: 'destino' };
  }
  // Origin: its id appears in origins[].container_id
  const asOrigin = transfers.find(tr => {
    const origins = parseArr(tr.origins);
    return origins.some(o => o.container_id === container.id);
  });
  if (asOrigin) return { transfer: asOrigin, role: 'origem' };
  return null;
};

export default function Vasilhames() {
  const { user, isReadOnly } = useOutletContext();
  const { data: containers, loading, reload: load } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-updated_date', 500));
  const { data: productions } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 500));
  const { data: transfers } = useRealtimeEntity('Transfer', () => base44.entities.Transfer.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [showView, setShowView] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDepart, setShowDepart] = useState(false);
  const [showAddTank, setShowAddTank] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [departDate, setDepartDate] = useState(new Date().toISOString().split('T')[0]);
  const [departItem, setDepartItem] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingDepart, setSavingDepart] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const { toast } = useToast();

  const canDelete = user?.nivel === 'administrador';

  const clients = Array.from(new Set(containers.map(c => c.client).filter(Boolean))).sort();

  const filtered = containers.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || [c.product, c.client, c.container_number, c.barril_number, c.lot].some(v => (v || '').toLowerCase().includes(q));
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    const matchClient = clientFilter === 'all' || c.client === clientFilter;
    return matchSearch && matchStatus && matchClient;
  });

  const productCodeOf = (c) => {
    const r = (recipes || []).find(rc => rc.product_name === c.product);
    return (r && r.code) || c.product;
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id));
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(c => next.delete(c.id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(c => next.add(c.id));
        return next;
      });
    }
  };

  const selectedContainers = containers.filter(c => selected.has(c.id));

  const enviarDados = () => {
    const productIds = new Set(selectedContainers.map(productCodeOf));
    if (productIds.size > 1) {
      toast({
        title: 'Validação',
        description: 'Selecione apenas vasilhames do mesmo produto para gerar o relatório.',
        variant: 'destructive',
      });
      return;
    }
    setSending(true);
    try {
      const recipe = (recipes || []).find(rc => rc.product_name === selectedContainers[0].product);
      generateVasilhamesReportPDF(selectedContainers, recipe);
      toast({ title: 'Relatório gerado', description: `${selectedContainers.length} vasilhame(s) exportado(s).` });
    } catch (err) {
      toast({ title: 'Erro ao gerar relatório', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 });
  const fmtRegId = (n) => n != null ? String(n).padStart(2, '0') : '—';

  const saveEdit = async () => {
    const updates = { ...editing };
    if (editing.departure_date) {
      updates.status = 'Expedido';
    } else {
      updates.status = 'No Pátio';
    }
    setSavingEdit(true);
    try {
      await base44.entities.Container.update(editing.id, updates);
      if ((editing.type || '').toLowerCase().includes('tank') && editing.container_number) {
        await zeroOutTankaStock(editing.container_number);
      }
      setShowEdit(false); load();
      toast({ title: 'Vasilhame atualizado' });
    } catch (err) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDepart = async () => {
    setSavingDepart(true);
    try {
      await base44.entities.Container.update(departItem.id, { status: 'Expedido', departure_date: departDate });
      setShowDepart(false); load();
      toast({ title: 'Saída registrada' });
    } catch (err) {
      toast({ title: 'Erro ao registrar saída', description: err.message, variant: 'destructive' });
    } finally {
      setSavingDepart(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await base44.entities.Container.delete(deleteTarget.id);
      toast({ title: 'Vasilhame excluído' });
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast({ title: 'Erro ao excluir vasilhame', description: err.message, variant: 'destructive' });
    }
  };

  const statusBadge = (s) => {
    const c = { 'No Pátio': 'bg-amber-100 text-amber-700', 'Expedido': 'bg-green-100 text-green-700' };
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c[s] || 'bg-muted'}`}>{s}</span>;
  };

  const noPatioCount = containers.filter(c => c.status === 'No Pátio').length;
  const noPatioVolume = containers.filter(c => c.status === 'No Pátio').reduce((s, c) => s + (c.volume || 0), 0);

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">📦 Vasilhames / Envase</h1>
          <p className="text-sm text-muted-foreground">{containers.length} embalagem(ns)</p>
        </div>
        {!isReadOnly && (
          <Button onClick={() => setShowAddTank(true)} style={{ background: '#2575D1' }} className="text-white hover:opacity-90">
            <Plus className="w-4 h-4 mr-2" /> Adicionar Tanque
          </Button>
        )}
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Buscar produto, nº placa, nº barril, cliente..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="No Pátio">No Pátio</SelectItem>
              <SelectItem value="Expedido">Expedido</SelectItem>
            </SelectContent>
          </Select>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Cliente" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os clientes</SelectItem>
              {clients.map(cl => <SelectItem key={cl} value={cl}>{cl}</SelectItem>)}
            </SelectContent>
          </Select>
          {selected.size > 0 && (
            <Button onClick={enviarDados} disabled={sending} className="text-white" style={{ background: '#2575D1' }}>
              {sending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Gerando...</> : <><FileText className="w-4 h-4 mr-2" /> Enviar Dados ({selected.size})</>}
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowHistory(true)} className="gap-2 ml-auto shrink-0">
            <History className="w-4 h-4" /> Histórico
          </Button>
        </div>

        {loading ? <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div> : (
          <div className="flex-1 overflow-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10"><tr className="border-b border-gray-50 bg-muted/50/50">
                <th className="px-3 py-3 text-center w-10"><Checkbox checked={allFilteredSelected} onCheckedChange={toggleSelectAll} aria-label="Selecionar todos" /></th>
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">OP</th>
                <th className="px-4 py-3 text-left">N° Placa</th>
                <th className="px-4 py-3 text-left">N° Barril</th>
                <th className="px-4 py-3 text-left">Produto</th>
                <th className="px-4 py-3 text-left">Cliente</th>
                <th className="px-4 py-3 text-left">Lote</th>
                <th className="px-4 py-3 text-right">Vol.(L)</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-left">Saída</th>
                <th className="px-4 py-3 text-center">Ações</th>
              </tr></thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} className={`border-b border-gray-50 hover:bg-accent/30 ${selected.has(c.id) ? 'bg-blue-50/40' : ''}`}>
                    <td className="px-3 py-2.5 text-center"><Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggleSelect(c.id)} aria-label={`Selecionar ${c.container_number || c.id}`} /></td>
                    <td className="px-4 py-2.5 text-sm font-bold text-muted-foreground">{fmtRegId(c.registration_id)}</td>
                    <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>{c.op_number || <span className="text-muted-foreground">Manual</span>}</td>
                    <td className="px-4 py-2.5 text-sm font-medium">
                      <span className="inline-flex items-center gap-1">
                        {c.container_number}
                        {(() => {
                          const rel = findTransferForContainer(c, transfers);
                          if (!rel) return null;
                          return (
                            <ArrowUpRight
                              className="w-3.5 h-3.5"
                              style={{ color: '#4B0082' }}
                              title={rel.role === 'origem' ? 'Origem de transbordo' : 'Destino de transbordo'}
                            />
                          );
                        })()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-sm font-medium">{c.barril_number || '—'}</td>
                    <td className="px-4 py-2.5 text-sm">{c.product}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{c.client}</td>
                    <td className="px-4 py-2.5 text-sm">{c.lot}</td>
                    <td className="px-4 py-2.5 text-right text-sm font-medium">{fmt(c.volume)}</td>
                    <td className="px-4 py-2.5 text-center">{statusBadge(c.status)}</td>
                    <td className="px-4 py-2.5 text-sm">{c.departure_date ? brasiliaDate(c.departure_date) : '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => {
                          const recipe = (recipes || []).find(r => r.product_name === c.product);
                          const production = (productions || []).find(p => p.id === c.production_id || p.op_number === c.op_number);
                          printContainerLabel(c, recipe?.validity_days, production?.public_token);
                        }} className="p-1 rounded hover:bg-muted" title="Imprimir Etiqueta"><Printer className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        <button onClick={() => { setViewing(c); setShowView(true); }} className="p-1 rounded hover:bg-muted"><Eye className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        {!isReadOnly && <button onClick={() => { setEditing({ ...c }); setShowEdit(true); }} className="p-1 rounded hover:bg-muted"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button>}
                        {canDelete && <button onClick={() => setDeleteTarget(c)} className="p-1 rounded hover:bg-red-50" title="Excluir"><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>}
                        {!isReadOnly && c.status === 'No Pátio' && <button onClick={() => { setDepartItem(c); setDepartDate(new Date().toISOString().split('T')[0]); setShowDepart(true); }} className="p-1 rounded hover:bg-muted"><Truck className="w-3.5 h-3.5 text-green-600" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 border-t border-border flex items-center gap-6 text-xs text-muted-foreground">
          <span>Vasilhames no pátio: <strong>{noPatioCount}</strong></span>
          <span>Volume total no pátio: <strong>{fmt(noPatioVolume)} L</strong></span>
          <span>Total exibido: {filtered.length}</span>
          {selected.size > 0 && (
            <>
              <span className="font-semibold" style={{ color: '#2575D1' }}>Selecionados: {selected.size}</span>
              <button onClick={() => setSelected(new Set())} className="text-blue-500 underline">Limpar seleção</button>
            </>
          )}
        </div>
      </div>

      {/* View */}
      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Detalhe do Vasilhame</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-5">
              {/* Highlighted ID box */}
              <div className="flex items-center gap-4 p-4 rounded-lg" style={{ background: '#F0F4FF' }}>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">N° Placa</p>
                  <p className="text-lg font-bold mt-0.5">{viewing.container_number || '—'}</p>
                </div>
                <div className="w-px h-12 bg-gray-300" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">N° Barril</p>
                  <p className="text-lg font-bold mt-0.5">{viewing.barril_number || '—'}</p>
                </div>
                <div className="w-px h-12 bg-gray-300" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">ID Reg.</p>
                  <p className="text-lg font-bold mt-0.5" style={{ color: '#2575D1' }}>{fmtRegId(viewing.registration_id)}</p>
                </div>
              </div>

              {/* Section 1 — Dados da OP */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Dados da OP</h4>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm bg-muted/50/50 rounded-lg p-4">
                  <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">OP</span><span className="font-bold" style={{ color: '#2575D1' }}>{viewing.op_number || '—'}</span></div>
                  <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">Lote</span><span className="font-medium">{viewing.lot || '—'}</span></div>
                  <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">Produto</span><span className="font-bold text-right">{viewing.product || '—'}</span></div>
                  <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">Cliente</span><span className="font-medium text-right">{viewing.client || '—'}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span>{statusBadge(viewing.status)}</div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Data Saída</span><span className="font-medium">{viewing.departure_date ? moment(viewing.departure_date).format('DD/MM/YYYY') : '—'}</span></div>
                </div>
              </div>

              {/* Section 2 — Dados da Embalagem */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Dados da Embalagem</h4>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Tipo</p><p className="font-bold">{viewing.type || '—'}</p></div>
                  <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Volume (L)</p><p className="font-bold text-base" style={{ color: '#2575D1' }}>{fmt(viewing.volume)}</p></div>
                  <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Tara (kg)</p><p className="font-medium">{fmt(viewing.tare)}</p></div>
                  <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Peso Líquido (kg)</p><p className="font-bold text-base text-green-700">{fmt(viewing.net_weight)}</p></div>
                  <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Peso Bruto (kg)</p><p className="font-bold text-base">{fmt(viewing.gross_weight)}</p></div>
                  <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Menor Teste</p><p className="font-medium">{viewing.min_test_date ? moment(viewing.min_test_date).format('DD/MM/YYYY') : '—'}</p></div>
                </div>
              </div>

              {/* Section 3 — Logística */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Logística</h4>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm bg-muted/50/50 rounded-lg p-4">
                  <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">Lacres</span><span className="font-medium text-right">{viewing.seals || '—'}</span></div>
                  <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">Eslinga</span><span className="font-medium">{viewing.sling || '—'}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">GPS</span><span className="font-medium">{viewing.gps || '—'}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Responsável</span><span className="font-medium">{viewing.operator || '—'}</span></div>
                </div>
              </div>

              {/* Section 4 — Transbordo (se houver) */}
              {(() => {
                const rel = findTransferForContainer(viewing, transfers);
                if (!rel) return null;
                const { transfer: t, role } = rel;
                const origins = parseArr(t.origins);
                const dests = parseArr(t.destinations);
                return (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1 h-4 rounded" style={{ background: '#7C3AED' }} />
                      <h4 className="text-xs font-bold uppercase tracking-wide" style={{ color: '#7C3AED' }}>Transbordo</h4>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#EDE9FE', color: '#6D28D9' }}>
                        {role === 'origem' ? 'Origem' : 'Destino'}
                      </span>
                    </div>
                    <div className="bg-muted/50/50 rounded-lg p-4 space-y-3 text-sm">
                      <div className="grid grid-cols-3 gap-3 pb-2 border-b border-border">
                        <div><p className="text-xs text-muted-foreground">Registro</p><p className="font-bold" style={{ color: '#7C3AED' }}>{t.transfer_number || '—'}</p></div>
                        <div><p className="text-xs text-muted-foreground">Data</p><p className="font-medium">{t.date ? moment(t.date).format('DD/MM/YYYY') : '—'}</p></div>
                        <div><p className="text-xs text-muted-foreground">Tipo</p><p className="font-medium">{dests[0]?.type || t.destination_type || '—'}</p></div>
                      </div>
                      {origins.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2">Embalagens de Origem</p>
                          <div className="space-y-1.5">
                            {origins.map((o, i) => (
                              <div key={i} className="flex items-center gap-3 text-xs bg-card rounded px-3 py-1.5 border border-border">
                                <span className="font-semibold" style={{ color: '#2575D1' }}>{o.container_number || '—'}</span>
                                <span className="text-muted-foreground">{o.barril_number || '—'}</span>
                                <span className="text-muted-foreground">Lote: {o.lot || '—'}</span>
                                <span className="ml-auto font-medium">Vol. retirado: {fmt(o.volume_used)} L</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {dests.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2">Destino(s)</p>
                          <div className="space-y-1.5">
                            {dests.map((d, i) => (
                              <div key={i} className="flex items-center gap-3 text-xs bg-card rounded px-3 py-1.5 border border-border">
                                <span className="font-semibold" style={{ color: '#2575D1' }}>{d.placa || '—'}</span>
                                <span className="text-muted-foreground">{d.barril || '—'}</span>
                                <span className="text-muted-foreground">{d.packaging_type || d.type || '—'}</span>
                                <span className="ml-auto font-medium">Vol.: {fmt(d.volume)} L</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          <div className="flex justify-between mt-4 pt-4 border-t">
            <Button variant="outline" onClick={() => generateBoletaPDF(viewing)} className="gap-2">
              <FileText className="w-4 h-4" /> Gerar Boleta
            </Button>
            <Button variant="outline" onClick={() => setShowView(false)}>Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar Vasilhame — {editing?.product}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">N° Placa</label>
                <Input value={editing.container_number || ''} onChange={e => setEditing({ ...editing, container_number: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">N° Barril</label>
                <Input value={editing.barril_number || ''} onChange={e => setEditing({ ...editing, barril_number: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Tipo</label>
                <Select value={editing.type || ''} onValueChange={v => setEditing({ ...editing, type: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {PACKAGING_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Lote</label>
                <Input value={editing.lot || ''} onChange={e => setEditing({ ...editing, lot: e.target.value })} placeholder="Lote do vasilhame" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Volume (L)</label>
                <Input type="number" value={editing.volume || ''} onChange={e => setEditing({ ...editing, volume: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Lacres</label>
                <Input value={editing.seals || ''} onChange={e => setEditing({ ...editing, seals: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Tara (kg)</label>
                <Input type="number" value={editing.tare || ''} onChange={e => setEditing({ ...editing, tare: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Eslinga</label>
                <Input value={editing.sling || ''} onChange={e => setEditing({ ...editing, sling: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">GPS</label>
                <Input value={editing.gps || ''} onChange={e => setEditing({ ...editing, gps: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Data Menor Teste</label>
                <Input type="date" value={editing.min_test_date || ''} onChange={e => setEditing({ ...editing, min_test_date: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Data de Saída</label>
                <Input type="date" value={editing.departure_date || ''} onChange={e => setEditing({ ...editing, departure_date: e.target.value })} />
                <p className="text-xs text-muted-foreground mt-1">Ao definir uma data, o status muda para "Expedido". Remova a data para reverter para "No Pátio".</p>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowEdit(false)} disabled={savingEdit}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={savingEdit} style={{ background: '#2575D1', color: 'white' }}>
              {savingEdit ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</> : 'Salvar Alterações'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Depart */}
      <Dialog open={showDepart} onOpenChange={setShowDepart}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Registrar Saída</DialogTitle></DialogHeader>
          <div><label className="text-xs font-medium text-muted-foreground">Data de Saída</label><Input type="date" value={departDate} onChange={e => setDepartDate(e.target.value)} /></div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowDepart(false)} disabled={savingDepart}>Cancelar</Button>
            <Button onClick={confirmDepart} disabled={savingDepart} style={{ background: '#2575D1', color: 'white' }}>
              {savingDepart ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Confirmando...</> : 'Confirmar Saída'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Adicionar Tanque */}
      <AddTankDialog open={showAddTank} onOpenChange={setShowAddTank} onSaved={load} />

      {/* Histórico */}
      <HistoryDialog
        open={showHistory}
        onOpenChange={setShowHistory}
        containers={containers}
        transfers={transfers}
        productions={productions}
        recipes={recipes}
      />

      <ConfirmDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Excluir Vasilhame"
        message={`Tem certeza que deseja excluir o vasilhame ${deleteTarget?.container_number || ''}${deleteTarget?.barril_number ? ` / Barril ${deleteTarget.barril_number}` : ''}? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        confirmColor="#DC2626"
        onConfirm={confirmDelete} />
    </div>
  );
}
