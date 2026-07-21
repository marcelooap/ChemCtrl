import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Box, FileText, FileDown } from 'lucide-react';
import { generateStockPDF } from '@/lib/pdfReports.js';
import { generateMovimentacaoPDF } from '@/lib/pdfMovimentacao.js';
import { fmtDate, fmtDateTime, fmtNumber } from '@/i18n/formatters';
import { translateStockDestination } from '@/i18n/domainMaps';

const DEST_COLORS = {
  'Perda em Processo': 'bg-red-100 text-red-700',
  'Retorno de MP Não Aplicada': 'bg-yellow-100 text-yellow-700',
};

export default function RawMaterialViewDialog({ item, open, onOpenChange, readOnly = false }) {
  const { t, i18n } = useTranslation();
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
          if (prod.status === 'Cancelado') return;
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

  const fmt = (n) => fmtNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: 3 }, i18n.language);

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
            <div className="grid grid-cols-3 gap-4 text-sm mb-5">
              <div><p className="text-xs text-muted-foreground">{t('rawMaterialStock.viewDialog.regId')}</p><p className="font-medium" style={{ color: '#2563eb' }}>{item.entry_id}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('rawMaterialStock.viewDialog.entryDate')}</p><p className="font-medium">{fmtDate(item.entry_date, undefined, i18n.language)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('common.code')}</p><p className="font-bold">{item.mp_code}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('common.name')}</p><p className="font-medium">{item.mp_name}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('common.client')}</p><p className="font-medium">{item.client || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('common.lot')}</p><p className="font-medium">{item.lot || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('rawMaterialStock.form.supplier')}</p><p className="font-medium">{item.supplier || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('rawMaterialStock.viewDialog.manufactureDate')}</p><p className="font-medium">{fmtDate(item.manufacture_date, undefined, i18n.language)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('rawMaterialStock.viewDialog.expiryDate')}</p><p className="font-medium">{fmtDate(item.expiry_date, undefined, i18n.language)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('common.unit')}</p><p className="font-medium">{item.unit}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('rawMaterialStock.form.initialStock')}</p><p className="font-bold">{fmt(item.initial_stock)} {item.unit}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('rawMaterialStock.form.currentBalance')}</p><p className="font-bold" style={{ color: '#2563eb' }}>{fmt(item.current_stock)} {item.unit}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('rawMaterialStock.viewDialog.unitPrice')}</p><p className="font-medium">{(item.unit_price || 0).toFixed(4)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('rawMaterialStock.viewDialog.packagingType')}</p><p className="font-medium">{item.packaging_type || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('rawMaterialStock.viewDialog.packagingCapacity')}</p><p className="font-medium">{fmt(item.packaging_capacity)} kg</p></div>
              <div><p className="text-xs text-muted-foreground">{t('rawMaterialStock.viewDialog.packagingQuantity')}</p><p className="font-medium">{fmt(item.packaging_quantity)}</p></div>
            </div>

            <div className="mb-5">
              <p className="text-xs text-muted-foreground">{t('rawMaterialStock.form.observations')}</p>
              <p className="font-medium text-sm whitespace-pre-wrap">{item.observations?.trim() || '—'}</p>
            </div>

            <h4 className="text-sm font-bold mb-2 text-foreground">{t('rawMaterialStock.viewDialog.opsSection')}</h4>
            {loadingConsumption ? (
              <div className="flex items-center justify-center h-16"><div className="w-5 h-5 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
            ) : consumption.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">{t('rawMaterialStock.viewDialog.noOps')}</p>
            ) : (
              <table className="w-full text-sm border rounded-lg overflow-hidden mb-5">
                <thead><tr className="text-xs font-semibold text-muted-foreground bg-muted/50">
                  <th className="px-3 py-2 text-left">{t('production.opNumber')}</th><th className="px-3 py-2 text-left">{t('common.product')}</th><th className="px-3 py-2 text-left">{t('common.date')}</th><th className="px-3 py-2 text-right">{t('rawMaterialStock.viewDialog.fiscalQty')}</th><th className="px-3 py-2 text-right">{t('rawMaterialStock.viewDialog.operationalQtyKg')}</th>
                </tr></thead>
                <tbody>
                  {consumption.map((c, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-medium" style={{ color: '#2563eb' }}>{c.op_number}</td>
                      <td className="px-3 py-2">{c.product}</td>
                      <td className="px-3 py-2">{fmtDate(c.date, undefined, i18n.language)}</td>
                      <td className="px-3 py-2 text-right">{fmt(c.qty_fiscal)} {item.unit}</td>
                      <td className="px-3 py-2 text-right">{fmt(c.qty_operational)} kg</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-muted/50 font-bold">
                    <td colSpan={3} className="px-3 py-2" style={{ color: '#2563eb' }}>{t('rawMaterialStock.viewDialog.totalConsumed')}</td>
                    <td className="px-3 py-2 text-right" style={{ color: '#2563eb' }}>{fmt(consumption.reduce((s, c) => s + (c.qty_fiscal || 0), 0))} {item.unit}</td>
                    <td className="px-3 py-2 text-right" style={{ color: '#2563eb' }}>{fmt(consumption.reduce((s, c) => s + (c.qty_operational || 0), 0))} kg</td>
                  </tr>
                </tbody>
              </table>
            )}

            <h4 className="text-sm font-bold mb-2 text-foreground">{t('rawMaterialStock.viewDialog.movementsSection')}</h4>
            {loadingMovements ? (
              <div className="flex items-center justify-center h-12"><div className="w-5 h-5 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
            ) : movements.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-3 border rounded-lg">{t('rawMaterialStock.viewDialog.noMovements')}</p>
            ) : (
              <table className="w-full text-sm border rounded-lg overflow-hidden">
                <thead><tr className="text-xs font-semibold text-muted-foreground bg-muted/50">
                  <th className="px-3 py-2 text-left">{t('common.date')}</th>
                  <th className="px-3 py-2 text-left">{t('rawMaterialStock.movementDialog.destination')}</th>
                  <th className="px-3 py-2 text-right">{t('common.quantity')}</th>
                  <th className="px-3 py-2 text-right">{t('rawMaterialStock.movementDialog.balanceLabel')}</th>
                  <th className="px-3 py-2 text-right">{t('common.total')}</th>
                  <th className="px-3 py-2 text-center">{t('rawMaterialStock.viewDialog.report')}</th>
                </tr></thead>
                <tbody>
                  {movements.map((m, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap text-xs">{fmtDateTime(m.movement_date, undefined, i18n.language)}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${DEST_COLORS[m.destination] || 'bg-muted text-foreground'}`}>
                          {translateStockDestination(m.destination)}
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
                  <tr className="border-t-2 bg-muted/50 font-bold">
                    <td colSpan={2} className="px-3 py-2 text-red-600">{t('rawMaterialStock.viewDialog.totalMoved')}</td>
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
              <FileText className="w-4 h-4" /> {t('buttons.generatePdf')}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('buttons.close')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
