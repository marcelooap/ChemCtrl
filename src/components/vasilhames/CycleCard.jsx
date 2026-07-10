import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Factory, ArrowLeftRight, Truck, ChevronDown, ChevronUp, ArrowDown
} from 'lucide-react';
import { fmtDate, fmtDateTime, fmtNumber } from '@/i18n/formatters';
import { translateCycleStatus, translateProductionStatus, translateQcStatus } from '@/i18n/domainMaps';

function DateBadge({ icon: Icon, label, date, highlighted, emptyText }) {
  const { i18n } = useTranslation();
  const formatted = fmtDate(date, undefined, i18n.language);
  const hasDate = date && formatted !== '—';
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
          {hasDate ? formatted : (emptyText || '—')}
        </span>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  const { i18n } = useTranslation();
  const fmtVal = (v) => {
    if (v == null || v === '') return '—';
    if (typeof v === 'number' && isFinite(v)) return fmtNumber(v, { maximumFractionDigits: 3 }, i18n.language);
    const s = String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(T(\d{2}):(\d{2}))?/);
    if (m) {
      const d = `${m[3]}/${m[2]}/${m[1]}`;
      return m[5] ? `${d} ${m[5]}:${m[6]}` : d;
    }
    return s;
  };

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-gray-800 truncate" title={value != null ? String(value) : ''}>{fmtVal(value)}</span>
    </div>
  );
}

function TransbordoCard({ event, container }) {
  const { t, i18n } = useTranslation();
  const f = event.fields;
  const origem = container
    ? `${container.container_number || ''}${container.barril_number ? ' / ' + container.barril_number : ''}`
    : '—';
  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#4B008240', background: '#FAF7FF' }}>
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: '#F5F0FF' }}>
        <ArrowLeftRight className="w-3.5 h-3.5" style={{ color: '#4B0082' }} />
        <span className="text-xs font-bold" style={{ color: '#4B0082' }}>{t('containers.cycleCard.outgoingTransfer')}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{fmtDateTime(event.date, undefined, i18n.language)}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-3 py-2 bg-card">
        <Field label={t('containers.cycleCard.origin')} value={origem} />
        <Field label={t('transfer.viewDialog.destinations')} value={f['Destino(s)']} />
        <Field label={t('common.date')} value={fmtDate(event.date, undefined, i18n.language)} />
        <Field label={t('containers.cycleCard.transferredVolumeL')} value={f['Volume Transferido (L)']} />
      </div>
    </div>
  );
}

export default function CycleCard({ cycle, index }) {
  const { t } = useTranslation();
  const { header, production, events } = cycle;
  const [expanded, setExpanded] = useState(false);
  const container = production?.container;
  const prod = production?.production;

  const transbordoEvent = events.find(e => e.kind === 'transbordo');
  const hasTransbordo = !!transbordoEvent;
  const exitDate = hasTransbordo ? null : header.endDate;
  const finished = !!exitDate || hasTransbordo;

  const volume = prod?.volume ?? container?.volume;
  const netWeight = container?.net_weight;
  const grossWeight = container?.gross_weight;
  const tare = container?.tare;

  const statusKey = hasTransbordo ? 'Encerrado p/ Transbordo' : (finished ? 'Finalizado' : 'Em andamento');
  const statusLabel = translateCycleStatus(statusKey);
  const statusColor = hasTransbordo ? { bg: '#F5F0FF', text: '#4B0082' } : (finished ? { bg: '#DCFCE7', text: '#15803D' } : { bg: '#DBEAFE', text: '#1D4ED8' });

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
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
            {t('production.opNumber')} {header.op}
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

      <div className="px-4 py-3">
        <div className="grid grid-cols-2 gap-2 mb-3">
          <DateBadge icon={Factory} label={t('containers.cycleCard.production')} date={header.manufactureDate} highlighted />
          <DateBadge
            icon={Truck}
            label={t('containers.cycleCard.departure')}
            date={exitDate}
            highlighted
            emptyText={hasTransbordo ? t('containers.cycleCard.noDepartureTransfer') : t('containers.cycleCard.pending')}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label={t('common.product')} value={header.product} />
          <Field label={t('common.client')} value={header.client} />
          <Field label={t('common.lot')} value={header.lot} />
        </div>

        {expanded && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-border">
            <Field label={t('production.tracking.volume')} value={volume} />
            <Field label={t('packaging.fields.tare')} value={tare} />
            <Field label={t('containers.cycleCard.liquidKg')} value={netWeight} />
            <Field label={t('containers.cycleCard.grossKg')} value={grossWeight} />
            {container?.seals && <Field label={t('packaging.fields.seals')} value={container.seals} />}
            {container?.operator && <Field label={t('containers.viewDialog.responsible')} value={container.operator} />}
            {prod?.status && <Field label={t('containers.cycleCard.opStatus')} value={translateProductionStatus(prod.status)} />}
            {prod?.qc_status && <Field label={t('containers.cycleCard.qcStatus')} value={translateQcStatus(prod.qc_status)} />}
          </div>
        )}

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
