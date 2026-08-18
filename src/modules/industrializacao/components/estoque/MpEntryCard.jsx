import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import Combobox from '@shared/components/ui/combobox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/components/ui/select';
import { Switch } from '@shared/components/ui/switch';
import { fmtNumber, fmtMass } from '@/i18n/formatters';
import { calcPackagingQty } from '@industrializacao/lib/stockUtils';
import {
  computeTankCurrentVolume,
  getTankConference,
} from '@industrializacao/lib/mpStockForm';

function SummaryItem({ label, value }) {
  return (
    <span className="text-sm text-foreground/80 min-w-0 truncate">
      <span className="text-muted-foreground">{label}:</span>{' '}
      <span title={value && value !== '—' ? String(value) : undefined}>
        {value || '—'}
      </span>
    </span>
  );
}

function MpEntryFormFields({
  form,
  onChange,
  mpOptions,
  tanks,
  stockItems,
  containers,
  editingId,
  pendingItems,
  isEditing,
}) {
  const { t } = useTranslation();

  const clientTanks = useMemo(() => {
    const client = (form.client || '').trim();
    if (!client) return [];
    return (tanks || []).filter((tank) => (tank.client || '').trim() === client);
  }, [tanks, form.client]);

  const {
    conferenceUnit,
    initialStockQty,
    tankConferenceTotal,
    tankConferenceDiff,
    tankConferenceStatus,
  } = getTankConference(form);

  const stockForPackaging = isEditing
    ? (parseFloat(form.current_stock) || 0)
    : (parseFloat(form.initial_stock) || 0);

  const handleMPSelect = (selected) => {
    if (!selected) return;
    const nextClient = selected.client || form.client;
    const nextDensity = selected.density || form.density;
    const clientChanged = (nextClient || '').trim() !== (form.client || '').trim();
    onChange({
      ...form,
      mp_name: selected.mp_name || form.mp_name,
      mp_code: selected.mp_code || form.mp_code,
      client: nextClient,
      density: nextDensity,
      tank_entries: (form.tank_entries || []).map((entry) => {
        const vol = parseFloat(entry.volume) || 0;
        return {
          ...entry,
          tank_name: clientChanged ? '' : entry.tank_name,
          mass: Math.round((parseFloat(nextDensity) || 0) * vol),
        };
      }),
    });
  };

  const addTankEntry = () =>
    onChange({ ...form, tank_entries: [...(form.tank_entries || []), { tank_name: '', volume: '', mass: 0 }] });

  const updateTankEntry = (idx, patch) =>
    onChange({
      ...form,
      tank_entries: (form.tank_entries || []).map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    });

  const removeTankEntry = (idx) =>
    onChange({ ...form, tank_entries: (form.tank_entries || []).filter((_, i) => i !== idx) });

  return (
    <div className="grid gap-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.entryDate')} *</label>
        <Input type="date" value={form.entry_date} onChange={(e) => onChange({ ...form, entry_date: e.target.value })} />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">
          {t('rawMaterialStock.form.rawMaterial')} * <span className="text-muted-foreground/60">{t('rawMaterialStock.form.selectOrType')}</span>
        </label>
        <Combobox
          value={form.mp_name}
          onValueChange={(v) => onChange({ ...form, mp_name: v })}
          options={mpOptions}
          placeholder={t('rawMaterialStock.form.mpPlaceholder')}
          onSelect={handleMPSelect}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.code')}</label>
          <Input value={form.mp_code} onChange={(e) => onChange({ ...form, mp_code: e.target.value })} placeholder={t('rawMaterialStock.form.autoFill')} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.name')}</label>
          <Input value={form.mp_name} onChange={(e) => onChange({ ...form, mp_name: e.target.value })} placeholder={t('rawMaterialStock.form.autoFill')} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.client')}</label>
          <Input
            value={form.client}
            onChange={(e) => {
              const nextClient = e.target.value;
              onChange({
                ...form,
                client: nextClient,
                tank_entries: (form.tank_entries || []).map((entry) => ({ ...entry, tank_name: '' })),
              });
            }}
            placeholder={t('rawMaterialStock.form.autoFill')}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.lot')}</label>
          <Input value={form.lot} onChange={(e) => onChange({ ...form, lot: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.invoice')}</label>
        <Input
          value={form.nota_fiscal || ''}
          onChange={(e) => onChange({ ...form, nota_fiscal: e.target.value })}
          placeholder={t('rawMaterialStock.form.invoicePlaceholder')}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.supplier')}</label>
          <Input value={form.supplier} onChange={(e) => onChange({ ...form, supplier: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.unitPrice')}</label>
          <Input type="number" step="0.0001" value={form.unit_price} onChange={(e) => onChange({ ...form, unit_price: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.manufactureDate')}</label>
          <Input type="date" value={form.manufacture_date} onChange={(e) => onChange({ ...form, manufacture_date: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.expiryDate')}</label>
          <Input type="date" value={form.expiry_date} onChange={(e) => onChange({ ...form, expiry_date: e.target.value })} />
        </div>
      </div>
      <div className={`grid gap-3 ${isEditing ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.initialStock')} *</label>
          <Input type="number" value={form.initial_stock} onChange={(e) => onChange({ ...form, initial_stock: e.target.value })} />
        </div>
        {isEditing && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.currentBalance')}</label>
            <Input type="number" value={form.current_stock} onChange={(e) => onChange({ ...form, current_stock: e.target.value })} />
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.unit')} *</label>
          <Select value={form.unit} onValueChange={(v) => onChange({ ...form, unit: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="kg">{t('common.units.kg')}</SelectItem>
              <SelectItem value="L">{t('common.units.L')}</SelectItem>
              <SelectItem value="gal">gal</SelectItem>
              <SelectItem value="lb">lb</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {form.density > 0 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.density')}</label>
          <Input value={`${form.density} g/mL`} readOnly className="bg-muted/50 text-blue-700 font-semibold" />
        </div>
      )}
      <div className="border-t pt-3 mt-1">
        <p className="text-xs font-semibold text-muted-foreground mb-2">{t('rawMaterialStock.form.packaging')}</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.packagingType')}</label>
            <Select value={form.packaging_type || ''} onValueChange={(v) => onChange({ ...form, packaging_type: v })}>
              <SelectTrigger><SelectValue placeholder={t('rawMaterialStock.form.selectOption')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="One Way (IBC)">{t('rawMaterialStock.packagingTypes.oneWayIbc')}</SelectItem>
                <SelectItem value="Bombona">{t('rawMaterialStock.packagingTypes.canister')}</SelectItem>
                <SelectItem value="Tambor">{t('rawMaterialStock.packagingTypes.drum')}</SelectItem>
                <SelectItem value="Sacaria">{t('rawMaterialStock.packagingTypes.bag')}</SelectItem>
                <SelectItem value="Contentor">{t('rawMaterialStock.packagingTypes.container')}</SelectItem>
                <SelectItem value="Tankagem">{t('rawMaterialStock.packagingTypes.tankage')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.capacity')}</label>
            <Input type="number" step="0.001" value={form.packaging_capacity || ''} onChange={(e) => onChange({ ...form, packaging_capacity: e.target.value })} placeholder={t('rawMaterialStock.form.capacityPlaceholder')} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.packagingQty')}</label>
            <Input value={calcPackagingQty(stockForPackaging, form.packaging_capacity)} readOnly className="bg-muted/50 font-semibold" />
          </div>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.observations')}</label>
        <textarea className="w-full border rounded-md px-3 py-2 text-sm" rows={2} value={form.observations || ''} onChange={(e) => onChange({ ...form, observations: e.target.value })} placeholder={t('rawMaterialStock.form.notesPlaceholder')} />
      </div>
      <div className="flex items-center justify-between gap-3 p-4 border rounded-lg bg-muted/30">
        <div>
          <p className="text-sm font-medium">{t('rawMaterialStock.form.tankStorage')}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t('rawMaterialStock.form.tankStorageHint')}</p>
        </div>
        <Switch
          checked={form.tank_storage || false}
          onCheckedChange={(checked) => onChange({
            ...form,
            tank_storage: checked,
            tank_entries: checked
              ? (form.tank_entries && form.tank_entries.length > 0 ? form.tank_entries : [{ tank_name: '', volume: '', mass: 0 }])
              : [],
          })}
        />
      </div>
      {form.tank_storage && (
        <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-100 dark:border-blue-900 space-y-3">
          {(form.tank_entries || []).map((entry, idx) => {
            const currentVolume = computeTankCurrentVolume(entry.tank_name, stockItems, containers, editingId, pendingItems);
            const entryVolume = parseFloat(entry.volume) || 0;
            const finalVolume = currentVolume + entryVolume;
            return (
              <div key={idx} className="grid grid-cols-2 gap-3 pb-3 border-b border-blue-100 dark:border-blue-900 last:border-0 last:pb-0">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.tank')} *</label>
                  <Select
                    value={entry.tank_name || ''}
                    onValueChange={(v) => updateTankEntry(idx, { tank_name: v })}
                    disabled={!form.client}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={form.client ? t('rawMaterialStock.form.selectTank') : t('rawMaterialStock.form.selectClientFirst')} />
                    </SelectTrigger>
                    <SelectContent>
                      {clientTanks.length === 0 ? (
                        <SelectItem value="__none" disabled>
                          {form.client
                            ? t('rawMaterialStock.form.noTanksForClient')
                            : t('rawMaterialStock.form.selectClientFirst')}
                        </SelectItem>
                      ) : (
                        clientTanks.map((tank) => (
                          <SelectItem key={tank.id} value={tank.name}>{tank.name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t('rawMaterialStock.form.volume')}</label>
                  <Input
                    type="number"
                    step="0.001"
                    value={entry.volume || ''}
                    onChange={(e) => {
                      const vol = parseFloat(e.target.value) || 0;
                      const mass = Math.round((parseFloat(form.density) || 0) * vol);
                      updateTankEntry(idx, { volume: e.target.value === '' ? '' : vol, mass });
                    }}
                  />
                  {entry.tank_name && (
                    <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
                      {t('rawMaterialStock.form.tankCurrentVolume')}:{' '}
                      <span className="font-semibold text-foreground">{fmtNumber(currentVolume)} L</span>
                      {' → '}
                      {t('rawMaterialStock.form.tankFinalVolume')}:{' '}
                      <span className="font-semibold text-blue-700 dark:text-blue-400">{fmtNumber(finalVolume)} L</span>
                    </p>
                  )}
                </div>
                <div className="col-span-2 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {t('rawMaterialStock.form.massCalc', {
                      mass: fmtMass(entry.mass || 0),
                      density: form.density || 0,
                      volume: entry.volume || 0,
                    })}
                  </span>
                  <button type="button" onClick={() => removeTankEntry(idx)} className="text-red-500 hover:text-red-700 font-medium">{t('buttons.remove')}</button>
                </div>
              </div>
            );
          })}
          <div
            className={`rounded-md border px-3 py-2 text-xs ${
              tankConferenceStatus === 'match'
                ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300'
                : tankConferenceStatus === 'over'
                  ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
                  : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
            }`}
          >
            <p className="font-semibold mb-0.5">{t('rawMaterialStock.form.tankConference')}</p>
            <p>
              {t('rawMaterialStock.form.tankConferenceSummary', {
                allocated: fmtNumber(tankConferenceTotal),
                initialStock: fmtNumber(initialStockQty),
                unit: conferenceUnit,
              })}
            </p>
            <p className="mt-0.5">
              {tankConferenceStatus === 'match'
                ? t('rawMaterialStock.form.tankConferenceMatch')
                : tankConferenceStatus === 'over'
                  ? t('rawMaterialStock.form.tankConferenceOver', {
                      diff: fmtNumber(Math.abs(tankConferenceDiff)),
                      unit: conferenceUnit,
                    })
                  : t('rawMaterialStock.form.tankConferenceUnder', {
                      diff: fmtNumber(Math.abs(tankConferenceDiff)),
                      unit: conferenceUnit,
                    })}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={addTankEntry} className="w-full border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/40">
            <Plus className="w-4 h-4 mr-1" /> {t('rawMaterialStock.form.addTank')}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function MpEntryCard({
  form,
  index = 0,
  collapsed = false,
  showChrome = false,
  canRemove = false,
  onChange,
  onToggleCollapse,
  onRemove,
  mpOptions,
  tanks,
  stockItems,
  containers,
  editingId,
  pendingItems,
  isEditing = false,
}) {
  const { t } = useTranslation();

  const fields = (
    <MpEntryFormFields
      form={form}
      onChange={onChange}
      mpOptions={mpOptions}
      tanks={tanks}
      stockItems={stockItems}
      containers={containers}
      editingId={editingId}
      pendingItems={pendingItems}
      isEditing={isEditing}
    />
  );

  if (!showChrome) return fields;

  const mpDisplay = [form.mp_code, form.mp_name].filter(Boolean).join(' — ');
  const qtyDisplay = form.initial_stock !== '' && form.initial_stock != null
    ? `${fmtNumber(form.initial_stock)} ${form.unit || ''}`.trim()
    : '';

  if (collapsed) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-primary/10 text-primary">
              {t('rawMaterialStock.form.mpBlock', { index: index + 1 })}
            </span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <SummaryItem label={t('rawMaterialStock.form.rawMaterial')} value={mpDisplay} />
              <SummaryItem label={t('rawMaterialStock.form.invoiceShort')} value={form.nota_fiscal} />
              <SummaryItem label={t('rawMaterialStock.form.lot')} value={form.lot} />
              <SummaryItem label={t('common.quantity')} value={qtyDisplay} />
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                title={t('rawMaterialStock.form.expandMp')}
                aria-label={t('rawMaterialStock.form.expandMp')}
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            )}
            {canRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="text-red-400 hover:text-red-600 transition-colors p-1"
                title={t('rawMaterialStock.form.removeMp')}
                aria-label={t('rawMaterialStock.form.removeMp')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg border border-border bg-muted/40 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-primary/10 text-primary">
          {t('rawMaterialStock.form.mpBlock', { index: index + 1 })}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
              title={t('rawMaterialStock.form.collapseMp')}
              aria-label={t('rawMaterialStock.form.collapseMp')}
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          )}
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-red-400 hover:text-red-600 transition-colors p-1"
              title={t('rawMaterialStock.form.removeMp')}
              aria-label={t('rawMaterialStock.form.removeMp')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {fields}
    </div>
  );
}
