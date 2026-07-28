export const EQUIPMENT_TYPES = [
  'Balança', 'pHmetro', 'Termômetro', 'Viscosímetro', 'Estufa', 'Mufla',
  'Agitador', 'Colorímetro', 'Espectrofotômetro', 'Densímetro',
  'Refratômetro', 'Condutivímetro', 'Titulador', 'Microscópio', 'Outro'
];

export const getDaysUntil = (dateStr) => {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.ceil((target - today) / 86400000);
};

// Badge status: Conforme / A Vencer / Vencido
export const getEquipmentStatus = (nextDate) => {
  const days = getDaysUntil(nextDate);
  if (days === null) {
    return {
      key: 'sem_data',
      label: 'Sem data',
      className: 'bg-muted text-muted-foreground',
      // Legacy hex kept for any remaining style consumers
      color: '#6b7280',
      bg: '#f3f4f6',
    };
  }
  if (days < 0) {
    return {
      key: 'vencido',
      label: 'Vencido',
      className: 'bg-red-100 text-red-700',
      color: '#EF4444',
      bg: '#FEE2E2',
    };
  }
  if (days <= 30) {
    return {
      key: 'vencer',
      label: 'A Vencer',
      className: 'bg-amber-100 text-amber-700',
      color: '#F59E0B',
      bg: '#FEF3C7',
    };
  }
  return {
    key: 'conforme',
    label: 'Conforme',
    className: 'bg-green-100 text-green-700',
    color: '#10B981',
    bg: '#D1FAE5',
  };
};

// Footer color: Green >60d | Yellow 30-60d | Orange 7-30d | Red <7d/expired
export const getCalibrationColor = (nextDate) => {
  const days = getDaysUntil(nextDate);
  if (days === null) {
    return {
      className: 'bg-muted text-muted-foreground',
      textClass: 'text-muted-foreground',
      bgClass: 'bg-muted',
      color: '#6b7280',
      bg: '#f9fafb',
      label: 'Sem data',
    };
  }
  if (days < 0) {
    return {
      className: 'bg-red-100 text-red-700',
      textClass: 'text-red-700',
      bgClass: 'bg-red-100',
      color: '#EF4444',
      bg: '#FEE2E2',
      label: `Vencido há ${Math.abs(days)}d`,
    };
  }
  if (days <= 7) {
    return {
      className: 'bg-red-100 text-red-700',
      textClass: 'text-red-700',
      bgClass: 'bg-red-100',
      color: '#EF4444',
      bg: '#FEE2E2',
      label: `Em ${days}d`,
    };
  }
  if (days <= 30) {
    return {
      className: 'bg-orange-100 text-orange-700',
      textClass: 'text-orange-700',
      bgClass: 'bg-orange-100',
      color: '#F97316',
      bg: '#FFEDD5',
      label: `Em ${days}d`,
    };
  }
  if (days <= 60) {
    return {
      className: 'bg-amber-100 text-amber-700',
      textClass: 'text-amber-700',
      bgClass: 'bg-amber-100',
      color: '#F59E0B',
      bg: '#FEF3C7',
      label: `Em ${days}d`,
    };
  }
  return {
    className: 'bg-green-100 text-green-700',
    textClass: 'text-green-700',
    bgClass: 'bg-green-100',
    color: '#10B981',
    bg: '#D1FAE5',
    label: `Em ${days}d`,
  };
};

import { fmtDate } from '@/i18n/formatters';

export const formatDate = (d) => {
  if (!d) return '—';
  return fmtDate(d + 'T00:00:00');
};
