import React from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import FieldLabel from './FieldLabel';

const PACKAGING_TYPES = ['Contentor', 'IBC – 1.000 L', 'Tambor 200 L', 'Tankagem'];

const fmt3 = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 });
const fmt0 = (n) => Math.round(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 });

export default function DestinationBlock({ dest, idx, total, originsVolume, productDensity, onUpdate, onRemove }) {
  const isSingle = total === 1;
  const effectiveVolume = isSingle ? Math.round(originsVolume) : Math.round(parseFloat(dest.volume) || 0);
  const mass = Math.round(effectiveVolume * productDensity);
  const grossWeight = mass + (parseFloat(dest.tare) || 0);

  return (
    <div className="border rounded-lg p-3 mb-3">
      {total > 1 && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-muted-foreground">Destino {idx + 1}</span>
          <button onClick={() => onRemove(idx)} className="p-1 rounded hover:bg-red-50"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
        </div>
      )}
      {/* Row 1 — Tipo + identification */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <FieldLabel>Tipo</FieldLabel>
          <Select value={dest.type} onValueChange={v => onUpdate(idx, 'type', v)}>
            <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Transbordo">Transbordo</SelectItem>
              <SelectItem value="Expedição">Expedição</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {dest.type === 'Transbordo' ? (
          <>
            <div>
              <FieldLabel>N° Placa</FieldLabel>
              <Input value={dest.placa} onChange={e => onUpdate(idx, 'placa', e.target.value)} placeholder="Ex: TANKA 41" />
            </div>
            <div>
              <FieldLabel>N° Barril</FieldLabel>
              <Input value={dest.barril} onChange={e => onUpdate(idx, 'barril', e.target.value)} placeholder="N° barril" />
            </div>
          </>
        ) : (
          <>
            <div>
              <FieldLabel>Placa</FieldLabel>
              <Input value={dest.placa} onChange={e => onUpdate(idx, 'placa', e.target.value)} placeholder="Placa do veículo" />
            </div>
            <div>
              <FieldLabel>Motorista</FieldLabel>
              <Input value={dest.driver} onChange={e => onUpdate(idx, 'driver', e.target.value)} placeholder="Nome do motorista" />
            </div>
          </>
        )}
      </div>

      {/* Row 2 — Volume, Mass, Embalagem (Embalagem only for Transbordo) */}
      <div className={`grid gap-3 mt-3 ${dest.type === 'Transbordo' ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div>
          <FieldLabel>Volume (L) {isSingle ? 'auto' : ''}</FieldLabel>
          <Input
            type="number"
            value={isSingle ? Math.round(originsVolume) : (dest.volume || '')}
            readOnly={isSingle}
            onChange={e => onUpdate(idx, 'volume', e.target.value)}
            className={isSingle ? 'bg-gray-50 text-sm' : 'text-sm'}
            placeholder={isSingle ? 'Automático' : '0'}
          />
        </div>
        <div>
          <FieldLabel>Massa (kg) auto</FieldLabel>
          <Input value={fmt0(mass)} readOnly className="bg-gray-50 text-sm" />
        </div>
        {dest.type === 'Transbordo' && (
          <div>
            <FieldLabel>Tipo Embalagem</FieldLabel>
            <Select value={dest.packaging_type} onValueChange={v => onUpdate(idx, 'packaging_type', v)}>
              <SelectTrigger className="text-sm"><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {PACKAGING_TYPES.map(pt => <SelectItem key={pt} value={pt}>{pt}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Row 3 — conditional fields */}
      {dest.type === 'Transbordo' ? (
        <div className="grid grid-cols-5 gap-3 mt-3">
          <div>
            <FieldLabel>Lacres</FieldLabel>
            <Input value={dest.seals} onChange={e => onUpdate(idx, 'seals', e.target.value)} placeholder="Nº lacres" />
          </div>
          <div>
            <FieldLabel>Eslinga</FieldLabel>
            <Input value={dest.sling} onChange={e => onUpdate(idx, 'sling', e.target.value)} />
          </div>
          <div>
            <FieldLabel>GPS</FieldLabel>
            <Input value={dest.gps} onChange={e => onUpdate(idx, 'gps', e.target.value)} />
          </div>
          <div>
            <FieldLabel>Data Menor Teste</FieldLabel>
            <Input type="date" value={dest.min_test_date} onChange={e => onUpdate(idx, 'min_test_date', e.target.value)} />
          </div>
          <div>
            <FieldLabel>Tara (kg)</FieldLabel>
            <Input type="number" value={dest.tare || ''} onChange={e => onUpdate(idx, 'tare', e.target.value)} placeholder="0" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3 mt-3">
          <div>
            <FieldLabel>Peso Líq. (kg) auto</FieldLabel>
            <Input value={fmt0(mass)} readOnly className="bg-gray-50 text-sm" />
          </div>
          <div>
            <FieldLabel>Tara (kg)</FieldLabel>
            <Input type="number" value={dest.tare || ''} onChange={e => onUpdate(idx, 'tare', e.target.value)} placeholder="0" />
          </div>
          <div>
            <FieldLabel>Peso Bruto (kg) auto</FieldLabel>
            <Input value={fmt0(grossWeight)} readOnly className="bg-gray-50 text-sm" />
          </div>
          <div>
            <FieldLabel>Lacres</FieldLabel>
            <Input value={dest.seals} onChange={e => onUpdate(idx, 'seals', e.target.value)} placeholder="Nº lacres" />
          </div>
        </div>
      )}
    </div>
  );
}
