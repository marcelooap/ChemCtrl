import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';
import FieldLabel from './FieldLabel';
import { PACKAGING_TYPES } from '@/lib/packagingTypes';
import { fmtNumber } from '@/i18n/formatters';
import { translatePackagingType } from '@/i18n/domainMaps';

export default function DestinationBlock({ dest, idx, total, originsVolume, productDensity, onUpdate, onRemove }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isSingle = total === 1;
  const effectiveVolume = isSingle ? Math.round(originsVolume) : Math.round(parseFloat(dest.volume) || 0);
  const mass = Math.round(effectiveVolume * productDensity);
  const grossWeight = mass + (parseFloat(dest.tare) || 0);

  const fmt0 = (n) => fmtNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, lang);

  return (
    <div className="border rounded-lg p-3 mb-3">
      {total > 1 && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-muted-foreground">{t('transfer.destination.destinationN', { n: idx + 1 })}</span>
          <button onClick={() => onRemove(idx)} className="p-1 rounded hover:bg-red-50"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <FieldLabel>{t('transfer.destination.type')}</FieldLabel>
          <Select value={dest.type} onValueChange={v => onUpdate(idx, 'type', v)}>
            <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Transbordo">{t('transfer.destination.transfer')}</SelectItem>
              <SelectItem value="Expedição">{t('transfer.destination.shipping')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {dest.type === 'Transbordo' ? (
          <>
            <div>
              <FieldLabel>{t('transfer.destination.plateNumber')}</FieldLabel>
              <Input value={dest.placa} onChange={e => onUpdate(idx, 'placa', e.target.value)} placeholder={t('transfer.destination.platePlaceholder')} />
            </div>
            <div>
              <FieldLabel>{t('transfer.destination.barrelNumber')}</FieldLabel>
              <Input value={dest.barril} onChange={e => onUpdate(idx, 'barril', e.target.value)} placeholder={t('transfer.destination.barrelPlaceholder')} />
            </div>
          </>
        ) : (
          <>
            <div>
              <FieldLabel>{t('transfer.destination.vehiclePlate')}</FieldLabel>
              <Input value={dest.placa} onChange={e => onUpdate(idx, 'placa', e.target.value)} placeholder={t('transfer.destination.vehiclePlate')} />
            </div>
            <div>
              <FieldLabel>{t('transfer.destination.driver')}</FieldLabel>
              <Input value={dest.driver} onChange={e => onUpdate(idx, 'driver', e.target.value)} placeholder={t('transfer.destination.driverPlaceholder')} />
            </div>
          </>
        )}
      </div>

      <div className={`grid gap-3 mt-3 ${dest.type === 'Transbordo' ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div>
          <FieldLabel>{t('production.packaging.volume')} {isSingle ? t('transfer.destination.volumeAuto') : ''}</FieldLabel>
          <Input
            type="number"
            value={isSingle ? Math.round(originsVolume) : (dest.volume || '')}
            readOnly={isSingle}
            onChange={e => onUpdate(idx, 'volume', e.target.value)}
            className={isSingle ? 'bg-muted/50 text-sm' : 'text-sm'}
            placeholder={isSingle ? t('transfer.destination.automatic') : '0'}
          />
        </div>
        <div>
          <FieldLabel>{t('common.mass')} (kg) {t('transfer.destination.massAuto')}</FieldLabel>
          <Input value={fmt0(mass)} readOnly className="bg-muted/50 text-sm" />
        </div>
        {dest.type === 'Transbordo' && (
          <div>
            <FieldLabel>{t('transfer.destination.packagingType')}</FieldLabel>
            <Select value={dest.packaging_type} onValueChange={v => onUpdate(idx, 'packaging_type', v)}>
              <SelectTrigger className="text-sm"><SelectValue placeholder={t('transfer.destination.selectOption')} /></SelectTrigger>
              <SelectContent>
                {PACKAGING_TYPES.map(pt => <SelectItem key={pt} value={pt}>{translatePackagingType(pt)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {dest.type === 'Transbordo' ? (
        <div className="grid grid-cols-5 gap-3 mt-3">
          <div>
            <FieldLabel>{t('transfer.destination.seals')}</FieldLabel>
            <Input value={dest.seals} onChange={e => onUpdate(idx, 'seals', e.target.value)} placeholder={t('transfer.destination.sealsPlaceholder')} />
          </div>
          <div>
            <FieldLabel>{t('transfer.viewDialog.sling')}</FieldLabel>
            <Input value={dest.sling} onChange={e => onUpdate(idx, 'sling', e.target.value)} />
          </div>
          <div>
            <FieldLabel>{t('containers.vasilhames.gps')}</FieldLabel>
            <Input value={dest.gps} onChange={e => onUpdate(idx, 'gps', e.target.value)} />
          </div>
          <div>
            <FieldLabel>{t('transfer.destination.minTestDate')}</FieldLabel>
            <Input type="date" value={dest.min_test_date} onChange={e => onUpdate(idx, 'min_test_date', e.target.value)} />
          </div>
          <div>
            <FieldLabel>{t('containers.vasilhames.tare')}</FieldLabel>
            <Input type="number" value={dest.tare || ''} onChange={e => onUpdate(idx, 'tare', e.target.value)} placeholder="0" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3 mt-3">
          <div>
            <FieldLabel>{t('transfer.destination.netWeightAuto')}</FieldLabel>
            <Input value={fmt0(mass)} readOnly className="bg-muted/50 text-sm" />
          </div>
          <div>
            <FieldLabel>{t('containers.vasilhames.tare')}</FieldLabel>
            <Input type="number" value={dest.tare || ''} onChange={e => onUpdate(idx, 'tare', e.target.value)} placeholder="0" />
          </div>
          <div>
            <FieldLabel>{t('transfer.destination.grossWeightAuto')}</FieldLabel>
            <Input value={fmt0(grossWeight)} readOnly className="bg-muted/50 text-sm" />
          </div>
          <div>
            <FieldLabel>{t('transfer.destination.seals')}</FieldLabel>
            <Input value={dest.seals} onChange={e => onUpdate(idx, 'seals', e.target.value)} placeholder={t('transfer.destination.sealsPlaceholder')} />
          </div>
        </div>
      )}
    </div>
  );
}
