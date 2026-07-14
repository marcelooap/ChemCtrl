import { useTranslation } from 'react-i18next';
import { MoreVertical, Calendar, FileText } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import SignedImage from '@/components/SignedImage';
import EquipmentIcon from './EquipmentIcon';
import { getEquipmentStatus, getCalibrationColor, getDaysUntil } from '@/lib/equipmentUtils';
import { fmtDate } from '@/i18n/formatters';
import { translateEquipmentCalibrationStatus, translateCalibrationDueLabel } from '@/i18n/domainMaps';

export default function EquipmentCard({ equipment, onEdit, onDelete, onView, onCalibrate }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const status = getEquipmentStatus(equipment.next_calibration_date);
  const calColor = getCalibrationColor(equipment.next_calibration_date);
  const calDueLabel = translateCalibrationDueLabel(getDaysUntil(equipment.next_calibration_date));

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow">
      <div className="relative h-32 bg-muted/50 flex items-center justify-center">
        {equipment.image_url ? (
          <SignedImage url={equipment.image_url} alt={equipment.name} className="w-full h-full object-cover" fallbackClassName="w-full h-full" />
        ) : (
          <EquipmentIcon type={equipment.type} className="w-12 h-12 text-muted-foreground/40" />
        )}
        <span className={`absolute top-2 left-2 text-xs font-semibold px-2.5 py-0.5 rounded-full shadow-sm ${status.className}`}>{translateEquipmentCalibrationStatus(status.key)}</span>
        <div className="absolute top-1.5 right-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-7 h-7 rounded-lg bg-card/90 backdrop-blur flex items-center justify-center hover:bg-card shadow-sm border border-border">
                <MoreVertical className="w-4 h-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onView(equipment)}>{t('quality.equipment.card.view')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(equipment)}>{t('quality.equipment.card.edit')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCalibrate(equipment)}>{t('quality.equipment.card.registerCalibration')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onView(equipment)}>{t('quality.equipment.card.attachments')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onView(equipment)}>{t('quality.equipment.card.history')}</DropdownMenuItem>
              <DropdownMenuItem className="text-red-600" onClick={() => onDelete(equipment)}>{t('quality.equipment.card.delete')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col gap-2">
        <div>
          <h3 className="font-bold text-foreground text-sm leading-tight truncate">{equipment.name}</h3>
          <p className="text-xs text-muted-foreground truncate">{t('quality.equipment.card.model')}: {equipment.model || '—'}</p>
          <p className="text-xs text-muted-foreground truncate">{t('quality.equipment.card.patrimony')}: {equipment.patrimony_number || '—'}</p>
        </div>
        <div className="text-xs space-y-1 mt-auto">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <FileText className="w-3 h-3 text-muted-foreground/60 shrink-0" />
            <span className="truncate">{t('quality.equipment.card.certificate')}: {equipment.certificate_number || '—'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Calendar className="w-3 h-3 text-muted-foreground/60 shrink-0" />
            <span className="truncate">{t('quality.equipment.card.lastCalibration')}: {fmtDate(equipment.last_calibration_date, undefined, lang)}</span>
          </div>
        </div>
      </div>

      <div className={`px-4 py-2.5 border-t flex items-center gap-2 ${calColor.bgClass}`}>
        <Calendar className={`w-4 h-4 shrink-0 ${calColor.textClass}`} />
        <div className="min-w-0">
          <p className={`text-[10px] font-medium uppercase tracking-wide ${calColor.textClass}`}>{t('quality.equipment.viewDialog.nextCalibration')}</p>
          <p className={`text-sm font-bold leading-tight ${calColor.textClass}`}>
            {fmtDate(equipment.next_calibration_date, undefined, lang)} <span className="text-xs font-medium">· {calDueLabel}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
