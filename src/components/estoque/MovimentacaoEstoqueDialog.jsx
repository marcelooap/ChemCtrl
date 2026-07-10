import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { AlertTriangle } from 'lucide-react';
import { fmtDate, fmtNumber } from '@/i18n/formatters';
import { STOCK_DESTINATION_KEYS, translateStockDestination } from '@/i18n/domainMaps';

const DESTINATION_VALUES = Object.keys(STOCK_DESTINATION_KEYS);

export default function MovimentacaoEstoqueDialog({ open, onOpenChange, stocks, onSuccess }) {
  const { t, i18n } = useTranslation();
  const { user } = useInternalAuth();
  const { toast } = useToast();

  const [selectedMPKey, setSelectedMPKey] = useState('');
  const [selectedLot, setSelectedLot] = useState('');
  const [selectedStockId, setSelectedStockId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [destination, setDestination] = useState('');
  const [observations, setObservations] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const mpOptions = useMemo(() => {
    const map = new Map();
    stocks.forEach(s => {
      const key = `${s.mp_code || ''}|${s.mp_name}|${s.client || ''}`;
      if (!map.has(key)) {
        const codPart = s.mp_code ? `${s.mp_code} — ` : '';
        const clientPart = s.client ? ` (${s.client})` : '';
        const label = `${codPart}${s.mp_name}${clientPart}`;
        map.set(key, { key, label, mp_name: s.mp_name, client: s.client || '' });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, i18n.language));
  }, [stocks, i18n.language]);

  const selectedMPOption = mpOptions.find(o => o.key === selectedMPKey);

  const lotsForMP = useMemo(() => {
    if (!selectedMPOption) return [];
    const set = new Set();
    stocks
      .filter(s => s.mp_name === selectedMPOption.mp_name && (s.client || '') === selectedMPOption.client)
      .forEach(s => { if (s.lot) set.add(s.lot); });
    return Array.from(set).sort();
  }, [stocks, selectedMPOption]);

  const entriesForLot = useMemo(() => {
    if (!selectedMPOption || !selectedLot) return [];
    return stocks.filter(
      s => s.mp_name === selectedMPOption.mp_name &&
           (s.client || '') === selectedMPOption.client &&
           s.lot === selectedLot
    );
  }, [stocks, selectedMPOption, selectedLot]);

  const selectedStock = stocks.find(s => s.id === selectedStockId);

  const handleMPChange = (val) => {
    setSelectedMPKey(val);
    setSelectedLot('');
    setSelectedStockId('');
    setError('');
  };

  const handleLotChange = (val) => {
    setSelectedLot(val);
    setSelectedStockId('');
    setError('');
  };

  const handleStockChange = (val) => {
    setSelectedStockId(val);
    setError('');
  };

  const reset = () => {
    setSelectedMPKey('');
    setSelectedLot('');
    setSelectedStockId('');
    setQuantity('');
    setDestination('');
    setObservations('');
    setError('');
  };

  const handleClose = (val) => {
    if (!val) reset();
    onOpenChange(val);
  };

  const handleSave = async () => {
    setError('');
    const qty = parseFloat(quantity);
    if (!selectedStockId) { setError(t('rawMaterialStock.movementDialog.errors.selectEntry')); return; }
    if (!destination) { setError(t('rawMaterialStock.movementDialog.errors.selectDestination')); return; }
    if (!qty || qty <= 0) { setError(t('rawMaterialStock.movementDialog.errors.invalidQuantity')); return; }

    const stock = selectedStock;
    const available = stock.current_stock || 0;
    if (qty > available) {
      setError(t('rawMaterialStock.movementDialog.errors.insufficientBalance', {
        available: fmtNumber(available, { minimumFractionDigits: 0, maximumFractionDigits: 3 }, i18n.language),
        unit: stock.unit,
      }));
      return;
    }

    setSaving(true);
    try {
      const newBalance = available - qty;

      await base44.entities.StockMovement.create({
        stock_id: stock.id,
        entry_id: stock.entry_id || '',
        mp_code: stock.mp_code || '',
        mp_name: stock.mp_name,
        client: stock.client || '',
        lot: stock.lot || '',
        quantity: qty,
        unit: stock.unit,
        destination,
        observations: observations || '',
        operator: user?.nome_completo || user?.usuario || '',
        movement_date: new Date().toISOString(),
        balance_before: available,
        balance_after: newBalance,
      });

      await base44.entities.RawMaterialStock.update(stock.id, {
        current_stock: newBalance,
      });

      toast({ title: t('rawMaterialStock.movementDialog.success') });
      reset();
      onOpenChange(false);
      if (onSuccess) onSuccess();
    } catch (e) {
      console.error('Erro ao salvar movimentação:', e);
      setError(t('rawMaterialStock.movementDialog.errors.saveFailed', {
        message: e?.message || t('rawMaterialStock.movementDialog.errors.retry'),
      }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('rawMaterialStock.movementDialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.movementDialog.rawMaterial')} *</label>
            <Select value={selectedMPKey} onValueChange={handleMPChange}>
              <SelectTrigger><SelectValue placeholder={t('rawMaterialStock.movementDialog.selectMp')} /></SelectTrigger>
              <SelectContent>
                {mpOptions.map(o => (
                  <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedMPKey && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('common.lot')} *</label>
              <Select value={selectedLot} onValueChange={handleLotChange}>
                <SelectTrigger><SelectValue placeholder={t('rawMaterialStock.movementDialog.selectLot')} /></SelectTrigger>
                <SelectContent>
                  {lotsForMP.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedLot && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.movementDialog.entryRecord')} *</label>
              <Select value={selectedStockId} onValueChange={handleStockChange}>
                <SelectTrigger><SelectValue placeholder={t('rawMaterialStock.movementDialog.selectEntry')} /></SelectTrigger>
                <SelectContent>
                  {entriesForLot.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.entry_id} · {t('rawMaterialStock.movementDialog.entryLabel')}: {fmtDate(s.entry_date, undefined, i18n.language)} · {t('rawMaterialStock.movementDialog.balanceLabel')}: {fmtNumber(s.current_stock, { minimumFractionDigits: 0, maximumFractionDigits: 3 }, i18n.language)} {s.unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedStock && (
            <div className="bg-blue-50 rounded-lg p-3 border border-blue-100 text-sm">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><span className="text-muted-foreground">{t('rawMaterialStock.movementDialog.initialStock')}</span><p className="font-semibold">{fmtNumber(selectedStock.initial_stock, { minimumFractionDigits: 0, maximumFractionDigits: 3 }, i18n.language)} {selectedStock.unit}</p></div>
                <div><span className="text-muted-foreground">{t('rawMaterialStock.movementDialog.availableBalance')}</span><p className="font-bold text-blue-700">{fmtNumber(selectedStock.current_stock, { minimumFractionDigits: 0, maximumFractionDigits: 3 }, i18n.language)} {selectedStock.unit}</p></div>
                <div><span className="text-muted-foreground">{t('rawMaterialStock.movementDialog.supplier')}</span><p className="font-semibold">{selectedStock.supplier || '—'}</p></div>
              </div>
            </div>
          )}

          {selectedStockId && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.movementDialog.quantity')} *</label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={quantity}
                  onChange={e => { setQuantity(e.target.value); setError(''); }}
                  placeholder="0,000"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('common.unit')}</label>
                <Input value={selectedStock?.unit || ''} readOnly className="bg-muted/50 font-semibold" />
              </div>
            </div>
          )}

          {selectedStockId && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.movementDialog.destination')} *</label>
              <Select value={destination} onValueChange={setDestination}>
                <SelectTrigger><SelectValue placeholder={t('rawMaterialStock.movementDialog.selectDestination')} /></SelectTrigger>
                <SelectContent>
                  {DESTINATION_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>{translateStockDestination(value)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedStockId && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('common.observations')}</label>
              <textarea
                className="w-full border rounded-md px-3 py-2 text-sm"
                rows={2}
                value={observations}
                onChange={e => setObservations(e.target.value)}
                placeholder={t('rawMaterialStock.movementDialog.observationsPlaceholder')}
              />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => handleClose(false)}>{t('buttons.cancel')}</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !selectedStockId || !destination || !quantity}
            style={{ background: '#2575D1' }}
            className="text-white"
          >
            {saving ? t('rawMaterialStock.movementDialog.registering') : t('rawMaterialStock.movementDialog.registerMovement')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
