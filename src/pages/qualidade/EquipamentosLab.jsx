import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, Plus, Search } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EQUIPMENT_TYPES, getEquipmentStatus } from '@/lib/equipmentUtils';
import KpiCards from '@/components/equipamentos/KpiCards';
import EquipmentCard from '@/components/equipamentos/EquipmentCard';
import EquipmentFormDialog from '@/components/equipamentos/EquipmentFormDialog';
import CalibrationDialog from '@/components/equipamentos/CalibrationDialog';
import EquipmentViewDialog from '@/components/equipamentos/EquipmentViewDialog';

export default function EquipamentosLab() {
  const { t } = useTranslation();
  const { data: equipments, loading } = useRealtimeEntity('LabEquipment', () => base44.entities.LabEquipment.list('-created_date'));
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [calibrating, setCalibrating] = useState(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (equipments || []).filter((e) => {
      const matchSearch = !q || [e.name, e.patrimony_number, e.manufacturer, e.model].some((v) => (v || '').toLowerCase().includes(q));
      const matchType = typeFilter === 'all' || e.type === typeFilter;
      const matchStatus = statusFilter === 'all' || getEquipmentStatus(e.next_calibration_date).key === statusFilter;
      return matchSearch && matchType && matchStatus;
    });
  }, [equipments, search, statusFilter, typeFilter]);

  const handleSave = async (formData) => {
    if (editing) {
      await base44.entities.LabEquipment.update(editing.id, formData);
    } else {
      await base44.entities.LabEquipment.create(formData);
    }
  };

  const handleDelete = async (eq) => {
    if (!confirm(t('quality.equipmentLab.deleteConfirm', { name: eq.name }))) return;
    await base44.entities.LabEquipment.delete(eq.id);
  };

  const handleCalibration = async (cal) => {
    const eq = calibrating;
    const history = [...(eq.calibration_history || []), cal];
    await base44.entities.LabEquipment.update(eq.id, {
      last_calibration_date: cal.date,
      next_calibration_date: cal.next_calibration_date,
      certificate_number: cal.certificate_number || eq.certificate_number,
      calibration_company: cal.company || eq.calibration_company,
      calibration_responsible: cal.responsible || eq.calibration_responsible,
      calibration_history: history,
    });
  };

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      <div className="shrink-0">
        <div className="flex items-start justify-between mb-6 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-blue-100">
              <FlaskConical className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{t('quality.equipmentLab.title')}</h1>
              <p className="text-sm text-muted-foreground">{t('quality.equipmentLab.subtitle')}</p>
            </div>
          </div>
          <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="shrink-0 text-white" style={{ background: '#2563EB' }}>
            <Plus className="w-4 h-4" /> {t('quality.equipmentLab.newEquipment')}
          </Button>
        </div>

        <div className="mb-4">
          <KpiCards equipments={equipments || []} />
        </div>

        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex-1 min-w-48 relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input placeholder={t('quality.equipmentLab.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('quality.equipmentLab.statusAll')}</SelectItem>
              <SelectItem value="conforme">{t('quality.equipmentLab.statusConforme')}</SelectItem>
              <SelectItem value="vencer">{t('quality.equipmentLab.statusExpiring')}</SelectItem>
              <SelectItem value="vencido">{t('quality.equipmentLab.statusExpired')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('quality.equipmentLab.typeAll')}</SelectItem>
              {EQUIPMENT_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-center text-gray-400 py-12">{t('quality.equipmentLab.loading')}</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 mb-2">{t('quality.equipmentLab.empty')}</p>
            <Button variant="outline" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="w-4 h-4" /> {t('quality.equipmentLab.registerFirst')}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((eq) => (
              <EquipmentCard
                key={eq.id}
                equipment={eq}
                onView={(e) => setViewing(e)}
                onEdit={(e) => { setEditing(e); setFormOpen(true); }}
                onCalibrate={(e) => setCalibrating(e)}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      <EquipmentFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSave={handleSave} equipment={editing} />
      <CalibrationDialog open={!!calibrating} onClose={() => setCalibrating(null)} onSave={handleCalibration} equipment={calibrating} />
      <EquipmentViewDialog open={!!viewing} onClose={() => setViewing(null)} equipment={viewing} />
    </div>
  );
}
