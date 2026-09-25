import { useTranslation } from 'react-i18next';
import { MoreVertical, Calendar, FileText, Printer } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@shared/components/ui/dropdown-menu';
import SignedImage from '@industrializacao/components/SignedImage';
import EquipmentIcon from './EquipmentIcon';
import { getEquipmentStatus, getCalibrationColor, getDaysUntil } from '@industrializacao/lib/equipmentUtils';
import { getEquipmentCertificatePath } from '@industrializacao/lib/equipmentFiles';
import { fmtDate } from '@/i18n/formatters';
import { translateEquipmentCalibrationStatus, translateCalibrationDueLabel } from '@/i18n/domainMaps';

function EquipmentRow({ equipment, onEdit, onDelete, onView, onCalibrate, onOpenCertificate, onPrintLabel }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const status = getEquipmentStatus(equipment.next_calibration_date);
  const calColor = getCalibrationColor(equipment.next_calibration_date);
  const calDueLabel = translateCalibrationDueLabel(getDaysUntil(equipment.next_calibration_date));
  const certificatePath = getEquipmentCertificatePath(equipment);

  return (
    <tr
      className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors cursor-pointer"
      onClick={() => onView(equipment)}
    >
      <td className="px-4 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-14 h-14 rounded-lg bg-muted/50 border border-border flex items-center justify-center overflow-hidden shrink-0">
            {equipment.image_url ? (
              <SignedImage url={equipment.image_url} alt={equipment.name} className="w-full h-full object-cover" fallbackClassName="w-full h-full" />
            ) : (
              <EquipmentIcon type={equipment.type} className="w-6 h-6 text-muted-foreground/40" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="font-semibold text-sm text-foreground truncate">{equipment.name}</p>
              {certificatePath && (
                <button
                  type="button"
                  className="inline-flex shrink-0 border-0 bg-transparent p-0 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={t('quality.equipment.viewDialog.certificateAttached')}
                  aria-label={t('quality.equipment.viewDialog.certificateAttached')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenCertificate(equipment, certificatePath);
                  }}
                >
                  <FileText className="w-3.5 h-3.5 shrink-0" />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{equipment.type || '—'}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <p className="text-sm text-foreground truncate">{equipment.model || '—'}</p>
        <p className="text-xs text-muted-foreground truncate">{equipment.manufacturer || '—'}</p>
      </td>
      <td className="px-4 py-4">
        <p className="text-sm text-foreground truncate">{equipment.patrimony_number || '—'}</p>
        <p className="text-xs text-muted-foreground truncate">{t('quality.equipment.viewDialog.serial')}: {equipment.serial_number || '—'}</p>
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-1.5 text-sm text-foreground min-w-0">
          <FileText className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
          <span className="truncate">{equipment.certificate_number || '—'}</span>
        </div>
      </td>
      <td className="px-4 py-4">
        <p className="text-sm text-foreground whitespace-nowrap">{fmtDate(equipment.last_calibration_date, undefined, lang)}</p>
      </td>
      <td className="px-4 py-4">
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${calColor.bgClass}`}>
          <Calendar className={`w-3.5 h-3.5 shrink-0 ${calColor.textClass}`} />
          <span className={`text-sm font-semibold whitespace-nowrap ${calColor.textClass}`}>
            {fmtDate(equipment.next_calibration_date, undefined, lang)}
            <span className="text-xs font-medium"> · {calDueLabel}</span>
          </span>
        </div>
      </td>
      <td className="px-4 py-4">
        <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${status.className}`}>
          {translateEquipmentCalibrationStatus(status.key)}
        </span>
      </td>
      <td className="px-4 py-4 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="inline-flex items-center justify-end gap-1">
          <button
            type="button"
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted border border-transparent hover:border-border transition-colors"
            title={t('quality.equipment.card.printLabel')}
            aria-label={t('quality.equipment.card.printLabel')}
            onClick={() => onPrintLabel(equipment)}
          >
            <Printer className="w-4 h-4 text-muted-foreground" />
          </button>
          <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted border border-transparent hover:border-border transition-colors"
              aria-label={t('common.actions')}
            >
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
      </td>
    </tr>
  );
}

export default function EquipmentTable({ equipments, onEdit, onDelete, onView, onCalibrate, onOpenCertificate, onPrintLabel }) {
  const { t } = useTranslation();

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('quality.equipment.title')}</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('quality.equipment.viewDialog.model')}</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('quality.equipment.card.patrimony')}</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('quality.equipment.card.certificate')}</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('quality.equipment.card.lastCalibration')}</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('quality.equipment.viewDialog.nextCalibration')}</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('common.status')}</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('common.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {equipments.map((eq) => (
            <EquipmentRow
              key={eq.id}
              equipment={eq}
              onView={onView}
              onEdit={onEdit}
              onCalibrate={onCalibrate}
              onDelete={onDelete}
              onOpenCertificate={onOpenCertificate}
              onPrintLabel={onPrintLabel}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
