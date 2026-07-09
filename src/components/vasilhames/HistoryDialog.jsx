import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Search, History, X } from 'lucide-react';
import ProductCombobox from '@/components/ui/ProductCombobox';
import HistoryCycles from './HistoryCycles';
import { buildContainerCycles } from '@/lib/containerHistory';

export default function HistoryDialog({ open, onOpenChange, containers, transfers, productions, recipes }) {
  const [selectedId, setSelectedId] = useState('');
  const [cycles, setCycles] = useState(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [searching, setSearching] = useState(false);

  const options = useMemo(
    () => (containers || [])
      .filter(c => c.container_number)
      .map(c => ({
        value: c.id,
        label: `${c.container_number}${c.barril_number ? ' - ' + c.barril_number : ''}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [containers]
  );

  const selectedContainer = (containers || []).find(c => c.id === selectedId);

  const handleSearch = () => {
    if (!selectedContainer) return;
    setSearching(true);
    setTimeout(() => {
      const result = buildContainerCycles(selectedContainer, containers, transfers, productions, recipes);
      setCycles(result);
      setShowTimeline(true);
      setSearching(false);
    }, 120);
  };

  const resetAndClose = () => {
    onOpenChange(false);
    setTimeout(() => { setShowTimeline(false); setSelectedId(''); setCycles(null); }, 200);
  };

  const backToSearch = () => {
    setShowTimeline(false);
    setCycles(null);
  };

  return (
    <>
      {/* Janela de seleção */}
      {open && !showTimeline && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-background rounded-xl shadow-xl border border-border max-w-md w-full p-6 relative animate-in fade-in zoom-in-95 duration-150">
            <button onClick={resetAndClose} className="absolute right-4 top-4 opacity-70 hover:opacity-100 transition-opacity">
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 mb-1">
              <History className="w-5 h-5" style={{ color: '#4B0082' }} />
              <h2 className="text-lg font-semibold">Histórico do Vasilhame</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Selecione um vasilhame (Nº Placa / Barril) para visualizar todos os seus ciclos de utilização.
            </p>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Vasilhame</label>
                <ProductCombobox
                  value={selectedId}
                  onChange={setSelectedId}
                  options={options}
                  placeholder="Buscar por nº placa ou nº barril..."
                />
              </div>
              <Button onClick={handleSearch} disabled={!selectedId || searching} className="w-full" style={{ background: '#2575D1', color: 'white' }}>
                {searching ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Buscando...</> : <><Search className="w-4 h-4 mr-2" /> Buscar</>}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Tela de histórico por ciclos */}
      {open && showTimeline && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-background rounded-xl shadow-xl border border-border max-w-5xl w-full max-h-[92vh] flex flex-col relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5" style={{ color: '#4B0082' }} />
                <h2 className="text-lg font-semibold">Histórico do Vasilhame</h2>
                {selectedContainer && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {selectedContainer.container_number}{selectedContainer.barril_number ? ' - ' + selectedContainer.barril_number : ''}
                  </span>
                )}
              </div>
              <button onClick={resetAndClose} className="opacity-70 hover:opacity-100 transition-opacity">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-5">
              {searching ? (
                <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#2575D1' }} /></div>
              ) : (
                <HistoryCycles cycles={cycles} />
              )}
            </div>
            <div className="flex justify-between px-6 py-3 border-t border-border">
              <Button variant="outline" onClick={backToSearch}>Nova consulta</Button>
              <Button variant="outline" onClick={resetAndClose}>Fechar</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
