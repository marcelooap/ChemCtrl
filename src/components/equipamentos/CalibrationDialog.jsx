import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import UploadField from './UploadField';

const EMPTY = { date: '', certificate_number: '', company: '', responsible: '', next_calibration_date: '', certificate_url: '', observations: '' };

export default function CalibrationDialog({ open, onClose, onSave, equipment }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => {
    setForm((p) => {
      const next = { ...p, [k]: v };
      if (k === 'date' && equipment?.calibration_periodicity_days) {
        const d = new Date(v + 'T00:00:00');
        d.setDate(d.getDate() + Number(equipment.calibration_periodicity_days));
        next.next_calibration_date = d.toISOString().split('T')[0];
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!form.date) { alert(t('quality.equipment.calibrationDialog.errors.dateRequired')); return; }
    setSaving(true);
    try {
      await onSave({
        ...form,
        company: form.company || equipment?.calibration_company || '',
        responsible: form.responsible || equipment?.calibration_responsible || '',
      });
      setForm(EMPTY);
      onClose();
    } catch (err) {
      alert(t('quality.equipment.calibrationDialog.errors.generic', { message: err.message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('quality.equipment.calibrationDialog.title', { name: equipment?.name })}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div><Label className="text-xs">{t('quality.equipment.calibrationDialog.date')} *</Label><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></div>
          <div><Label className="text-xs">{t('quality.equipment.calibrationDialog.certificateNumber')}</Label><Input value={form.certificate_number} onChange={(e) => set('certificate_number', e.target.value)} /></div>
          <div><Label className="text-xs">{t('quality.equipment.calibrationDialog.company')}</Label><Input value={form.company} onChange={(e) => set('company', e.target.value)} /></div>
          <div><Label className="text-xs">{t('quality.equipment.calibrationDialog.responsible')}</Label><Input value={form.responsible} onChange={(e) => set('responsible', e.target.value)} /></div>
          <div className="sm:col-span-2"><Label className="text-xs">{t('quality.equipment.calibrationDialog.nextCalibration')}</Label><Input type="date" value={form.next_calibration_date} onChange={(e) => set('next_calibration_date', e.target.value)} /></div>
          <div className="sm:col-span-2"><Label className="text-xs">{t('common.observations')}</Label><Textarea rows={2} value={form.observations} onChange={(e) => set('observations', e.target.value)} /></div>
          <div className="sm:col-span-2"><UploadField label={t('quality.equipment.calibrationDialog.certificatePdf')} value={form.certificate_url} onChange={(v) => set('certificate_url', v)} accept=".pdf,image/*" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('buttons.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('quality.equipment.calibrationDialog.register')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
