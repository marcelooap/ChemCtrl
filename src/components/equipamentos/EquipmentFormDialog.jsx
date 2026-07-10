import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { EQUIPMENT_TYPES } from '@/lib/equipmentUtils';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { translateEquipmentType } from '@/i18n/domainMaps';
import UploadField from './UploadField';

const EMPTY = {
  name: '', type: 'Balança', manufacturer: '', model: '', serial_number: '',
  patrimony_number: '', location: '', responsible: '', lab_responsible: '',
  acquisition_date: '', calibration_periodicity_days: 365, calibration_company: '',
  calibration_responsible: '', certificate_number: '', last_calibration_date: '',
  next_calibration_date: '', observations: '', image_url: '', certificate_url: '', manual_url: '',
};

export default function EquipmentFormDialog({ open, onClose, onSave, equipment }) {
  const { t } = useTranslation();
  const { user } = useInternalAuth();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(equipment ? { ...EMPTY, ...equipment } : EMPTY);
  }, [equipment, open]);

  const set = (k, v) => {
    setForm((p) => {
      const next = { ...p, [k]: v };
      if (k === 'last_calibration_date' || k === 'calibration_periodicity_days') {
        const baseDate = k === 'last_calibration_date' ? v : p.last_calibration_date;
        const days = k === 'calibration_periodicity_days' ? v : p.calibration_periodicity_days;
        if (baseDate && days) {
          const d = new Date(baseDate + 'T00:00:00');
          d.setDate(d.getDate() + Number(days));
          next.next_calibration_date = d.toISOString().split('T')[0];
        } else {
          next.next_calibration_date = '';
        }
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!form.name || !form.type) { alert(t('quality.equipment.formDialog.errors.required')); return; }
    setSaving(true);
    try {
      await onSave({ ...form, responsible: user?.nome || user?.nome_completo || '' });
      onClose();
    } catch (err) {
      alert(t('quality.equipment.formDialog.errors.saveFailed', { message: err.message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{equipment ? t('quality.equipment.formDialog.editTitle') : t('quality.equipment.formDialog.newTitle')}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div className="sm:col-span-2"><Label className="text-xs">{t('quality.equipment.formDialog.name')} *</Label><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div>
            <Label className="text-xs">{t('quality.equipment.formDialog.type')} *</Label>
            <Select value={form.type} onValueChange={(v) => set('type', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{EQUIPMENT_TYPES.map((et) => <SelectItem key={et} value={et}>{translateEquipmentType(et)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">{t('quality.equipment.formDialog.manufacturer')}</Label><Input value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} /></div>
          <div><Label className="text-xs">{t('quality.equipment.formDialog.model')}</Label><Input value={form.model} onChange={(e) => set('model', e.target.value)} /></div>
          <div><Label className="text-xs">{t('quality.equipment.formDialog.serialNumber')}</Label><Input value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} /></div>
          <div><Label className="text-xs">{t('quality.equipment.formDialog.patrimonyNumber')}</Label><Input value={form.patrimony_number} onChange={(e) => set('patrimony_number', e.target.value)} /></div>
          <div><Label className="text-xs">{t('quality.equipment.formDialog.location')}</Label><Input value={form.location} onChange={(e) => set('location', e.target.value)} /></div>
          <div><Label className="text-xs">{t('quality.equipment.formDialog.labResponsible')}</Label><Input value={form.lab_responsible} onChange={(e) => set('lab_responsible', e.target.value)} /></div>
          <div><Label className="text-xs">{t('quality.equipment.formDialog.periodicityDays')}</Label><Input type="number" value={form.calibration_periodicity_days} onChange={(e) => set('calibration_periodicity_days', Number(e.target.value))} /></div>
          <div className="sm:col-span-2"><Label className="text-xs">{t('quality.equipment.formDialog.calibrationCompany')}</Label><Input value={form.calibration_company} onChange={(e) => set('calibration_company', e.target.value)} /></div>
          <div><Label className="text-xs">{t('quality.equipment.formDialog.currentCertificate')}</Label><Input value={form.certificate_number} onChange={(e) => set('certificate_number', e.target.value)} /></div>
          <div><Label className="text-xs">{t('quality.equipment.formDialog.lastCalibration')}</Label><Input type="date" value={form.last_calibration_date || ''} onChange={(e) => set('last_calibration_date', e.target.value)} /></div>
          <div><Label className="text-xs">{t('quality.equipment.formDialog.nextCalibrationAuto')}</Label><Input type="date" value={form.next_calibration_date || ''} disabled className="bg-muted/50 text-gray-500" /></div>
          <div className="sm:col-span-2"><Label className="text-xs">{t('common.observations')}</Label><Textarea rows={2} value={form.observations || ''} onChange={(e) => set('observations', e.target.value)} /></div>
          <UploadField label={t('quality.equipment.formDialog.equipmentImage')} value={form.image_url} onChange={(v) => set('image_url', v)} accept="image/*" />
          <UploadField label={t('quality.equipment.formDialog.currentCertificateFile')} value={form.certificate_url} onChange={(v) => set('certificate_url', v)} accept=".pdf,image/*" />
          <div className="sm:col-span-2"><UploadField label={t('quality.equipment.formDialog.manufacturerManual')} value={form.manual_url} onChange={(v) => set('manual_url', v)} accept=".pdf,.doc,.docx" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('buttons.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('buttons.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
