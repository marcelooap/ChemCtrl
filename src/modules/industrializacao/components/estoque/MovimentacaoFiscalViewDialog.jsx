import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { FileDown, FileText } from 'lucide-react';
import { generateMovimentacaoPDF } from '@industrializacao/lib/pdfMovimentacao.js';
import { fmtDateTime, fmtNumber } from '@/i18n/formatters';
import { translateStockDestination } from '@/i18n/domainMaps';

const DEST_COLORS = {
  'Perda em Processo': 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  'Retorno de MP Não Aplicada': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300',
};

export default function MovimentacaoFiscalViewDialog({ movement, stock, open, onOpenChange }) {
  const { t, i18n } = useTranslation();

  const itemForPdf = useMemo(() => {
    if (!movement) return null;
    return {
      entry_id: stock?.entry_id || movement.entry_id || '',
      entry_date: stock?.entry_date || null,
      mp_code: stock?.mp_code || movement.mp_code || '',
      mp_name: stock?.mp_name || movement.mp_name || '',
      client: stock?.client || movement.client || '',
      lot: stock?.lot || movement.lot || '',
      supplier: stock?.supplier || '',
      unit: stock?.unit || movement.unit || '',
      manufacture_date: stock?.manufacture_date || null,
      expiry_date: stock?.expiry_date || null,
      packaging_type: stock?.packaging_type || '',
      packaging_capacity: stock?.packaging_capacity || 0,
      packaging_quantity: stock?.packaging_quantity || 0,
      initial_stock: stock?.initial_stock || 0,
      current_stock: stock?.current_stock || 0,
      unit_price: stock?.unit_price || 0,
    };
  }, [movement, stock]);

  if (!movement) return null;

  const unit = movement.unit || stock?.unit || '';
  const qty = fmtNumber(movement.quantity, { minimumFractionDigits: 0, maximumFractionDigits: 3 }, i18n.language);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="text-primary">{movement.entry_id || '—'}</span>
            <span className="text-muted-foreground">·</span>
            <span>{t('rawMaterialStock.fiscalView.title')}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">{t('rawMaterialStock.table.reg')}</p>
              <p className="font-medium text-primary">{movement.entry_id || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('common.date')}</p>
              <p className="font-medium">{fmtDateTime(movement.movement_date, undefined, i18n.language)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('rawMaterialStock.table.code')}</p>
              <p className="font-mono font-medium">{movement.mp_code || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('rawMaterialStock.fiscalTable.product')}</p>
              <p className="font-medium">{movement.mp_name || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('common.client')}</p>
              <p className="font-medium">{movement.client || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('common.lot')}</p>
              <p className="font-mono font-medium">{movement.lot || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('common.quantity')}</p>
              <p className="font-semibold text-red-600">-{qty} {unit}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('rawMaterialStock.fiscalTable.type')}</p>
              <span className={`inline-flex mt-0.5 text-xs font-semibold px-2 py-0.5 rounded-full ${DEST_COLORS[movement.destination] || 'bg-muted text-foreground'}`}>
                {translateStockDestination(movement.destination)}
              </span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('rawMaterialStock.movementDialog.balanceLabel')} ({t('rawMaterialStock.fiscalView.before')})</p>
              <p className="font-medium">{fmtNumber(movement.balance_before, undefined, i18n.language)} {unit}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('rawMaterialStock.movementDialog.balanceLabel')} ({t('rawMaterialStock.fiscalView.after')})</p>
              <p className="font-medium text-blue-700 dark:text-blue-400">{fmtNumber(movement.balance_after, undefined, i18n.language)} {unit}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">{t('common.operator')}</p>
              <p className="font-medium">{movement.operator || '—'}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">{t('rawMaterialStock.form.observations')}</p>
              <p className="font-medium text-sm whitespace-pre-wrap">{movement.observations?.trim() || '—'}</p>
            </div>
          </div>

          <div className="flex justify-between gap-2 pt-1">
            <Button
              variant="outline"
              className="gap-2 text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-800"
              onClick={() => generateMovimentacaoPDF(itemForPdf, movement)}
            >
              <FileDown className="w-4 h-4" />
              {t('rawMaterialStock.fiscalView.downloadPdf')}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('buttons.close')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
