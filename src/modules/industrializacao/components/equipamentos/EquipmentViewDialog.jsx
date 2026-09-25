import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { Download, Eye, FileText, Calendar, User, Wrench, MapPin, Building2, Loader2 } from 'lucide-react';
import SignedImage from '@industrializacao/components/SignedImage';
import EquipmentIcon from './EquipmentIcon';
import { getEquipmentStatus, getCalibrationColor, getDaysUntil } from '@industrializacao/lib/equipmentUtils';
import { fileNameFromPath, getEquipmentCertificatePath, listEquipmentFiles, parseJsonArray } from '@industrializacao/lib/equipmentFiles';
import { fmtDate } from '@/i18n/formatters';
import { translateEquipmentType, translateEquipmentCalibrationStatus, translateCalibrationDueLabel } from '@/i18n/domainMaps';

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Icon className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
      <span><b className="text-foreground">{label}:</b> {value || '—'}</span>
    </div>
  );
}

function FileActions({ path, label, onView, onDownload, loadingKey }) {
  const { t } = useTranslation();
  const viewing = loadingKey === `view:${path}`;
  const downloading = loadingKey === `download:${path}`;
  const busy = viewing || downloading;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{label}</span>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
        disabled={busy}
        onClick={() => onView(path, label)}
      >
        {viewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
        {t('common.view')}
      </button>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline disabled:opacity-50"
        disabled={busy}
        onClick={() => onDownload(path, label)}
      >
        {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        {t('common.download')}
      </button>
    </div>
  );
}

export default function EquipmentViewDialog({ open, onClose, equipment, onViewFile, onDownloadFile, fileLoadingKey }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  if (!equipment) return null;
  const status = getEquipmentStatus(equipment.next_calibration_date);
  const calColor = getCalibrationColor(equipment.next_calibration_date);
  const calDueLabel = translateCalibrationDueLabel(getDaysUntil(equipment.next_calibration_date));
  const history = parseJsonArray(equipment.calibration_history);
  const files = listEquipmentFiles(equipment);
  const certificatePath = getEquipmentCertificatePath(equipment);
  const certificateLabel = equipment.certificate_number
    ? `${t('quality.equipment.viewDialog.certificateLabel')} ${equipment.certificate_number}`
    : t('quality.equipment.viewDialog.currentCertificate');

  const fileLabel = (file) => {
    if (file.kind === 'certificate') return certificateLabel;
    if (file.kind === 'manual') return t('quality.equipment.manual');
    return file.name || fileNameFromPath(file.url);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <span className="truncate">{equipment.name}</span>
            {certificatePath && (
              <FileText
                className="w-3.5 h-3.5 shrink-0 text-muted-foreground"
                title={t('quality.equipment.viewDialog.certificateAttached')}
                aria-label={t('quality.equipment.viewDialog.certificateAttached')}
              />
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-4 mb-4">
          <div className="w-24 h-24 rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden shrink-0 border border-border">
            {equipment.image_url ? (
              <SignedImage url={equipment.image_url} alt={equipment.name} className="w-full h-full object-cover" fallbackClassName="w-full h-full" />
            ) : (
              <EquipmentIcon type={equipment.type} className="w-10 h-10 text-gray-300" />
            )}
          </div>
          <div className="flex-1 text-sm space-y-1">
            <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full mb-1 ${status.className}`}>{translateEquipmentCalibrationStatus(status.key)}</span>
            <p><b className="text-foreground">{t('quality.equipment.viewDialog.type')}:</b> {translateEquipmentType(equipment.type)}</p>
            <p><b className="text-foreground">{t('quality.equipment.viewDialog.manufacturer')}:</b> {equipment.manufacturer || '—'}</p>
            <p><b className="text-foreground">{t('quality.equipment.viewDialog.model')}:</b> {equipment.model || '—'}</p>
            <p><b className="text-foreground">{t('quality.equipment.viewDialog.serial')}:</b> {equipment.serial_number || '—'}</p>
            <p><b className="text-foreground">{t('quality.equipment.viewDialog.patrimony')}:</b> {equipment.patrimony_number || '—'}</p>
          </div>
        </div>

        <Tabs defaultValue="info">
          <TabsList className="w-full">
            <TabsTrigger value="info" className="flex-1">{t('quality.equipment.viewDialog.info')}</TabsTrigger>
            <TabsTrigger value="history" className="flex-1">{t('quality.equipment.viewDialog.historyTab', { count: history.length })}</TabsTrigger>
            <TabsTrigger value="attachments" className="flex-1">{t('quality.equipment.viewDialog.attachmentsTab', { count: files.length })}</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-2 mt-3 text-sm">
            <InfoRow icon={MapPin} label={t('quality.equipment.viewDialog.location')} value={equipment.location} />
            <InfoRow icon={User} label={t('quality.equipment.viewDialog.responsible')} value={equipment.responsible} />
            <InfoRow icon={Building2} label={t('quality.equipment.viewDialog.labResponsible')} value={equipment.lab_responsible} />
            <InfoRow icon={FileText} label={t('quality.equipment.viewDialog.certificateLabel')} value={equipment.certificate_number} />
            {certificatePath && (
              <FileActions
                path={certificatePath}
                label={certificateLabel}
                onView={onViewFile}
                onDownload={onDownloadFile}
                loadingKey={fileLoadingKey}
              />
            )}
            <InfoRow icon={Calendar} label={t('quality.equipment.viewDialog.lastCalibration')} value={fmtDate(equipment.last_calibration_date, undefined, lang)} />
            <InfoRow icon={Wrench} label={t('quality.equipment.viewDialog.calibrationCompany')} value={equipment.calibration_company} />
            <div className={`rounded-lg p-3 flex items-center gap-2 mt-2 ${calColor.bgClass}`}>
              <Calendar className={`w-4 h-4 shrink-0 ${calColor.textClass}`} />
              <div>
                <p className={`text-[10px] font-medium uppercase tracking-wide ${calColor.textClass}`}>{t('quality.equipment.viewDialog.nextCalibration')}</p>
                <p className={`font-bold ${calColor.textClass}`}>{fmtDate(equipment.next_calibration_date, undefined, lang)} · {calDueLabel}</p>
              </div>
            </div>
            {equipment.observations && <p className="text-xs text-gray-600 mt-2 p-2 bg-muted/50 rounded"><b>{t('quality.equipment.viewDialog.obs')}:</b> {equipment.observations}</p>}
          </TabsContent>

          <TabsContent value="history" className="mt-3">
            {history.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">{t('quality.equipment.viewDialog.noHistory')}</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {[...history].reverse().map((h, i) => (
                  <div key={i} className="rounded-lg border p-3 text-xs space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-foreground">{fmtDate(h.date, undefined, lang)}</span>
                      {h.certificate_url && (
                        <span className="flex items-center gap-2">
                          <button type="button" className="text-blue-600 hover:underline" onClick={() => onViewFile(h.certificate_url, h.certificate_number || t('quality.equipment.viewDialog.currentCertificate'))}>{t('common.view')}</button>
                          <button type="button" className="text-foreground hover:underline" onClick={() => onDownloadFile(h.certificate_url)}>{t('common.download')}</button>
                        </span>
                      )}
                    </div>
                    <p><b>{t('quality.equipment.viewDialog.certificateLabel')}:</b> {h.certificate_number || '—'}</p>
                    <p><b>{t('quality.equipment.viewDialog.company')}:</b> {h.company || '—'}</p>
                    <p><b>{t('quality.equipment.viewDialog.responsible')}:</b> {h.responsible || '—'}</p>
                    <p><b>{t('quality.equipment.viewDialog.next')}:</b> {fmtDate(h.next_calibration_date, undefined, lang)}</p>
                    {h.observations && <p className="text-gray-500 mt-1">{h.observations}</p>}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="attachments" className="mt-3">
            {files.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">{t('quality.equipment.viewDialog.noAttachments')}</p>
            ) : (
              <div className="space-y-2">
                {files.map((file) => (
                  <FileActions
                    key={file.id}
                    path={file.url}
                    label={fileLabel(file)}
                    onView={onViewFile}
                    onDownload={onDownloadFile}
                    loadingKey={fileLoadingKey}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
