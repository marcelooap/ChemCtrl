import React, { useState } from 'react';
import {
  Factory, ArrowLeftRight, Truck, ChevronDown, ChevronUp,
  Package, ArrowDown
} from 'lucide-react';

const fmtDateOnly = (d) => {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const fmtDateTime = (d) => {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const fmtVal = (v) => {
  if (v == null || v === '') return '—';
  if (typeof v === 'number' && isFinite(v)) return v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(T(\d{2}):(\d{2}))?/);
  if (m) {
    const d = `${m[3]}/${m[2]}/${m[1]}`;
    return m[5] ? `${d} ${m[5]}:${m[6]}` : d;
  }
  return s;
};

function DateBadge({ icon: Icon, label, date, highlighted, emptyText }) {
  const hasDate = date && fmtDateOnly(date) !== '—';
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg px-3 py-2 border"
      style={highlighted && hasDate
        ? { background: '#FFFBEB', borderColor: '#FCD34D' }
        : { background: '#F9FAFB', borderColor: '#E5E7EB' }}
    >
      <Icon className="w-4 h-4 shrink-0" style={{ color: highlighted && hasDate ? '#B45309' : '#9CA3AF' }} />
      <div className="flex flex-col min-w-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span
          className={`text-sm leading-tight ${highlighted && hasDate ? 'font-bold' : 'font-medium'}`}
          style={{ color: highlighted && hasDate ? '#B45309' : !hasDate ? '#9CA3AF' : '#374151' }}
        >
          {hasDate ? fmtDateOnly(date) : (emptyText || '—')}
        </span>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-gray-800 truncate" title={value != null ? String(value) : ''}>{fmtVal(value)}</span>
    </div>
  );
}

function TransbordoCard({ event, container }) {
  const f = event.fields;
  const origem = container
    ? `${container.container_number || ''}${container.barril_number ? ' / ' + container.barril_number : ''}`
    : '—';
  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#4B008240', background: '#FAF7FF' }}>
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: '#F5F0FF' }}>
        <ArrowLeftRight className="w-3.5 h-3.5" style={{ color: '#4B0082' }} />
        <span className="text-xs font-bold" style={{ color: '#4B0082' }}>Transbordo de Saída</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{fmtDateTime(event.date)}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-3 py-2 bg-card">
        <Field label="Origem" value={origem} />
        <Field label="Destino" value={f['Destino(s)']} />
        <Field label="Data" value={fmtDateOnly(event.date)} />
        <Field label="Vol. Transf. (L)" value={f['Volume Transferido (L)']} />
      </div>
    </div>
  );
}

export default function CycleCard({ cycle, index }) {
  const { header, production, events } = cycle;
  const [expanded, setExpanded] = useState(false);
  const container = production?.container;
  const prod = production?.production;

  // Outgoing transbordo (content transferred to another container) — closes the cycle
  const transbordoEvent = events.find(e => e.kind === 'transbordo');
  const hasTransbordo = !!transbordoEvent;

  // After transbordo, no exit date — cycle is closed by the transfer
  const exitDate = hasTransbordo ? null : header.endDate;
  const finished = !!exitDate || hasTransbordo;

  const volume = prod?.volume ?? container?.volume;
  const netWeight = container?.net_weight;
  const grossWeight = container?.gross_weight;
  const tare = container?.tare;

  const statusLabel = hasTransbordo ? 'Encerrado p/ Transbordo' : (finished ? 'Finalizado' : 'Em andamento');
  const statusColor = hasTransbordo ? { bg: '#F5F0FF', text: '#4B0082' } : (finished ? { bg: '#DCFCE7', text: '#15803D' } : { bg: '#DBEAFE', text: '#1D4ED8' });

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header strip */}
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer select-none"
        style={{ background: finished ? '#F0FDF4' : '#EFF6FF' }}
        onClick={() => setExpanded(p => !p)}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ background: hasTransbordo ? '#4B0082' : (finished ? '#16A34A' : '#2575D1') }}
          >
            {String(index + 1).padStart(2, '0')}
          </div>
          <span className="text-sm font-bold">
            OP {header.op}
          </span>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ background: statusColor.bg, color: statusColor.text }}
          >
            {statusLabel}
          </span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {/* Highlighted dates */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <DateBadge icon={Factory} label="Produção" date={header.manufactureDate} highlighted />
          <DateBadge
            icon={Truck}
            label="Saída"
            date={exitDate}
            highlighted
            emptyText={hasTransbordo ? 'Sem saída (transbordo)' : 'Pendente'}
          />
        </div>

        {/* Key fields */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="Produto" value={header.product} />
          <Field label="Cliente" value={header.client} />
          <Field label="Lote" value={header.lot} />
        </div>

        {/* Expanded info */}
        {expanded && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-border">
            <Field label="Volume (L)" value={volume} />
            <Field label="Tara (kg)" value={tare} />
            <Field label="Líquido (kg)" value={netWeight} />
            <Field label="Bruto (kg)" value={grossWeight} />
            {container?.seals && <Field label="Lacres" value={container.seals} />}
            {container?.operator && <Field label="Responsável" value={container.operator} />}
            {prod?.status && <Field label="Status OP" value={prod.status} />}
            {prod?.qc_status && <Field label="Status CQ" value={prod.qc_status} />}
          </div>
        )}

        {/* Transbordo card — closes the cycle */}
        {hasTransbordo && transbordoEvent && (
          <>
            <div className="flex justify-center py-1.5">
              <ArrowDown className="w-4 h-4 text-muted-foreground" />
            </div>
            <TransbordoCard event={transbordoEvent} container={container} />
          </>
        )}
      </div>
    </div>
  );
}
