import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileText } from 'lucide-react';
import { generateOrderPDF } from '@/lib/pdfReports';
import { fmtDate, fmtVolume } from '@/i18n/formatters';
import { translateOrderStatus } from '@/i18n/domainMaps';

const statusColors = {
  Pendente: 'bg-amber-100 text-amber-700',
  'Em produção': 'bg-blue-100 text-blue-700',
  Finalizado: 'bg-green-100 text-green-700',
  'Aguardando Início': 'bg-muted text-foreground',
  'Em Produção': 'bg-blue-100 text-blue-700',
  Qualidade: 'bg-purple-100 text-purple-700',
  Envase: 'bg-orange-100 text-orange-700',
  Cancelado: 'bg-red-100 text-red-700',
};

const StatusBadge = ({ status }) => (
  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${statusColors[status] || 'bg-muted text-foreground'}`}>
    {translateOrderStatus(status)}
  </span>
);

export default function OrderDetailsDialog({ open, onOpenChange, order, productions }) {
  const { t, i18n } = useTranslation();
  const [containers, setContainers] = useState([]);

  useEffect(() => {
    if (!open || !order) return;
    const linkedOPs = productions.filter(p => p.order_id === order.id);
    const opNumbers = linkedOPs.map(p => p.op_number).filter(Boolean);
    if (opNumbers.length === 0) { setContainers([]); return; }
    base44.entities.Container.list('-created_date', 500).then(all => {
      setContainers(all.filter(c => opNumbers.includes(c.op_number)));
    });
  }, [open, order, productions]);

  if (!order) return null;
  const linkedOPs = productions.filter(p => p.order_id === order.id);
  const totalVolume = linkedOPs.reduce((s, p) => s + (p.volume || 0), 0);

  const getContainersForOP = (op_number) =>
    containers.filter(c => c.op_number === op_number).map(c => c.container_number).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('orders.details.title', { number: order.order_number })}</DialogTitle>
        </DialogHeader>
        <div>
          <div className="grid grid-cols-3 gap-4 text-sm mb-5">
            <div><p className="text-xs text-muted-foreground">{t('orders.details.order')}</p><p className="font-bold" style={{ color: '#2563eb' }}>{order.order_number}</p></div>
            <div><p className="text-xs text-muted-foreground">{t('orders.details.date')}</p><p className="font-medium">{fmtDate(order.date, undefined, i18n.language)}</p></div>
            <div><p className="text-xs text-muted-foreground">{t('orders.details.status')}</p><StatusBadge status={order.status} /></div>
            <div><p className="text-xs text-muted-foreground">{t('orders.details.product')}</p><p className="font-medium">{order.product}</p></div>
            <div><p className="text-xs text-muted-foreground">{t('orders.details.client')}</p><p className="font-medium">{order.client || '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">{t('orders.details.requester')}</p><p className="font-medium">{order.requester || '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">{t('orders.details.clientOrder')}</p><p className="font-medium">{order.client_order || '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">{t('orders.details.expectedDate')}</p><p className="font-medium">{fmtDate(order.expected_date, undefined, i18n.language)}</p></div>
            <div><p className="text-xs text-muted-foreground">{t('orders.details.volumeOrdered')}</p><p className="font-bold">{fmtVolume(order.volume_ordered, 'L', i18n.language)}</p></div>
            <div><p className="text-xs text-muted-foreground">{t('orders.details.volumeProduced')}</p><p className="font-bold text-green-600">{fmtVolume(order.volume_produced, 'L', i18n.language)}</p></div>
            <div><p className="text-xs text-muted-foreground">{t('orders.details.volumePending')}</p><p className="font-bold text-amber-600">{fmtVolume(order.volume_pending, 'L', i18n.language)}</p></div>
          </div>

          {order.observations && (
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-1">{t('orders.details.observations')}</p>
              <p className="text-sm bg-muted/50 rounded-lg p-3">{order.observations}</p>
            </div>
          )}

          <h4 className="text-sm font-bold mb-2" style={{ color: '#1f2937' }}>
            {t('orders.details.linkedOps', { count: linkedOPs.length })}
          </h4>
          {linkedOPs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4 bg-muted/50 rounded-lg">
              {t('orders.details.noLinkedOps')}
            </p>
          ) : (
            <table className="w-full text-sm border rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                  <th className="px-3 py-2 text-left">{t('production.opNumber')}</th>
                  <th className="px-3 py-2 text-left">{t('common.status')}</th>
                  <th className="px-3 py-2 text-left">{t('orders.details.finishDate')}</th>
                  <th className="px-3 py-2 text-right">{t('production.tracking.volume')}</th>
                  <th className="px-3 py-2 text-left">{t('orders.details.containers')}</th>
                </tr>
              </thead>
              <tbody>
                {linkedOPs.map((p, i) => {
                  const opContainers = getContainersForOP(p.op_number);
                  return (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-medium" style={{ color: '#2563eb' }}>{p.op_number}</td>
                      <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                      <td className="px-3 py-2">{fmtDate(p.end_time, undefined, i18n.language)}</td>
                      <td className="px-3 py-2 text-right font-medium">{fmtVolume(p.volume, 'L', i18n.language)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {opContainers.length > 0 ? opContainers.join(', ') : '—'}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 bg-muted/50 font-bold">
                  <td colSpan={3} className="px-3 py-2" style={{ color: '#2563eb' }}>{t('orders.details.totalProducedVolume')}</td>
                  <td className="px-3 py-2 text-right" style={{ color: '#16a34a' }}>{fmtVolume(totalVolume, 'L', i18n.language)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
        <div className="flex justify-between mt-4">
          <Button variant="outline" onClick={() => generateOrderPDF(order, linkedOPs, containers)} className="gap-2">
            <FileText className="w-4 h-4" /> {t('buttons.generatePdf')}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('buttons.close')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
