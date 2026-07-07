import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileDown } from 'lucide-react';
import { generateTransferPDF } from '@/lib/pdfReports';
import moment from 'moment';

const fmt3 = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 });
const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 });
const parseArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);

export default function TransferViewDialog({ transfer, density, recipeCode, containers, onClose }) {
  if (!transfer) return null;

  const origins = parseArr(transfer.origins);
  const dests = parseArr(transfer.destinations);

  // Live lot lookup from current container data (falls back to frozen value)
  const containerLot = {};
  (Array.isArray(containers) ? containers : []).forEach(c => { if (c.id && c.lot) containerLot[c.id] = c.lot; });
  const liveLotFor = (o) => (o.container_id && containerLot[o.container_id]) ? containerLot[o.container_id] : o.lot;

  // Group by lot
  const lotMap = {};
  origins.forEach(o => {
    const key = liveLotFor(o) || 'Sem Lote';
    if (!lotMap[key]) lotMap[key] = { volume: 0, mass: 0 };
    lotMap[key].volume += parseFloat(o.volume_used) || 0;
    lotMap[key].mass += (parseFloat(o.volume_used) || 0) * (density || 0);
  });
  const lotKeys = Object.keys(lotMap);

  const totalVolUsed = origins.reduce((s, o) => s + (parseFloat(o.volume_used) || 0), 0);
  const totalMassUsed = totalVolUsed * (density || 0);
  const totalVolDest = dests.reduce((s, d) => s + (parseFloat(d.volume) || 0), 0);
  const totalMassDest = dests.reduce((s, d) => s + (parseFloat(d.mass) || 0), 0);

  return (
    <Dialog open={!!transfer} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-semibold" style={{ color: '#1A1A2E' }}>
              {transfer.transfer_number} — {transfer.product}
            </DialogTitle>
            <Button size="sm" style={{ background: '#2575D1' }} className="text-white hover:opacity-90"
              onClick={() => generateTransferPDF(transfer, density, containers, recipeCode)}>
              <FileDown className="w-4 h-4 mr-2" /> Gerar PDF
            </Button>
          </div>
        </DialogHeader>

        <div className="grid gap-5">
          {/* Dados Gerais */}
          <div>
            <h4 className="text-sm font-bold mb-3" style={{ color: '#2A5A95' }}>Dados Gerais</h4>
            <div className="grid grid-cols-4 gap-2 text-sm">
              <Info label="Data" value={moment(transfer.date).format('DD/MM/YYYY')} />
              <Info label="Produto" value={transfer.product} />
              <Info label="Cliente" value={transfer.client || '—'} />
              <Info label="Operador" value={transfer.operator || '—'} />
              <Info label="Densidade" value={density ? `${fmt3(density)} g/mL` : '—'} />
              <div className="col-span-2"><Info label="Observações" value={transfer.observations || '—'} /></div>
            </div>
          </div>

          {/* Origens */}
          <div>
            <h4 className="text-sm font-bold mb-3" style={{ color: '#2A5A95' }}>Origens</h4>
            <table className="w-full chemctrl-table border border-gray-200 rounded-lg overflow-hidden">
              <thead><tr>
                <th className="px-3 py-2 text-left">Vasilhame</th><th className="px-3 py-2 text-left">Barril</th>
                <th className="px-3 py-2 text-left">Lote</th><th className="px-3 py-2 text-right">Vol. Retirado (L)</th>
                <th className="px-3 py-2 text-right">Saldo Restante (L)</th>
              </tr></thead>
              <tbody>
                {origins.map((o, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-sm font-medium">{o.container_number || '—'}</td>
                    <td className="px-3 py-2 text-sm">{o.barril_number || '—'}</td>
                    <td className="px-3 py-2 text-sm">{liveLotFor(o) || '—'}</td>
                    <td className="px-3 py-2 text-sm text-right">{fmt(o.volume_used)}</td>
                    <td className="px-3 py-2 text-sm text-right">{fmt(o.remaining_stock)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 bg-blue-50/50">
                  <td className="px-3 py-2 text-xs font-bold" colSpan={3}>Total</td>
                  <td className="px-3 py-2 text-sm font-bold text-right">{fmt(totalVolUsed)} L</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Resumo por Lote */}
          <div>
            <h4 className="text-sm font-bold mb-3" style={{ color: '#2A5A95' }}>Resumo por Lote</h4>
            <table className="w-full chemctrl-table border border-gray-200 rounded-lg overflow-hidden">
              <thead><tr>
                <th className="px-3 py-2 text-left">Lote</th>
                <th className="px-3 py-2 text-right">Volume (L)</th>
                <th className="px-3 py-2 text-right">Massa (kg)</th>
              </tr></thead>
              <tbody>
                {lotKeys.map(k => (
                  <tr key={k} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-sm font-medium">{k}</td>
                    <td className="px-3 py-2 text-sm text-right">{fmt(lotMap[k].volume)}</td>
                    <td className="px-3 py-2 text-sm text-right">{fmt(lotMap[k].mass)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 bg-blue-50/50">
                  <td className="px-3 py-2 text-xs font-bold">Total</td>
                  <td className="px-3 py-2 text-sm font-bold text-right">{fmt(totalVolUsed)} L</td>
                  <td className="px-3 py-2 text-sm font-bold text-right">{fmt(totalMassUsed)} kg</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Destinos */}
          <div>
            <h4 className="text-sm font-bold mb-3" style={{ color: '#2A5A95' }}>Destinos</h4>
            {dests.map((d, i) => (
              <div key={i} className="border rounded-lg p-3 mb-2">
                <div className="grid grid-cols-4 gap-2 text-sm">
                  <Info label="Tipo" value={d.type || '—'} />
                  <Info label={d.type === 'Transbordo' ? 'N° Placa' : 'Placa'} value={d.placa || '—'} />
                  <Info label={d.type === 'Transbordo' ? 'N° Barril' : 'Motorista'} value={d.type === 'Transbordo' ? (d.barril || '—') : (d.driver || '—')} />
                  <Info label="Volume (L)" value={fmt(d.volume)} />
                  <Info label="Massa (kg)" value={fmt(d.mass)} />
                  {d.type === 'Transbordo' ? (
                    <>
                      <Info label="Tipo Embalagem" value={d.packaging_type || '—'} />
                      <Info label="Eslinga" value={d.sling || '—'} />
                      <Info label="GPS" value={d.gps || '—'} />
                      <Info label="Data Menor Teste" value={d.min_test_date ? moment(d.min_test_date).format('DD/MM/YYYY') : '—'} />
                      <Info label="Tara (kg)" value={fmt(d.tare)} />
                      <Info label="Lacres" value={d.seals || '—'} wrap />
                    </>
                  ) : (
                    <>
                      <Info label="Peso Líquido (kg)" value={fmt(d.net_weight)} />
                      <Info label="Tara (kg)" value={fmt(d.tare)} />
                      <Info label="Peso Bruto (kg)" value={fmt(d.gross_weight)} />
                      <Info label="Lacres" value={d.seals || '—'} wrap />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Totais Gerais */}
          <div>
            <h4 className="text-sm font-bold mb-3" style={{ color: '#2A5A95' }}>Totais Gerais</h4>
            <div className="grid grid-cols-4 gap-2 text-sm">
              <Info label="Volume Total Retirado" value={`${fmt(totalVolUsed)} L`} />
              <Info label="Massa Total Retirada" value={`${fmt(totalMassUsed)} kg`} />
              <Info label="Volume Total Destino" value={`${fmt(totalVolDest)} L`} />
              <Info label="Massa Total Destino" value={`${fmt(totalMassDest)} kg`} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value, wrap }) {
  return (
    <div className={`border border-gray-100 rounded-md px-2.5 py-1.5 bg-gray-50/50 ${wrap ? 'col-span-4' : ''}`}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-medium text-foreground ${wrap ? 'break-words whitespace-normal' : 'truncate'}`}>{value}</p>
    </div>
  );
}
