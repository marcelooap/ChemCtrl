import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { Search, Eye, Pencil, FileText, Ban } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { generateProductionPDF } from '@/lib/pdfReports';
import { brasiliaDate, brasiliaDateTime } from '@/lib/brasilTime';
import moment from 'moment';

const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const StatusBadge = ({ status }) => {
  const c = {
    'Aguardando Início': 'bg-gray-100 text-gray-700',
    'Em Produção': 'bg-blue-100 text-blue-700',
    'Qualidade': 'bg-amber-100 text-amber-700',
    'Envase': 'bg-purple-100 text-purple-700',
    'Finalizado': 'bg-green-100 text-green-700',
    'Cancelado': 'bg-red-100 text-red-700',
  };
  return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${c[status] || 'bg-gray-100'}`}>{status}</span>;
};

export default function Producoes() {
  const { data: productions, loading, reload: load } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 500));
  const { data: containers } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const { data: stocks } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showView, setShowView] = useState(false);
  const [showEditPkg, setShowEditPkg] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [viewContainers, setViewContainers] = useState([]);
  const [editingPkg, setEditingPkg] = useState(null);
  const [pkgValue, setPkgValue] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);
  const { toast } = useToast();

  const filtered = productions.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || [p.op_number, p.product, p.client, p.lot].some(v => (v || '').toLowerCase().includes(q));
    const endDate = p.end_time ? moment(p.end_time) : null;
    const matchFrom = !dateFrom || (endDate && endDate.isSameOrAfter(moment(dateFrom), 'day'));
    const matchTo = !dateTo || (endDate && endDate.isSameOrBefore(moment(dateTo), 'day'));
    return matchSearch && matchFrom && matchTo;
  });

  const totalOPs = filtered.length;
  const activeOPs = filtered.filter(p => !['Finalizado', 'Cancelado'].includes(p.status)).length;
  const totalVol = filtered.filter(p => p.status === 'Finalizado').reduce((s, p) => s + (p.volume || 0), 0);
  const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 });
  const fmtMoney = (n) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  const savePkg = async () => {
    const price = parseFloat(unitPrice) || 0;
    const totalValue = price * (editingPkg.mass || 0);
    await base44.entities.Production.update(editingPkg.id, {
      packaging_type: pkgValue,
      packaging_info: pkgValue,
      unit_price: price,
      total_value: totalValue,
    });
    setShowEditPkg(false);
    load();
    toast({ title: 'Embalagem atualizada com sucesso' });
  };

  const canCancel = (status) => ['Aguardando Início', 'Em Produção'].includes(status);

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    try {
      const mps = parseArr(cancelTarget.raw_materials_used);
      // Return MP stock to inventory — aggregate by stock_id
      const stockReturns = {};
      for (const mp of mps) {
        if (mp.stock_id && mp.qty_fiscal > 0) {
          stockReturns[mp.stock_id] = (stockReturns[mp.stock_id] || 0) + mp.qty_fiscal;
        }
      }
      for (const [stockId, returnQty] of Object.entries(stockReturns)) {
        const stock = stocks.find(s => s.id === stockId);
        if (stock) {
          const newStock = parseFloat(((stock.current_stock || 0) + returnQty).toFixed(3));
          await base44.entities.RawMaterialStock.update(stockId, { current_stock: newStock });
        }
      }

      // Update linked order back to Pendente if it was in production
      if (cancelTarget.order_id) {
        await base44.entities.Order.update(cancelTarget.order_id, { status: 'Pendente' }).catch(() => {});
      }

      await base44.entities.Production.update(cancelTarget.id, {
        status: 'Cancelado',
        end_time: cancelTarget.end_time || new Date().toISOString(),
      });

      toast({ title: `OP ${cancelTarget.op_number} cancelada`, description: 'Matérias primas devolvidas ao estoque.' });
      setCancelTarget(null);
      load();
    } catch (err) {
      toast({ title: 'Erro ao cancelar OP', variant: 'destructive' });
    }
  };

  const openView = (p) => {
    setViewing(p);
    setViewContainers(containers.filter(c => c.op_number === p.op_number));
    setShowView(true);
  };

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      <div className="mb-4">
        <h1 className="text-2xl font-bold" style={{ color: '#1A1A2E' }}>📊 Produções</h1>
        <p className="text-sm text-muted-foreground">{productions.length} produção(ões) registrada(s)</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex-1 flex flex-col overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar por OP, produto, lote, cliente..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Data finaliz. de</span>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-9 text-xs" />
            <span>até</span>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-9 text-xs" />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-blue-500 underline text-xs">Limpar</button>
            )}
          </div>
        </div>

        {/* Scrollable Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" /></div>
          ) : (
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-gray-50">
                  <th className="px-4 py-3 text-left">OP</th>
                  <th className="px-4 py-3 text-left">Data Finaliz.</th>
                  <th className="px-4 py-3 text-left">Produto</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Lote</th>
                  <th className="px-4 py-3 text-right">Volume (L)</th>
                  <th className="px-4 py-3 text-left">Embalagem</th>
                  <th className="px-4 py-3 text-center">Etapa</th>
                  <th className="px-4 py-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>{p.op_number}</td>
                    <td className="px-4 py-2.5 text-sm">{p.end_time ? brasiliaDate(p.end_time) : '—'}</td>
                    <td className="px-4 py-2.5 font-medium text-sm">{p.product}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{p.client}</td>
                    <td className="px-4 py-2.5 text-sm">{p.lot}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-sm">{fmt(p.volume)}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{p.packaging_info || p.packaging_type || '—'}</td>
                    <td className="px-4 py-2.5 text-center"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openView(p)} className="p-1 rounded hover:bg-gray-100"><Eye className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        <button onClick={() => { setEditingPkg(p); setPkgValue(p.packaging_info || p.packaging_type || ''); setUnitPrice(p.unit_price || ''); setShowEditPkg(true); }} className="p-1 rounded hover:bg-gray-100"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        {canCancel(p.status) && (
                          <button onClick={() => setCancelTarget(p)} className="p-1 rounded hover:bg-red-50" title="Cancelar OP"><Ban className="w-3.5 h-3.5 text-red-400" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Fixed Footer */}
        <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-6 text-xs text-muted-foreground">
          <span>Total de OPs: <strong>{totalOPs}</strong></span>
          <span>OPs ativas: <strong>{activeOPs}</strong></span>
          <span>Volume total finalizado: <strong>{fmt(totalVol)} L</strong></span>
        </div>
      </div>

      {/* View Dialog */}
      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>OP {viewing?.op_number} · {viewing?.product}</DialogTitle></DialogHeader>
          {viewing && (
            <div>
              <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                <div><p className="text-xs text-muted-foreground">OP</p><p className="font-bold" style={{ color: '#2575D1' }}>{viewing.op_number}</p></div>
                <div><p className="text-xs text-muted-foreground">Lote</p><p className="font-medium">{viewing.lot}</p></div>
                <div><p className="text-xs text-muted-foreground">Data Finalização</p><p className="font-medium">{viewing.end_time ? brasiliaDateTime(viewing.end_time) : '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Produto</p><p className="font-bold">{viewing.product}</p></div>
                <div><p className="text-xs text-muted-foreground">Cliente</p><p className="font-medium">{viewing.client}</p></div>
                <div><p className="text-xs text-muted-foreground">Volume</p><p className="font-medium">{fmt(viewing.volume)} L</p></div>
                <div><p className="text-xs text-muted-foreground">Massa</p><p className="font-bold">{fmt(viewing.mass)} kg</p></div>
                <div><p className="text-xs text-muted-foreground">Revisão</p><p className="font-medium">{viewing.recipe_revision}</p></div>
                <div><p className="text-xs text-muted-foreground">Prioridade</p><p className="font-medium">{viewing.priority}</p></div>
                <div><p className="text-xs text-muted-foreground">Etapa</p><StatusBadge status={viewing.status} /></div>
                <div><p className="text-xs text-muted-foreground">Preço Unit.</p><p className="font-bold" style={{ color: '#2575D1' }}>R$ {(viewing.unit_price || 0).toFixed(2)}/kg</p></div>
                <div><p className="text-xs text-muted-foreground">Valor Total</p><p className="font-bold">{fmtMoney(viewing.total_value)}</p></div>
              </div>

              <h4 className="text-sm font-semibold mt-4 mb-2">Matérias Primas Utilizadas</h4>
              <table className="w-full text-sm border rounded-lg overflow-hidden mb-4">
                <thead><tr className="bg-gray-50 text-xs font-semibold text-muted-foreground">
                  <th className="px-3 py-2 text-left">Código</th>
                  <th className="px-3 py-2 text-left">MP</th>
                  <th className="px-3 py-2 text-left">Lote</th>
                  <th className="px-3 py-2 text-right">Qtd. Fiscal</th>
                  <th className="px-3 py-2 text-right">Qtd. Op. (kg)</th>
                </tr></thead>
                <tbody>
                  {parseArr(viewing.raw_materials_used).map((m, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs" style={{ color: '#2575D1' }}>{m.mp_code}</td>
                      <td className="px-3 py-2">{m.mp_name}</td>
                      <td className="px-3 py-2">{m.lot || '—'}</td>
                      <td className="px-3 py-2 text-right">{fmt(m.qty_fiscal)} kg</td>
                      <td className="px-3 py-2 text-right font-medium">{fmt(m.qty_operational)} kg</td>
                    </tr>
                  ))}
                  <tr className="border-t bg-gray-50 font-bold" style={{ color: '#2575D1' }}>
                    <td colSpan={3} className="px-3 py-2">TOTAL</td>
                    <td className="px-3 py-2 text-right">{fmt(parseArr(viewing.raw_materials_used).reduce((s, m) => s + (m.qty_fiscal || 0), 0))} kg</td>
                    <td className="px-3 py-2 text-right">{fmt(parseArr(viewing.raw_materials_used).reduce((s, m) => s + (m.qty_operational || 0), 0))} kg</td>
                  </tr>
                </tbody>
              </table>

              {viewContainers.length > 0 && (
                <>
                  <h4 className="text-sm font-semibold mb-2">Embalagens Envasadas</h4>
                  <table className="w-full text-sm border rounded-lg overflow-hidden">
                    <thead><tr className="bg-gray-50 text-xs font-semibold text-muted-foreground">
                      <th className="px-3 py-2 text-left">Nº Embalagem</th>
                      <th className="px-3 py-2 text-left">Tipo</th>
                      <th className="px-3 py-2 text-right">Volume (L)</th>
                      <th className="px-3 py-2 text-right">Líquido (kg)</th>
                      <th className="px-3 py-2 text-right">Bruto (kg)</th>
                    </tr></thead>
                    <tbody>
                      {viewContainers.map((c, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2 font-medium">{c.container_number || '—'}</td>
                          <td className="px-3 py-2">{c.type || '—'}</td>
                          <td className="px-3 py-2 text-right">{fmt(c.volume)}</td>
                          <td className="px-3 py-2 text-right">{fmt(c.net_weight)}</td>
                          <td className="px-3 py-2 text-right">{fmt(c.gross_weight)}</td>
                        </tr>
                      ))}
                      <tr className="border-t bg-gray-50 font-bold" style={{ color: '#2575D1' }}>
                        <td colSpan={2} className="px-3 py-2">TOTAL</td>
                        <td className="px-3 py-2 text-right">{fmt(viewContainers.reduce((s, c) => s + (c.volume || 0), 0))} L</td>
                        <td className="px-3 py-2 text-right">{fmt(viewContainers.reduce((s, c) => s + (c.net_weight || 0), 0))} kg</td>
                        <td className="px-3 py-2 text-right">{fmt(viewContainers.reduce((s, c) => s + (c.gross_weight || 0), 0))} kg</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
          <div className="flex justify-between mt-4">
            <Button variant="outline" onClick={() => generateProductionPDF(viewing, viewContainers)} className="gap-2">
              <FileText className="w-4 h-4" /> Gerar PDF
            </Button>
            <Button variant="outline" onClick={() => setShowView(false)}>Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Packaging Dialog */}
      <Dialog open={showEditPkg} onOpenChange={setShowEditPkg}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Editar Produção — {editingPkg?.op_number}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Embalagem</label>
              <Input value={pkgValue} onChange={e => setPkgValue(e.target.value)} placeholder="Ex: Tambor 200 L" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Preço Unitário (R$/kg)</label>
              <Input type="number" step="0.01" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Valor Total (auto)</label>
              <Input value={fmtMoney((parseFloat(unitPrice) || 0) * (editingPkg?.mass || 0))} readOnly className="bg-gray-50 font-semibold" />
              <p className="text-xs text-muted-foreground mt-1">{fmt(editingPkg?.mass || 0)} kg × R$ {(parseFloat(unitPrice) || 0).toFixed(2)}</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowEditPkg(false)}>Cancelar</Button>
            <Button onClick={savePkg} style={{ background: '#2575D1', color: 'white' }}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
        title="Cancelar OP"
        message={`Tem certeza que deseja cancelar a OP "${cancelTarget?.op_number}"?\n\nO estoque de matérias primas será devolvido. A OP será mantida para registro mas não contará nos volumes e receitas do mês.`}
        onConfirm={confirmCancel}
        confirmLabel="Sim, cancelar"
        confirmColor="#DC2626"
      />
    </div>
  );
}
