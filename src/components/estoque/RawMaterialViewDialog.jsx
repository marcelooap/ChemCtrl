import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Box, FileText, FileDown } from 'lucide-react';
import { generateStockPDF } from '@/lib/pdfReports.js';
import { generateMovimentacaoPDF } from '@/lib/pdfMovimentacao.js';
import moment from 'moment';

const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

const DEST_COLORS = {
  'Perda em Processo': 'bg-red-100 text-red-700',
  'Retorno de MP Não Aplicada': 'bg-yellow-100 text-yellow-700',
};

export default function RawMaterialViewDialog({ item, open, onOpenChange, readOnly = false }) {
  const [consumption, setConsumption] = useState([]);
  const [loadingConsumption, setLoadingConsumption] = useState(false);
  const [movements, setMovements] = useState([]);
  const [loadingMovements, setLoadingMovements] = useState(false);

  useEffect(() => {
    if (!item || !open) return;

    setLoadingConsumption(true);
    setConsumption([]);
    base44.entities.Production.list('-created_date', 500)
      .then(allProductions => {
        const used = [];
        const prods = Array.isArray(allProductions) ? allProductions : [];
        prods.forEach(prod => {
          let rmu = prod.raw_materials_used || [];
          if (typeof rmu === 'string') { try { rmu = JSON.parse(rmu); } catch { rmu = []; } }
          if (!Array.isArray(rmu)) rmu = [];
          rmu.forEach(mp => {
            if (mp.stock_id === item.id) {
              used.push({ op_number: prod.op_number, product: prod.product, date: prod.date, qty_fiscal: mp.qty_fiscal, qty_operational: mp.qty_operational });
            }
          });
        });
        setConsumption(used);
      })
      .catch(() => setConsumption([]))
      .finally(() => setLoadingConsumption(false));

    setLoadingMovements(true);
    setMovements([]);
    base44.entities.StockMovement.filter({ stock_id: item.id }, '-movement_date', 200)
      .then(data => setMovements(Array.isArray(data) ? data : []))
      .catch(() => setMovements([]))
      .finally(() => setLoadingMovements(false));
  }, [item, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Box className="w-4 h-4 text-muted-foreground" />
            <span style={{ color: '#2563eb' }}>{item?.entry_id}</span>
            {' · '}
            <span className="font-bold">{item?.mp_code}</span>
            {' – '}
            {item?.mp_name}
          </DialogTitle>
        </DialogHeader>
        {item && (
          <div>
            {/* Dados gerais */}
            <div className="grid grid-cols-3 gap-4 text-sm mb-5">
              <div><p className="text-xs text-muted-foreground">ID Registro</p><p className="font-medium" style={{ color: '#2563eb' }}>{item.entry_id}</p></div>
              <div><p className="text-xs text-muted-foreground">Data de Entrada</p><p className="font-medium">{item.entry_date ? moment(item.entry_date).format('DD/MM/YYYY') : '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Código</p><p className="font-bold">{item.mp_code}</p></div>
              <div><p className="text-xs text-muted-foreground">Nome</p><p className="font-medium">{item.mp_name}</p></div>
              <div><p className="text-xs text-muted-foreground">Cliente</p><p className="font-medium">{item.client || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Lote</p><p className="font-medium">{item.lot || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Fornecedor</p><p className="font-medium">{item.supplier || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Fabricação</p><p className="font-medium">{item.manufacture_date ? moment(item.manufacture_date).format('DD/MM/YYYY') : '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Validade</p><p className="font-medium">{item.expiry_date ? moment(item.expiry_date).format('DD/MM/YYYY') : '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Unidade</p><p className="font-medium">{item.unit}</p></div>
              <div><p className="text-xs text-muted-foreground">Estoque Inicial</p><p className="font-bold">{fmt(item.initial_stock)} {item.unit}</p></div>
              <div><p className="text-xs text-muted-foreground">Saldo Atual</p><p className="font-bold" style={{ color: '#2563eb' }}>{fmt(item.current_stock)} {item.unit}</p></div>
              <div><p className="text-xs text-muted-foreground">Preço Unitário</p><p className="font-medium">{(item.unit_price || 0).toFixed(4)}</p></div>
              <div><p className="text-xs text-muted-foreground">Tipo de Embalagem</p><p className="font-medium">{item.packaging_type || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Capacidade Embalagem</p><p className="font-medium">{fmt(item.packaging_capacity)} kg</p></div>
              <div><p className="text-xs text-muted-foreground">Qtd. de Embalagens</p><p className="font-medium">{fmt(item.packaging_quantity)}</p></div>
            </div>

            {/* Ordens de Produção */}
            <h4 className="text-sm font-bold mb-2" style={{ color: '#1f2937' }}>Ordens de Produção que utilizaram este lote</h4>
            {loadingConsumption ? (
              <div className="flex items-center justify-center h-16"><div className="w-5 h-5 border-2 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" /></div>
            ) : consumption.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhuma OP utilizou este lote ainda.</p>
            ) : (
              <table className="w-full text-sm border rounded-lg overflow-hidden mb-5">
                <thead><tr className="text-xs font-semibold text-muted-foreground bg-gray-50">
                  <th className="px-3 py-2 text-left">OP</th><th className="px-3 py-2 text-left">Produto</th><th className="px-3 py-2 text-left">Data</th><th className="px-3 py-2 text-right">Qtd. Fiscal</th><th className="px-3 py-2 text-right">Qtd. Op. (kg)</th>
                </tr></thead>
                <tbody>
                  {consumption.map((c, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-medium" style={{ color: '#2563eb' }}>{c.op_number}</td>
                      <td className="px-3 py-2">{c.product}</td>
                      <td className="px-3 py-2">{c.date ? moment(c.date).format('DD/MM/YYYY') : '—'}</td>
                      <td className="px-3 py-2 text-right">{fmt(c.qty_fiscal)} {item.unit}</td>
                      <td className="px-3 py-2 text-right">{fmt(c.qty_operational)} kg</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-gray-50 font-bold">
                    <td colSpan={3} className="px-3 py-2" style={{ color: '#2563eb' }}>TOTAL CONSUMIDO</td>
                    <td className="px-3 py-2 text-right" style={{ color: '#2563eb' }}>{fmt(consumption.reduce((s, c) => s + (c.qty_fiscal || 0), 0))} {item.unit}</td>
                    <td className="px-3 py-2 text-right" style={{ color: '#2563eb' }}>{fmt(consumption.reduce((s, c) => s + (c.qty_operational || 0), 0))} kg</td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* Histórico de Movimentações */}
            <h4 className="text-sm font-bold mb-2" style={{ color: '#1f2937' }}>Histórico de Movimentações</h4>
            {loadingMovements ? (
              <div className="flex items-center justify-center h-12"><div className="w-5 h-5 border-2 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" /></div>
            ) : movements.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-3 border rounded-lg">Nenhuma movimentação registrada.</p>
            ) : (
              <table className="w-full text-sm border rounded-lg overflow-hidden">
                <thead><tr className="text-xs font-semibold text-muted-foreground bg-gray-50">
                  <th className="px-3 py-2 text-left">Data</th>
                  <th className="px-3 py-2 text-left">Destino</th>
                  <th className="px-3 py-2 text-right">Quantidade</th>
                  <th className="px-3 py-2 text-right">Saldo Antes</th>
                  <th className="px-3 py-2 text-right">Saldo Após</th>
                  <th className="px-3 py-2 text-center">Relatório</th>
                </tr></thead>
                <tbody>
                  {movements.map((m, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap text-xs">{m.movement_date ? moment(m.movement_date).format('DD/MM/YY HH:mm') : '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${DEST_COLORS[m.destination] || 'bg-gray-100 text-gray-700'}`}>
                          {m.destination}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-red-600 whitespace-nowrap">-{fmt(m.quantity)} {m.unit}</td>
                      <td className="px-3 py-2 text-right text-xs">{fmt(m.balance_before)} {m.unit}</td>
                      <td className="px-3 py-2 text-right font-semibold text-blue-700 text-xs">{fmt(m.balance_after)} {m.unit}</td>
                      <td className="px-3 py-2 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                          onClick={() => generateMovimentacaoPDF(item, m)}
                        >
                          <FileDown className="w-3 h-3" /> PDF
                        </Button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-gray-50 font-bold">
                    <td colSpan={2} className="px-3 py-2 text-red-600">TOTAL MOVIMENTADO</td>
                    <td className="px-3 py-2 text-right text-red-600">-{fmt(movements.reduce((s, m) => s + (m.quantity || 0), 0))} {item.unit}</td>
                    <td colSpan={4} />
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="flex justify-between mt-4">
          {!readOnly && item && (
            <Button variant="outline" onClick={() => generateStockPDF(item, consumption, movements)} className="gap-2">
              <FileText className="w-4 h-4" /> Gerar PDF
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
