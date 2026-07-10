import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import ProductCombobox from '@/components/ui/ProductCombobox';
import { PACKAGING_TYPES } from '@/lib/packagingTypes';
import { fmtNumber } from '@/i18n/formatters';
import { translatePackagingType } from '@/i18n/domainMaps';

const emptyForm = () => ({
  container_number: '',
  barril_number: '',
  type: 'Tankagem',
  product: '',
  client: '',
  lot: '',
  volume: '',
  density: '',
  tare: '',
  seals: '',
  sling: '',
  gps: '',
  min_test_date: '',
});

export default function AddTankDialog({ open, onOpenChange, onSaved }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { user: internalUser } = useInternalAuth();
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-updated_date', 500));

  useEffect(() => {
    if (open) setForm(emptyForm());
  }, [open]);

  const productOptions = useMemo(
    () => (recipes || []).map(r => ({ value: r.product_name, label: r.product_name })).filter(o => o.value),
    [recipes]
  );

  const handleProductSelect = (product) => {
    const recipe = (recipes || []).find(r => r.product_name === product);
    setForm(prev => ({
      ...prev,
      product,
      client: recipe?.client || prev.client,
      density: recipe?.density != null ? String(recipe.density) : prev.density,
    }));
  };

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const density = parseFloat(form.density) || 0;
  const volume = parseFloat(form.volume) || 0;
  const netWeight = density > 0 ? volume * density : 0;
  const grossWeight = netWeight + (parseFloat(form.tare) || 0);

  const isValid = form.container_number.trim() && form.product.trim() && form.volume && form.tare !== '';

  const fmt3 = (n) => fmtNumber(n, { minimumFractionDigits: 3, maximumFractionDigits: 3 }, lang);

  const handleSave = async () => {
    if (!isValid) {
      toast({ title: t('containers.addTank.errors.required'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const existing = await base44.entities.Container.list('-created_date', 500);
      const maxRegId = existing.reduce((max, c) => Math.max(max, c.registration_id || 0), 0);

      const operatorName = internalUser?.nome_completo || internalUser?.nome || '';
      await base44.entities.Container.create({
        op_number: '',
        container_number: form.container_number,
        barril_number: form.barril_number || '',
        registration_id: maxRegId + 1,
        product: form.product,
        client: form.client || '',
        lot: form.lot || '',
        type: form.type,
        volume: parseFloat(form.volume) || 0,
        tare: parseFloat(form.tare) || 0,
        net_weight: netWeight,
        gross_weight: grossWeight,
        seals: form.seals || '',
        sling: form.sling || '',
        gps: form.gps || '',
        min_test_date: form.min_test_date || null,
        operator: operatorName,
        status: 'No Pátio',
      });

      toast({
        title: t('containers.addTank.success.title'),
        description: t('containers.addTank.success.description', { number: form.container_number }),
      });
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast({ title: t('containers.addTank.errors.registerFailed'), description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold text-gray-800">{t('containers.addTank.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div>
            <h4 className="text-sm font-bold mb-3" style={{ color: '#2A5A95' }}>{t('containers.addTank.productData')}</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('common.product')} *</label>
                <ProductCombobox
                  value={form.product}
                  onChange={handleProductSelect}
                  options={productOptions}
                  allowFreeText
                  placeholder={t('containers.addTank.selectProduct')}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('common.client')}</label>
                <Input value={form.client} onChange={e => set('client', e.target.value)} className="h-10 text-sm" placeholder={t('common.client')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('common.lot')}</label>
                <Input value={form.lot} onChange={e => set('lot', e.target.value)} className="h-10 text-sm" placeholder={t('common.lot')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('recipes.simulator.density')}</label>
                <Input type="number" step="0.001" value={form.density} onChange={e => set('density', e.target.value)} className="h-10 text-sm" placeholder="1.000" />
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold mb-3" style={{ color: '#2A5A95' }}>{t('containers.addTank.packagingData')}</h4>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('containers.fields.plateNumber')} *</label>
                <Input value={form.container_number} onChange={e => set('container_number', e.target.value)} className="h-10 text-sm" placeholder={t('containers.addTank.platePlaceholder')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('containers.fields.barrelNumber')}</label>
                <Input value={form.barril_number} onChange={e => set('barril_number', e.target.value)} className="h-10 text-sm" placeholder={t('containers.addTank.barrelPlaceholder')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('packaging.fields.type')} *</label>
                <Select value={form.type} onValueChange={v => set('type', v)}>
                  <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PACKAGING_TYPES.map(pt => <SelectItem key={pt} value={pt}>{translatePackagingType(pt)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('production.packaging.volume')} *</label>
                <Input type="number" value={form.volume} onChange={e => set('volume', e.target.value)} className="h-10 text-sm text-right" placeholder="0" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('containers.vasilhames.tare')} *</label>
                <Input type="number" value={form.tare} onChange={e => set('tare', e.target.value)} className="h-10 text-sm text-right" placeholder="0" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('containers.vasilhames.minTestDate')}</label>
                <Input type="date" value={form.min_test_date} onChange={e => set('min_test_date', e.target.value)} className="h-10 text-sm" />
              </div>
              <div className="lg:col-span-2">
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('packaging.fields.seals')}</label>
                <Input value={form.seals} onChange={e => set('seals', e.target.value)} className="h-10 text-sm" placeholder={t('packaging.fields.seals')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('containers.vasilhames.sling')}</label>
                <Input value={form.sling} onChange={e => set('sling', e.target.value)} className="h-10 text-sm" placeholder={t('containers.vasilhames.sling')} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('containers.vasilhames.gps')}</label>
                <Input value={form.gps} onChange={e => set('gps', e.target.value)} className="h-10 text-sm" placeholder={t('containers.vasilhames.gps')} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm border rounded-lg px-4 py-3 bg-muted/50">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{t('containers.addTank.netWeight')}</p>
              <p className="font-bold text-green-700">{fmt3(netWeight)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{t('containers.addTank.grossWeight')}</p>
              <p className="font-bold">{fmt3(grossWeight)}</p>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('buttons.cancel')}</Button>
            <Button onClick={handleSave} disabled={saving || !isValid} style={{ background: '#1E40AF', color: 'white' }}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('containers.addTank.saving')}</> : t('containers.addTank.registerEntry')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
