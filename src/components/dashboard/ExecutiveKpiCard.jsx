import React from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';

export default function ExecutiveKpiCard({
  title,
  value,
  subtitle,
  comparison,
  comparisonLabel,
  icon: Icon,
  color,
  onClick,
  clickable = false,
}) {
  const Wrapper = clickable ? 'button' : 'div';

  return (
    <Wrapper
      type={clickable ? 'button' : undefined}
      onClick={clickable ? onClick : undefined}
      className={`bg-card rounded-xl border border-border p-5 flex flex-col text-left w-full ${
        clickable ? 'cursor-pointer hover:ring-2 hover:ring-primary/30 transition-shadow' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: color }}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {subtitle && <p className="text-xs mt-1 text-muted-foreground">{subtitle}</p>}
      {comparison === null ? (
        <p className="text-xs mt-2 text-muted-foreground">-</p>
      ) : comparison != null && (
        <p className={`text-xs mt-2 flex items-center gap-1 ${comparison >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {comparison >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          <span>{Math.abs(comparison).toFixed(1)}%{comparisonLabel ? ` ${comparisonLabel}` : ''}</span>
        </p>
      )}
    </Wrapper>
  );
}
