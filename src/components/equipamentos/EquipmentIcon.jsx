import {
  Scale, FlaskConical, Thermometer, Gauge, Flame, ThermometerSun,
  RefreshCw, Palette, ScanLine, Droplets, Scan, Zap,
  FlaskRound, Microscope, Boxes, HelpCircle
} from 'lucide-react';

const ICON_MAP = {
  'Balança': Scale,
  'pHmetro': FlaskConical,
  'Termômetro': Thermometer,
  'Viscosímetro': Gauge,
  'Estufa': ThermometerSun,
  'Mufla': Flame,
  'Agitador': RefreshCw,
  'Colorímetro': Palette,
  'Espectrofotômetro': ScanLine,
  'Densímetro': Droplets,
  'Refratômetro': Scan,
  'Condutivímetro': Zap,
  'Titulador': FlaskRound,
  'Microscópio': Microscope,
  'Outro': Boxes,
};

export default function EquipmentIcon({ type, className }) {
  const Icon = ICON_MAP[type] || HelpCircle;
  return <Icon className={className} />;
}
