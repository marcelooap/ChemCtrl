import React from 'react';
import { Zap, ArrowRight } from 'lucide-react';
import { EtapaBadge, ProgressSegments } from './ProductionBadges';

const fmt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function ProductionTrackingTable({ productions, onBypass, bypassing, showClient = true, showBypass = true, onViewAll, maxRows = 10 }) {
  if (!productions || productions.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-sm text-muted-foreground">
        Nenhuma produção em andamento.
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">OP</th>
              <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Produto</th>
              {showClient && <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</th>}
              <th className="px-5 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Volume (L)</th>
              <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Embalagem</th>
              <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Etapa</th>
              <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Progresso</th>
              {showBypass && <th className="px-5 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">By-pass</th>}
            </tr>
          </thead>
          <tbody>
            {productions.slice(0, maxRows).map(p => (
              <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50/50" style={{ height: '48px' }}>
                <td className="px-5 py-2 font-bold text-sm font-mono" style={{ color: '#2E5AAC' }}>{p.op_number}</td>
                <td className="px-5 py-2 text-sm" style={{ color: '#333' }}>{p.product}</td>
                {showClient && <td className="px-5 py-2 text-sm" style={{ color: '#9CA3AF' }}>{p.client}</td>}
                <td className="px-5 py-2 text-right font-bold text-sm" style={{ color: '#000' }}>{fmt(p.volume || 0)} L</td>
                <td className="px-5 py-2 text-sm" style={{ color: '#888' }}>{p.packaging_type || '—'}</td>
                <td className="px-5 py-2"><EtapaBadge status={p.status} /></td>
                <td className="px-5 py-2"><ProgressSegments status={p.status} /></td>
                {showBypass && (
                  <td className="px-5 py-2 text-center">
                    <button
                      onClick={() => onBypass?.(p)}
                      disabled={bypassing === p.id}
                      className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded border disabled:opacity-50 transition-colors ${p.bypass_qc ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100' : 'border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-gray-400'}`}
                    >
                      {bypassing === p.id ? <div className="w-3 h-3 border border-gray-300 border-t-current rounded-full animate-spin" /> : <Zap className="w-3 h-3" />}
                      {p.bypass_qc ? 'Ativo' : 'By-pass'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onViewAll && (
        <div className="px-5 py-3 border-t border-gray-100">
          <button onClick={onViewAll} className="text-xs font-medium flex items-center gap-1" style={{ color: '#2575D1' }}>
            Ver todas <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
