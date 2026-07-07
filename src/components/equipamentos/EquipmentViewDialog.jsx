import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, FileText, Calendar, User, Wrench, MapPin, Building2 } from 'lucide-react';
import SignedImage from '@/components/SignedImage';
import EquipmentIcon from './EquipmentIcon';
import { getEquipmentStatus, getCalibrationColor, formatDate } from '@/lib/equipmentUtils';
// eslint-disable-next-line
import { getSignedFileUrl } from '@/api/storage'; // storage module (split from supabaseClient)

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 text-gray-600">
      <Icon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      <span><b className="text-gray-700">{label}:</b> {value || '—'}</span>
    </div>
  );
}

const parseArr = (v) => {
  try { if (Array.isArray(v)) return v; if (typeof v === 'string') { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } return []; } catch { return []; }
};

export default function EquipmentViewDialog({ open, onClose, equipment }) {
  if (!equipment) return null;
  const status = getEquipmentStatus(equipment.next_calibration_date);
  const calColor = getCalibrationColor(equipment.next_calibration_date);
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
          <div className="w-24 h-24 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden shrink-0 border border-gray-100">
            {equipment.image_url ? (
              <SignedImage url={equipment.image_url} alt={equipment.name} className="w-full h-full object-cover" fallbackClassName="w-full h-full" />
            ) : (
              <EquipmentIcon type={equipment.type} className="w-10 h-10 text-gray-300" />
            )}
          </div>
          <div className="flex-1 text-sm space-y-1">
            <span className="inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full mb-1" style={{ color: status.color, background: status.bg }}>{status.label}</span>
            <p><b className="text-gray-700">Tipo:</b> {equipment.type}</p>
            <p><b className="text-gray-700">Fabricante:</b> {equipment.manufacturer || '—'}</p>
            <p><b className="text-gray-700">Modelo:</b> {equipment.model || '—'}</p>
            <p><b className="text-gray-700">Série:</b> {equipment.serial_number || '—'}</p>
            <p><b className="text-gray-700">Patrimônio:</b> {equipment.patrimony_number || '—'}</p>
          </div>
        </div>

        <Tabs defaultValue="info">
          <TabsList className="w-full">
            <TabsTrigger value="info" className="flex-1">Informações</TabsTrigger>
            <TabsTrigger value="history" className="flex-1">Histórico ({history.length})</TabsTrigger>
            <TabsTrigger value="attachments" className="flex-1">Anexos ({attachments.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-2 mt-3 text-sm">
            <InfoRow icon={MapPin} label="Localização" value={equipment.location} />
            <InfoRow icon={User} label="Responsável" value={equipment.responsible} />
            <InfoRow icon={Building2} label="Lab. Responsável" value={equipment.lab_responsible} />
            <InfoRow icon={FileText} label="Certificado" value={equipment.certificate_number} />
            <InfoRow icon={Calendar} label="Última Calibração" value={formatDate(equipment.last_calibration_date)} />
            <InfoRow icon={Wrench} label="Empresa Calibração" value={equipment.calibration_company} />
            <div className="rounded-lg p-3 flex items-center gap-2 mt-2" style={{ background: calColor.bg }}>
              <Calendar className="w-4 h-4 shrink-0" style={{ color: calColor.color }} />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: calColor.color }}>Próxima Calibração</p>
                <p className="font-bold" style={{ color: calColor.color }}>{formatDate(equipment.next_calibration_date)} · {calColor.label}</p>
              </div>
            </div>
            {equipment.observations && <p className="text-xs text-gray-600 mt-2 p-2 bg-gray-50 rounded"><b>Obs:</b> {equipment.observations}</p>}
          </TabsContent>

          <TabsContent value="history" className="mt-3">
            {history.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Nenhum histórico registrado.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {[...history].reverse().map((h, i) => (
                  <div key={i} className="rounded-lg border p-3 text-xs space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-gray-700">{formatDate(h.date)}</span>
                      {h.certificate_url && <button className="text-blue-600 hover:underline" onClick={() => downloadFile(h.certificate_url)}>Ver certificado</button>}
                    </div>
                    <p><b>Certificado:</b> {h.certificate_number || '—'}</p>
                    <p><b>Empresa:</b> {h.company || '—'}</p>
                    <p><b>Responsável:</b> {h.responsible || '—'}</p>
                    <p><b>Próxima:</b> {formatDate(h.next_calibration_date)}</p>
                    {h.observations && <p className="text-gray-500 mt-1">{h.observations}</p>}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="attachments" className="mt-3">
            {attachments.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Nenhum anexo.</p>
            ) : (
              <div className="space-y-2">
                {attachments.map((a, i) => (
                  <button key={i} onClick={() => downloadFile(a.url)} className="w-full flex items-center gap-2 rounded-lg border p-3 text-xs hover:bg-gray-50 transition-colors">
                    <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="flex-1 text-left text-gray-700 truncate">{a.name}</span>
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
