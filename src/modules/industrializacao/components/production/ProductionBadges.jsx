import React from 'react';
import { translateProductionStatus } from '@/i18n/domainMaps';

export const etapaColors = {
  'Aguardando Início': '#6B7280',
  'Em Produção': '#2563EB',
  'Qualidade': '#7C3AED',
  'Envase': '#D97706',
  'Finalizado': '#15803D',
  'Cancelado': '#B91C1C',
};

export function EtapaBadge({ status }) {
  const color = etapaColors[status] || '#6B7280';
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${color}1A`, color }}>
      {translateProductionStatus(status)}
    </span>
  );
}

export function ProgressSegments({ status }) {
  const steps = ['Em Produção', 'Qualidade', 'Envase', 'Finalizado'];
  const statusToStep = { 'Aguardando Início': 0, 'Em Produção': 1, 'Qualidade': 2, 'Envase': 3, 'Finalizado': 4 };
  const currentStep = statusToStep[status] ?? 0;
  const color = etapaColors[status] || '#6B7280';
  return (
    <div className="flex items-center gap-1">
      {steps.map((_, i) => (
        <div key={i} className="w-6 h-2 rounded-sm" style={{ background: i < currentStep ? color : '#E5E7EB' }} />
      ))}
    </div>
  );
}
