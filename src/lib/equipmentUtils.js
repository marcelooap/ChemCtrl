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
  if (days === null) return { key: 'sem_data', label: 'Sem data', color: '#6b7280', bg: '#f3f4f6' };
  if (days < 0) return { key: 'vencido', label: 'Vencido', color: '#EF4444', bg: '#FEE2E2' };
  if (days <= 30) return { key: 'vencer', label: 'A Vencer', color: '#F59E0B', bg: '#FEF3C7' };
  return { key: 'conforme', label: 'Conforme', color: '#10B981', bg: '#D1FAE5' };
};

// Footer color: Green >60d | Yellow 30-60d | Orange 7-30d | Red <7d/expired
export const getCalibrationColor = (nextDate) => {
  const days = getDaysUntil(nextDate);
  if (days === null) return { color: '#6b7280', bg: '#f9fafb', label: 'Sem data' };
  if (days < 0) return { color: '#EF4444', bg: '#FEE2E2', label: `Vencido há ${Math.abs(days)}d` };
  if (days <= 7) return { color: '#EF4444', bg: '#FEE2E2', label: `Em ${days}d` };
  if (days <= 30) return { color: '#F97316', bg: '#FFEDD5', label: `Em ${days}d` };
  if (days <= 60) return { color: '#F59E0B', bg: '#FEF3C7', label: `Em ${days}d` };
  return { color: '#10B981', bg: '#D1FAE5', label: `Em ${days}d` };
};

import { fmtDate } from '@/i18n/formatters';

export const formatDate = (d) => {
  if (!d) return '—';
  return fmtDate(d + 'T00:00:00');
};
