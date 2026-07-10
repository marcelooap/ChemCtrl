import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, FileText, Calendar, User, Wrench, MapPin, Building2 } from 'lucide-react';
import SignedImage from '@/components/SignedImage';
import EquipmentIcon from './EquipmentIcon';
import { getEquipmentStatus, getCalibrationColor, getDaysUntil } from '@/lib/equipmentUtils';
import { fmtDate } from '@/i18n/formatters';
import { translateEquipmentType, translateEquipmentCalibrationStatus, translateCalibrationDueLabel } from '@/i18n/domainMaps';
// eslint-disable-next-line
import { getSignedFileUrl } from '@/api/storage'; // storage module (split from supabaseClient)

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 text-gray-600">
      <Icon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      <span><b className="text-foreground">{label}:</b> {value || '—'}</span>
    </div>
  );
}

const parseArr = (v) => {
  try { if (Array.isArray(v)) return v; if (typeof v === 'string') { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } return []; } catch { return []; }
};

export default function EquipmentViewDialog({ open, onClose, equipment }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  if (!equipment) return null;
  const status = getEquipmentStatus(equipment.next_calibration_date);
  const calColor = getCalibrationColor(equipment.next_calibration_date);
  const calDueLabel = translateCalibrationDueLabel(getDaysUntil(equipment.next_calibration_date));
  const history = parseArr(equipment.calibration_history);
  const attachments = parseArr(equipment.attachments);

  const downloadFile = async (path) => {
    const url = await getSignedFileUrl(path);
    window.open(url, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{equipment.name}</DialogTitle></DialogHeader>

        <div className="flex gap-4 mb-4">
          <div className="w-24 h-24 rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden shrink-0 border border-border">
            {equipment.image_url ? (
              <SignedImage url={equipment.image_url} alt={equipment.name} className="w-full h-full object-cover" fallbackClassName="w-full h-full" />
            ) : (
              <EquipmentIcon type={equipment.type} className="w-10 h-10 text-gray-300" />
            )}
          </div>
          <div className="flex-1 text-sm space-y-1">
            <span className="inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full mb-1" style={{ color: status.color, background: status.bg }}>{translateEquipmentCalibrationStatus(status.key)}</span>
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
            <TabsTrigger value="attachments" className="flex-1">{t('quality.equipment.viewDialog.attachmentsTab', { count: attachments.length })}</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-2 mt-3 text-sm">
            <InfoRow icon={MapPin} label={t('quality.equipment.viewDialog.location')} value={equipment.location} />
            <InfoRow icon={User} label={t('quality.equipment.viewDialog.responsible')} value={equipment.responsible} />
            <InfoRow icon={Building2} label={t('quality.equipment.viewDialog.labResponsible')} value={equipment.lab_responsible} />
            <InfoRow icon={FileText} label={t('quality.equipment.viewDialog.certificateLabel')} value={equipment.certificate_number} />
            <InfoRow icon={Calendar} label={t('quality.equipment.viewDialog.lastCalibration')} value={fmtDate(equipment.last_calibration_date, undefined, lang)} />
            <InfoRow icon={Wrench} label={t('quality.equipment.viewDialog.calibrationCompany')} value={equipment.calibration_company} />
            <div className="rounded-lg p-3 flex items-center gap-2 mt-2" style={{ background: calColor.bg }}>
              <Calendar className="w-4 h-4 shrink-0" style={{ color: calColor.color }} />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: calColor.color }}>{t('quality.equipment.viewDialog.nextCalibration')}</p>
                <p className="font-bold" style={{ color: calColor.color }}>{fmtDate(equipment.next_calibration_date, undefined, lang)} · {calDueLabel}</p>
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
                      {h.certificate_url && <button className="text-blue-600 hover:underline" onClick={() => downloadFile(h.certificate_url)}>{t('quality.equipment.viewDialog.viewCertificate')}</button>}
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
            {attachments.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">{t('quality.equipment.viewDialog.noAttachments')}</p>
            ) : (
              <div className="space-y-2">
                {attachments.map((a, i) => (
                  <button key={i} onClick={() => downloadFile(a.url)} className="w-full flex items-center gap-2 rounded-lg border p-3 text-xs hover:bg-accent/50 transition-colors">
                    <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="flex-1 text-left text-foreground truncate">{a.name}</span>
                    <Download className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
