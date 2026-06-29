import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext, Link } from 'react-router-dom';
import { Search, Eye, Pencil, Truck, Cylinder, FileText, Printer } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { generateBoletaPDF } from '@/lib/pdfReports';
import { printContainerLabel } from '@/lib/labelPrint';
import { zeroOutTankaStock } from '@/lib/tankUtils';
import { brasiliaDate } from '@/lib/brasilTime';
import moment from 'moment';

export default function Vasilhames() {
  const { isReadOnly } = useOutletContext();
  const { data: containers, loading, reload: load } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-updated_date', 500));
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showView, setShowView] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDepart, setShowDepart] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [departDate, setDepartDate] = useState(new Date().toISOString().split('T')[0]);
  const [departItem, setDepartItem] = useState(null);
  const { toast } = useToast();

  const filtered = containers.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || [c.product, c.client, c.container_number, c.barril_number, c.lot].some(v => (v || '').toLowerCase().includes(q));
    const matchType = typeFilter === 'all' || c.type === typeFilter;
    return matchSearch && matchType;
  });

  const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 });
  const fmtRegId = (n) => n != null ? String(n).padStart(2, '0') : '—';

  const saveEdit = async () => {
    const updates = { ...editing };
    if (editing.departure_date) {
      updates.status = 'Expedido';
    } else {
      updates.status = 'No Pátio';
    }
    await base44.entities.Container.update(editing.id, updates);
    // If this vasilhame is a tankagem, zero out any MP stock previously stored in that tanka
    if ((editing.type || '').toLowerCase().includes('tank') && editing.container_number) {
      await zeroOutTankaStock(editing.container_number);
    }
    setShowEdit(false); load();
    toast({ title: 'Vasilhame atualizado' });
  };

  const confirmDepart = async () => {
    await base44.entities.Container.update(departItem.id, { status: 'Expedido', departure_date: departDate });
    setShowDepart(false); load();
    toast({ title: 'Saída registrada' });
  };

  const statusBadge = (s) => {
    const c = { 'No Pátio': 'bg-amber-100 text-amber-700', 'Expedido': 'bg-green-100 text-green-700' };
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c[s] || 'bg-gray-100'}`}>{s}</span>;
  };

  const noPatioCount = containers.filter(c => c.status === 'No Pátio').length;
  const noPatioVolume = containers.filter(c => c.status === 'No Pátio').reduce((s, c) => s + (c.volume || 0), 0);

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#1A1A2E' }}>📦 Vasilhames / Envase</h1>
          <p className="text-sm text-muted-foreground">{containers.length} embalagem(ns)</p>
        </div>
        <Link to="/tankagem"><Button variant="outline"><Cylinder className="w-4 h-4 mr-2" /> Tankagem</Button></Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Buscar produto, nº placa, nº barril, cliente..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="Contentor">Contentor</SelectItem>
              <SelectItem value="Tambor">Tambor</SelectItem>
              <SelectItem value="IBC 1000L">IBC 1000L</SelectItem>
              <SelectItem value="TANKA">TANKA</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" /></div> : (
          <div className="flex-1 overflow-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10"><tr className="border-b border-gray-50 bg-gray-50/50">
                <th className="px-4 py-3 text-left">ID Reg.</th>
                <th className="px-4 py-3 text-left">OP</th>
                <th className="px-4 py-3 text-left">N° Placa</th>
                <th className="px-4 py-3 text-left">N° Barril</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-left">Produto</th>
                <th className="px-4 py-3 text-left">Cliente</th>
                <th className="px-4 py-3 text-left">Lote</th>
                <th className="px-4 py-3 text-right">Vol.(L)</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-left">Dt. Saída</th>
                <th className="px-4 py-3 text-center">Ações</th>
              </tr></thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-sm font-bold text-muted-foreground">{fmtRegId(c.registration_id)}</td>
                    <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>{c.op_number}</td>
                    <td className="px-4 py-2.5 text-sm font-medium">{c.container_number}</td>
                    <td className="px-4 py-2.5 text-sm font-medium">{c.barril_number || '—'}</td>
                    <td className="px-4 py-2.5 text-sm">{c.type}</td>
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
                          printContainerLabel(c, recipe?.validity_days);
                        }} className="p-1 rounded hover:bg-gray-100" title="Imprimir Etiqueta"><Printer className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        <button onClick={() => { setViewing(c); setShowView(true); }} className="p-1 rounded hover:bg-gray-100"><Eye className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        {!isReadOnly && <button onClick={() => { setEditing({ ...c }); setShowEdit(true); }} className="p-1 rounded hover:bg-gray-100"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button>}
                        {!isReadOnly && c.status === 'No Pátio' && <button onClick={() => { setDepartItem(c); setDepartDate(new Date().toISOString().split('T')[0]); setShowDepart(true); }} className="p-1 rounded hover:bg-gray-100"><Truck className="w-3.5 h-3.5 text-green-600" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-6 text-xs text-muted-foreground">
          <span>Vasilhames no pátio: <strong>{noPatioCount}</strong></span>
          <span>Volume total no pátio: <strong>{fmt(noPatioVolume)} L</strong></span>
          <span>Total exibido: {filtered.length}</span>
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
                  <p className="text-lg font-bold mt-0.5" style={{ color: '#1A1A2E' }}>{viewing.container_number || '—'}</p>
                </div>
                <div className="w-px h-12 bg-gray-300" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">N° Barril</p>
                  <p className="text-lg font-bold mt-0.5" style={{ color: '#1A1A2E' }}>{viewing.barril_number || '—'}</p>
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
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm bg-gray-50/50 rounded-lg p-4">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2"><span className="text-muted-foreground">OP</span><span className="font-bold" style={{ color: '#2575D1' }}>{viewing.op_number || '—'}</span></div>
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2"><span className="text-muted-foreground">Lote</span><span className="font-medium">{viewing.lot || '—'}</span></div>
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2"><span className="text-muted-foreground">Produto</span><span className="font-bold text-right">{viewing.product || '—'}</span></div>
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2"><span className="text-muted-foreground">Cliente</span><span className="font-medium text-right">{viewing.client || '—'}</span></div>
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
                  <div className="bg-gray-50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Tipo</p><p className="font-bold">{viewing.type || '—'}</p></div>
                  <div className="bg-gray-50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Volume (L)</p><p className="font-bold text-base" style={{ color: '#2575D1' }}>{fmt(viewing.volume)}</p></div>
                  <div className="bg-gray-50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Tara (kg)</p><p className="font-medium">{fmt(viewing.tare)}</p></div>
                  <div className="bg-gray-50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Peso Líquido (kg)</p><p className="font-bold text-base text-green-700">{fmt(viewing.net_weight)}</p></div>
                  <div className="bg-gray-50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Peso Bruto (kg)</p><p className="font-bold text-base">{fmt(viewing.gross_weight)}</p></div>
                  {viewing.min_test_date && <div className="bg-gray-50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Menor Teste</p><p className="font-medium">{moment(viewing.min_test_date).format('DD/MM/YYYY')}</p></div>}
                </div>
              </div>

              {/* Section 3 — Logística */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Logística</h4>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm bg-gray-50/50 rounded-lg p-4">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2"><span className="text-muted-foreground">Lacres</span><span className="font-medium text-right">{viewing.seals || '—'}</span></div>
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2"><span className="text-muted-foreground">Eslinga</span><span className="font-medium">{viewing.sling || '—'}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">GPS</span><span className="font-medium">{viewing.gps || '—'}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Responsável</span><span className="font-medium">{viewing.operator || '—'}</span></div>
                </div>
              </div>
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
                <Input value={editing.type || ''} onChange={e => setEditing({ ...editing, type: e.target.value })} />
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
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancelar</Button>
            <Button onClick={saveEdit} style={{ background: '#2575D1', color: 'white' }}>Salvar Alterações</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Depart */}
      <Dialog open={showDepart} onOpenChange={setShowDepart}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Registrar Saída</DialogTitle></DialogHeader>
          <div><label className="text-xs font-medium text-muted-foreground">Data de Saída</label><Input type="date" value={departDate} onChange={e => setDepartDate(e.target.value)} /></div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowDepart(false)}>Cancelar</Button>
            <Button onClick={confirmDepart} style={{ background: '#2575D1', color: 'white' }}>Confirmar Saída</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
