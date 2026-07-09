import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { EQUIPMENT_TYPES } from '@/lib/equipmentUtils';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import UploadField from './UploadField';

const EMPTY = {
  name: '', type: 'Balança', manufacturer: '', model: '', serial_number: '',
  patrimony_number: '', location: '', responsible: '', lab_responsible: '',
  acquisition_date: '', calibration_periodicity_days: 365, calibration_company: '',
  calibration_responsible: '', certificate_number: '', last_calibration_date: '',
  next_calibration_date: '', observations: '', image_url: '', certificate_url: '', manual_url: '',
};

export default function EquipmentFormDialog({ open, onClose, onSave, equipment }) {
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
    if (!form.name || !form.type) { alert('Preencha Nome e Tipo'); return; }
    setSaving(true);
    try {
      await onSave({ ...form, responsible: user?.nome || user?.nome_completo || '' });
      onClose();
    } catch (err) {
      alert('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{equipment ? 'Editar Equipamento' : 'Novo Equipamento'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div className="sm:col-span-2"><Label className="text-xs">Nome *</Label><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div>
            <Label className="text-xs">Tipo *</Label>
            <Select value={form.type} onValueChange={(v) => set('type', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{EQUIPMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Fabricante</Label><Input value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} /></div>
          <div><Label className="text-xs">Modelo</Label><Input value={form.model} onChange={(e) => set('model', e.target.value)} /></div>
          <div><Label className="text-xs">Número de Série</Label><Input value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} /></div>
          <div><Label className="text-xs">Número de Patrimônio</Label><Input value={form.patrimony_number} onChange={(e) => set('patrimony_number', e.target.value)} /></div>
          <div><Label className="text-xs">Localização</Label><Input value={form.location} onChange={(e) => set('location', e.target.value)} /></div>
          <div><Label className="text-xs">Laboratório Responsável</Label><Input value={form.lab_responsible} onChange={(e) => set('lab_responsible', e.target.value)} /></div>
          <div><Label className="text-xs">Periodicidade Calibração (dias)</Label><Input type="number" value={form.calibration_periodicity_days} onChange={(e) => set('calibration_periodicity_days', Number(e.target.value))} /></div>
          <div className="sm:col-span-2"><Label className="text-xs">Empresa de Calibração</Label><Input value={form.calibration_company} onChange={(e) => set('calibration_company', e.target.value)} /></div>
          <div><Label className="text-xs">Nº Certificado Atual</Label><Input value={form.certificate_number} onChange={(e) => set('certificate_number', e.target.value)} /></div>
          <div><Label className="text-xs">Última Calibração</Label><Input type="date" value={form.last_calibration_date || ''} onChange={(e) => set('last_calibration_date', e.target.value)} /></div>
          <div><Label className="text-xs">Próxima Calibração (auto)</Label><Input type="date" value={form.next_calibration_date || ''} disabled className="bg-muted/50 text-gray-500" /></div>
          <div className="sm:col-span-2"><Label className="text-xs">Observações</Label><Textarea rows={2} value={form.observations || ''} onChange={(e) => set('observations', e.target.value)} /></div>
          <UploadField label="Imagem do Equipamento" value={form.image_url} onChange={(v) => set('image_url', v)} accept="image/*" />
          <UploadField label="Certificado Atual" value={form.certificate_url} onChange={(v) => set('certificate_url', v)} accept=".pdf,image/*" />
          <div className="sm:col-span-2"><UploadField label="Manual do Fabricante" value={form.manual_url} onChange={(v) => set('manual_url', v)} accept=".pdf,.doc,.docx" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
