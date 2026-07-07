import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { AlertTriangle } from 'lucide-react';
import moment from 'moment';

const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

export default function MovimentacaoEstoqueDialog({ open, onOpenChange, stocks, onSuccess }) {
  const { user } = useInternalAuth();
  const { toast } = useToast();

  const [selectedMPKey, setSelectedMPKey] = useState(''); // "mp_code|mp_name|client"
  const [selectedLot, setSelectedLot] = useState('');
  const [selectedStockId, setSelectedStockId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [destination, setDestination] = useState('');
  const [observations, setObservations] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Unique MP options com código + nome + cliente para diferenciar MPs com mesmo nome
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
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [stocks]);

  const selectedMPOption = mpOptions.find(o => o.key === selectedMPKey);

  // Lotes para a MP selecionada (filtra por mp_name + client para evitar mistura)
  const lotsForMP = useMemo(() => {
    if (!selectedMPOption) return [];
    const set = new Set();
    stocks
      .filter(s => s.mp_name === selectedMPOption.mp_name && (s.client || '') === selectedMPOption.client)
      .forEach(s => { if (s.lot) set.add(s.lot); });
    return Array.from(set).sort();
  }, [stocks, selectedMPOption]);

  // Entradas para a MP + lote selecionados
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
    if (!selectedStockId) { setError('Selecione um registro de entrada.'); return; }
    if (!destination) { setError('Selecione o destino da movimentação.'); return; }
    if (!qty || qty <= 0) { setError('Informe uma quantidade maior que zero.'); return; }

    const stock = selectedStock;
    const available = stock.current_stock || 0;
    if (qty > available) {
      setError(`Saldo insuficiente. Disponível: ${fmt(available)} ${stock.unit}.`);
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

      toast({ title: 'Movimentação registrada com sucesso!' });
      reset();
      onOpenChange(false);
      if (onSuccess) onSuccess();
    } catch (e) {
      console.error('Erro ao salvar movimentação:', e);
      setError(`Erro ao salvar: ${e?.message || 'Tente novamente.'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Movimentação de Estoque de MP</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Matéria Prima */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Matéria Prima *</label>
            <Select value={selectedMPKey} onValueChange={handleMPChange}>
              <SelectTrigger><SelectValue placeholder="Selecione a MP..." /></SelectTrigger>
              <SelectContent>
                {mpOptions.map(o => (
                  <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Lote */}
          {selectedMPKey && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Lote *</label>
              <Select value={selectedLot} onValueChange={handleLotChange}>
                <SelectTrigger><SelectValue placeholder="Selecione o lote..." /></SelectTrigger>
                <SelectContent>
                  {lotsForMP.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Registro de Entrada */}
          {selectedLot && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Registro de Entrada *</label>
              <Select value={selectedStockId} onValueChange={handleStockChange}>
                <SelectTrigger><SelectValue placeholder="Selecione o registro..." /></SelectTrigger>
                <SelectContent>
                  {entriesForLot.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.entry_id} · Entrada: {s.entry_date ? moment(s.entry_date).format('DD/MM/YYYY') : '—'} · Saldo: {fmt(s.current_stock)} {s.unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Info do registro selecionado */}
          {selectedStock && (
            <div className="bg-blue-50 rounded-lg p-3 border border-blue-100 text-sm">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><span className="text-muted-foreground">Estoque Inicial</span><p className="font-semibold">{fmt(selectedStock.initial_stock)} {selectedStock.unit}</p></div>
                <div><span className="text-muted-foreground">Saldo Disponível</span><p className="font-bold text-blue-700">{fmt(selectedStock.current_stock)} {selectedStock.unit}</p></div>
                <div><span className="text-muted-foreground">Fornecedor</span><p className="font-semibold">{selectedStock.supplier || '—'}</p></div>
              </div>
            </div>
          )}

          {/* Quantidade e Unidade */}
          {selectedStockId && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Quantidade *</label>
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
                <label className="text-xs font-medium text-muted-foreground">Unidade</label>
                <Input value={selectedStock?.unit || ''} readOnly className="bg-gray-50 font-semibold" />
              </div>
            </div>
          )}

          {/* Destino */}
          {selectedStockId && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Destino da Movimentação *</label>
              <Select value={destination} onValueChange={setDestination}>
                <SelectTrigger><SelectValue placeholder="Selecione o destino..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Perda em Processo">Perda em Processo</SelectItem>
                  <SelectItem value="Retorno de MP Não Aplicada">Retorno de MP Não Aplicada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Observações */}
          {selectedStockId && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Observações</label>
              <textarea
                className="w-full border rounded-md px-3 py-2 text-sm"
                rows={2}
                value={observations}
                onChange={e => setObservations(e.target.value)}
                placeholder="Motivo ou informações adicionais..."
              />
            </div>
          )}

          {/* Erro */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !selectedStockId || !destination || !quantity}
            style={{ background: '#2575D1' }}
            className="text-white"
          >
            {saving ? 'Registrando...' : 'Registrar Movimentação'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
