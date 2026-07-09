import { MoreVertical, Calendar, FileText } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import SignedImage from '@/components/SignedImage';
import EquipmentIcon from './EquipmentIcon';
import { getEquipmentStatus, getCalibrationColor, formatDate } from '@/lib/equipmentUtils';

export default function EquipmentCard({ equipment, onEdit, onDelete, onView, onCalibrate }) {
  const status = getEquipmentStatus(equipment.next_calibration_date);
  const calColor = getCalibrationColor(equipment.next_calibration_date);

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow">
      <div className="relative h-32 bg-muted/50 flex items-center justify-center">
        {equipment.image_url ? (
          <SignedImage url={equipment.image_url} alt={equipment.name} className="w-full h-full object-cover" fallbackClassName="w-full h-full" />
        ) : (
          <EquipmentIcon type={equipment.type} className="w-12 h-12 text-gray-300" />
        )}
        <span className="absolute top-2 left-2 text-xs font-semibold px-2.5 py-0.5 rounded-full shadow-sm" style={{ color: status.color, background: status.bg }}>{status.label}</span>
        <div className="absolute top-1.5 right-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-7 h-7 rounded-lg bg-white/90 backdrop-blur flex items-center justify-center hover:bg-white shadow-sm">
                <MoreVertical className="w-4 h-4 text-gray-500" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onView(equipment)}>Visualizar</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(equipment)}>Editar</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCalibrate(equipment)}>Registrar calibração</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onView(equipment)}>Anexos</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onView(equipment)}>Histórico</DropdownMenuItem>
              <DropdownMenuItem className="text-red-600" onClick={() => onDelete(equipment)}>Excluir</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col gap-2">
        <div>
          <h3 className="font-bold text-gray-800 text-sm leading-tight truncate">{equipment.name}</h3>
          <p className="text-xs text-gray-500 truncate">Modelo: {equipment.model || '—'}</p>
          <p className="text-xs text-gray-500 truncate">Patrimônio: {equipment.patrimony_number || '—'}</p>
        </div>
        <div className="text-xs space-y-1 mt-auto">
          <div className="flex items-center gap-1.5 text-gray-600">
            <FileText className="w-3 h-3 text-gray-400 shrink-0" />
            <span className="truncate">Certificado: {equipment.certificate_number || '—'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-600">
            <Calendar className="w-3 h-3 text-gray-400 shrink-0" />
            <span className="truncate">Últ. Calibração: {formatDate(equipment.last_calibration_date)}</span>
          </div>
        </div>
      </div>

      <div className="px-4 py-2.5 border-t flex items-center gap-2" style={{ background: calColor.bg }}>
        <Calendar className="w-4 h-4 shrink-0" style={{ color: calColor.color }} />
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: calColor.color }}>Próxima Calibração</p>
          <p className="text-sm font-bold leading-tight" style={{ color: calColor.color }}>
            {formatDate(equipment.next_calibration_date)} <span className="text-xs font-medium">· {calColor.label}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
