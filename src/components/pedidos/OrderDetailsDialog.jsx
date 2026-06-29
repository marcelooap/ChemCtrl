import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileText } from 'lucide-react';
import { generateOrderPDF } from '@/lib/pdfReports';
import moment from 'moment';

const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 });

const StatusBadge = ({ status }) => {
  const c = {
    Pendente: 'bg-amber-100 text-amber-700',
    'Em produção': 'bg-blue-100 text-blue-700',
    Finalizado: 'bg-green-100 text-green-700',
    'Aguardando Início': 'bg-gray-100 text-gray-700',
    'Em Produção': 'bg-blue-100 text-blue-700',
    Qualidade: 'bg-purple-100 text-purple-700',
    Envase: 'bg-orange-100 text-orange-700',
    Cancelado: 'bg-red-100 text-red-700',
  };
  return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${c[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>;
};

export default function OrderDetailsDialog({ open, onOpenChange, order, productions }) {
  const [containers, setContainers] = useState([]);

  useEffect(() => {
    if (!open || !order) return;
    const linkedOPs = productions.filter(p => p.order_id === order.id);
    const opNumbers = linkedOPs.map(p => p.op_number).filter(Boolean);
    if (opNumbers.length === 0) { setContainers([]); return; }
    base44.entities.Container.list('-created_date', 500).then(all => {
      setContainers(all.filter(c => opNumbers.includes(c.op_number)));
    });
  }, [open, order]);

  if (!order) return null;
  const linkedOPs = productions.filter(p => p.order_id === order.id);
  const totalVolume = linkedOPs.reduce((s, p) => s + (p.volume || 0), 0);

  const getContainersForOP = (op_number) =>
    containers.filter(c => c.op_number === op_number).map(c => c.container_number).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>📋 Pedido {order.order_number}</DialogTitle>
        </DialogHeader>
        <div>
          <div className="grid grid-cols-3 gap-4 text-sm mb-5">
            <div><p className="text-xs text-muted-foreground">PEDIDO</p><p className="font-bold" style={{ color: '#2563eb' }}>{order.order_number}</p></div>
            <div><p className="text-xs text-muted-foreground">DATA</p><p className="font-medium">{order.date ? moment(order.date).format('DD/MM/YYYY') : '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">STATUS</p><StatusBadge status={order.status} /></div>
            <div><p className="text-xs text-muted-foreground">PRODUTO</p><p className="font-medium">{order.product}</p></div>
            <div><p className="text-xs text-muted-foreground">CLIENTE</p><p className="font-medium">{order.client || '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">SOLICITANTE</p><p className="font-medium">{order.requester || '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">PEDIDO CLIENTE</p><p className="font-medium">{order.client_order || '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">PREVISÃO ATEND.</p><p className="font-medium">{order.expected_date ? moment(order.expected_date).format('DD/MM/YYYY') : '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">VOLUME PEDIDO</p><p className="font-bold">{fmt(order.volume_ordered)} L</p></div>
            <div><p className="text-xs text-muted-foreground">VOLUME PRODUZIDO</p><p className="font-bold text-green-600">{fmt(order.volume_produced)} L</p></div>
            <div><p className="text-xs text-muted-foreground">VOLUME PENDENTE</p><p className="font-bold text-amber-600">{fmt(order.volume_pending)} L</p></div>
          </div>

          {order.observations && (
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-1">OBSERVAÇÕES</p>
              <p className="text-sm bg-gray-50 rounded-lg p-3">{order.observations}</p>
            </div>
          )}

          <h4 className="text-sm font-bold mb-2" style={{ color: '#1f2937' }}>
            Ordens de Produção Vinculadas · {linkedOPs.length}
          </h4>
          {linkedOPs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4 bg-gray-50 rounded-lg">
              Nenhuma OP vinculada a este pedido.
            </p>
          ) : (
            <table className="w-full text-sm border rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-muted-foreground">
                  <th className="px-3 py-2 text-left">OP</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Data Finaliz.</th>
                  <th className="px-3 py-2 text-right">Volume (L)</th>
                  <th className="px-3 py-2 text-left">Vasilhames</th>
                </tr>
              </thead>
              <tbody>
                {linkedOPs.map((p, i) => {
                  const opContainers = getContainersForOP(p.op_number);
                  return (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-medium" style={{ color: '#2563eb' }}>{p.op_number}</td>
                      <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                      <td className="px-3 py-2">{p.end_time ? moment(p.end_time).format('DD/MM/YYYY') : '—'}</td>
                      <td className="px-3 py-2 text-right font-medium">{fmt(p.volume)} L</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {opContainers.length > 0 ? opContainers.join(', ') : '—'}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 bg-gray-50 font-bold">
                  <td colSpan={3} className="px-3 py-2" style={{ color: '#2563eb' }}>VOLUME TOTAL PRODUZIDO</td>
                  <td className="px-3 py-2 text-right" style={{ color: '#16a34a' }}>{fmt(totalVolume)} L</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
        <div className="flex justify-between mt-4">
          <Button variant="outline" onClick={() => generateOrderPDF(order, linkedOPs, containers)} className="gap-2">
            <FileText className="w-4 h-4" /> Gerar PDF
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
