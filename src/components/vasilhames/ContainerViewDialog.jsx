import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileText } from 'lucide-react';
import { generateBoletaPDF } from '@/lib/pdfReports';
import moment from 'moment';

const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 });
const fmtRegId = (n) => n != null ? String(n).padStart(2, '0') : '—';

const statusBadge = (s) => {
  const c = { 'No Pátio': 'bg-amber-100 text-amber-700', 'Expedido': 'bg-green-100 text-green-700' };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c[s] || 'bg-muted'}`}>{s}</span>;
};

export default function ContainerViewDialog({ container, open, onOpenChange, readOnly = false }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Detalhe do Vasilhame</DialogTitle></DialogHeader>
        {container && (
          <div className="space-y-5">
            <div className="flex items-center gap-4 p-4 rounded-lg" style={{ background: '#F0F4FF' }}>
              <div className="flex-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">N° Placa</p>
                <p className="text-lg font-bold mt-0.5">{container.container_number || '—'}</p>
              </div>
              <div className="w-px h-12 bg-gray-300" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">N° Barril</p>
                <p className="text-lg font-bold mt-0.5">{container.barril_number || '—'}</p>
              </div>
              <div className="w-px h-12 bg-gray-300" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">ID Reg.</p>
                <p className="text-lg font-bold mt-0.5" style={{ color: '#2575D1' }}>{fmtRegId(container.registration_id)}</p>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Dados da OP</h4>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm bg-muted/50/50 rounded-lg p-4">
                <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">OP</span><span className="font-bold" style={{ color: '#2575D1' }}>{container.op_number || '—'}</span></div>
                <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">Lote</span><span className="font-medium">{container.lot || '—'}</span></div>
                <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">Produto</span><span className="font-bold text-right">{container.product || '—'}</span></div>
                <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">Cliente</span><span className="font-medium text-right">{container.client || '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span>{statusBadge(container.status)}</div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Data Saída</span><span className="font-medium">{container.departure_date ? moment(container.departure_date).format('DD/MM/YYYY') : '—'}</span></div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Dados da Embalagem</h4>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Tipo</p><p className="font-bold">{container.type || '—'}</p></div>
                <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Volume (L)</p><p className="font-bold text-base" style={{ color: '#2575D1' }}>{fmt(container.volume)}</p></div>
                <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Tara (kg)</p><p className="font-medium">{fmt(container.tare)}</p></div>
                <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Peso Líquido (kg)</p><p className="font-bold text-base text-green-700">{fmt(container.net_weight)}</p></div>
                <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Peso Bruto (kg)</p><p className="font-bold text-base">{fmt(container.gross_weight)}</p></div>
                {container.min_test_date && <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">Menor Teste</p><p className="font-medium">{moment(container.min_test_date).format('DD/MM/YYYY')}</p></div>}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Logística</h4>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm bg-muted/50/50 rounded-lg! p-4">
                <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">Lacres</span><span className="font-medium text-right">{container.seals || '—'}</span></div>
                <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">Eslinga</span><span className="font-medium">{container.sling || '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">GPS</span><span className="font-medium">{container.gps || '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Responsável</span><span className="font-medium">{container.operator || '—'}</span></div>
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-between mt-4 pt-4 border-t">
          {!readOnly && container && (
            <Button variant="outline" onClick={() => generateBoletaPDF(container)} className="gap-2">
              <FileText className="w-4 h-4" /> Gerar Boleta
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
