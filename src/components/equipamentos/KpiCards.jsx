import { useTranslation } from 'react-i18next';
import { Boxes, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { getEquipmentStatus } from '@/lib/equipmentUtils';

export default function KpiCards({ equipments }) {
  const { t } = useTranslation();

  const stats = equipments.reduce((acc, e) => {
    const s = getEquipmentStatus(e.next_calibration_date);
    acc[s.key] = (acc[s.key] || 0) + 1;
    return acc;
  }, {});

  const cards = [
    { label: t('quality.equipment.kpi.total'), value: equipments.length, icon: Boxes, color: '#2563EB', bg: '#DBEAFE' },
    { label: t('quality.equipment.kpi.compliant'), value: stats.conforme || 0, icon: CheckCircle2, color: '#10B981', bg: '#D1FAE5' },
    { label: t('quality.equipment.kpi.dueSoon'), value: stats.vencer || 0, icon: Clock, color: '#F59E0B', bg: '#FEF3C7' },
    { label: t('quality.equipment.kpi.expired'), value: stats.vencido || 0, icon: AlertTriangle, color: '#EF4444', bg: '#FEE2E2' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c, i) => (
        <div key={i} className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.bg }}>
            <c.icon className="w-5 h-5" style={{ color: c.color }} />
          </div>
          <div className="min-w-0">
            <p className="text-2xl font-bold text-gray-800 leading-none">{c.value}</p>
            <p className="text-xs text-gray-500 mt-1 truncate">{c.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
