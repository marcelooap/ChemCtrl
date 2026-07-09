import React from 'react';
import { Eye, MapPin, Calendar, Package, Clock } from 'lucide-react';
import { brasiliaDate, waitInterval } from '@/lib/brasilTime';

const statusConfig = {
  'Aguardando Início': { bg: '#f1f5f9', text: '#475569', step: 0 },
  'Em Produção': { bg: '#e0f2fe', text: '#0369a1', step: 1 },
  'Qualidade': { bg: '#f5f3ff', text: '#7c3aed', step: 2 },
  'Envase': { bg: '#fff7ed', text: '#d97706', step: 3 },
  'Finalizado': { bg: '#dcfce7', text: '#15803d', step: 4 },
  'Cancelado': { bg: '#fee2e2', text: '#991b1b', step: 0 },
};

const priorityColors = {
  Baixa: 'bg-green-100 text-green-700',
  Média: 'bg-amber-100 text-amber-700',
  Alta: 'bg-red-100 text-red-700',
};

const fmt3 = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export default function ProductionCard({ prod, onView, children }) {
  const cfg = statusConfig[prod.status] || statusConfig['Aguardando Início'];
  return (
    <div className="bg-card rounded-xl border shadow-sm overflow-hidden relative" style={{ borderColor: '#e2e8f0' }}>
      <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: cfg.text }} />
      <div className="px-4 py-3 flex items-center justify-between border-b ml-1.5" style={{ borderColor: '#f1f5f9' }}>
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm" style={{ color: '#1e40af' }}>{prod.op_number}</span>
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${priorityColors[prod.priority] || priorityColors['Média']}`}>{prod.priority}</span>
        </div>
        <div className="flex items-center gap-2">
          {onView && (
            <button onClick={() => onView(prod)} className="text-muted-foreground hover:text-[#1e40af] transition-colors" title="Visualizar">
              <Eye className="w-4 h-4" />
            </button>
          )}
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: cfg.bg, color: cfg.text }}>{prod.status}</span>
        </div>
      </div>
      <div className="px-4 py-3 ml-1.5">
        <h4 className="font-semibold text-sm mb-0.5" style={{ color: '#1f2937' }}>{prod.product}</h4>
        <p className="text-xs mb-3" style={{ color: '#64748b' }}>{prod.client}</p>
        <div className="flex items-center gap-4 text-xs mb-2" style={{ color: '#64748b' }}>
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> Lote: {prod.lot}</span>
          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {brasiliaDate(prod.date)}</span>
        </div>
        <div className="flex items-center gap-1 text-xs mb-2" style={{ color: '#64748b' }}>
          <Clock className="w-3 h-3" /> Aguardando início: <strong style={{ color: '#1f2937' }}>{waitInterval(prod.created_date, prod.start_time)}</strong>
        </div>
        <div className="flex items-center gap-4 text-xs mb-2" style={{ color: '#64748b' }}>
          <span>Volume: <strong style={{ color: '#1f2937' }}>{fmt3(prod.volume)} L</strong></span>
          <span>Massa: <strong style={{ color: '#1f2937' }}>{fmt3(prod.mass)} kg</strong></span>
        </div>
        {prod.packaging_type && (
          <div className="flex items-center gap-1 text-xs mb-3" style={{ color: '#64748b' }}>
            <Package className="w-3 h-3" /> Embalagem: {prod.packaging_type}
          </div>
        )}
        <div className="flex gap-1 mb-3 mt-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i < cfg.step ? '#1e40af' : '#e2e8f0' }} />
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}
