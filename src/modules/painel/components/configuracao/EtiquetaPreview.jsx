import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import {
  formatEtiquetaDate,
  partitionEtiquetaCampos,
} from '@transbordo/lib/etiquetaConfig';

function FieldRow({ label, value, wrap = false, stacked = false }) {
  if (stacked) {
    return (
      <div className="min-w-0">
        <div className="text-[8px] font-extrabold uppercase leading-none tracking-wide">
          {label}
        </div>
        <div className="text-[10px] font-bold leading-tight truncate mt-[1px]">
          {value}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-1 text-[10px] leading-tight min-w-0">
      <span className="font-extrabold uppercase shrink-0">{label}</span>
      <span className="font-bold text-black/80 shrink-0">•</span>
      <span
        className={`font-bold min-w-0 ${
          wrap ? 'break-words whitespace-normal leading-snug' : 'truncate'
        }`}
        style={
          wrap
            ? {
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
            : undefined
        }
      >
        {value}
      </span>
    </div>
  );
}

function WeightTable({ layout, t, v, compact = false }) {
  if (layout.weights.length === 0) return null;
  return (
    <table className={`w-full border-collapse shrink-0 ${compact ? 'mt-1 text-[8px]' : 'mt-0.5 text-[9px]'}`}>
      <tbody>
        {layout.weights.map((w, i) => (
          <tr key={w.key}>
            {i === 0 && (
              <td
                rowSpan={layout.weights.length}
                className="border border-black px-1 py-0.5 font-extrabold uppercase text-center w-[28%]"
              >
                {t('pdf.label.mass')}
              </td>
            )}
            <td className="border border-black px-1 py-0.5 font-bold uppercase w-[38%]">
              {w.key === 'peso_bruto' ? t('pdf.label.grossWeight') : t('pdf.label.netWeight')}
            </td>
            <td className="border border-black px-1 py-0.5 font-extrabold text-right">
              {w.key === 'peso_bruto'
                ? `${Number(v.gross_weight || 0).toFixed(3)} kg`
                : `${Number(v.net_weight || 0).toFixed(3)} kg`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function EtiquetaPreview({
  campos,
  values,
  dateFormat = 'dmy',
  orientation = 'horizontal',
  className = '',
}) {
  const { t, i18n } = useTranslation();
  const layout = partitionEtiquetaCampos(campos);
  const dataLayout = layout.dataLayout || { mode: 'stack', left: layout.dataRows || [], right: [] };
  const v = values || {};
  const vertical = orientation === 'vertical';
  const split = dataLayout.mode === 'split';
  const dense = split || dataLayout.left.length >= 4;

  const dataValue = (key) => {
    switch (key) {
      case 'id':
        return v.op_number || '—';
      case 'lote':
        return v.lot || '—';
      case 'fabricacao':
        return formatEtiquetaDate(v.manufactureDate, dateFormat, i18n.language);
      case 'validade':
        return formatEtiquetaDate(v.expiryDate, dateFormat, i18n.language);
      case 'cliente':
        return v.client || '—';
      case 'volume':
        return v.volume != null ? `${v.volume} L` : '—';
      case 'responsavel_tecnico':
        return v.responsavel_tecnico || '—';
      default:
        return '—';
    }
  };

  const dataLabel = (key) => {
    const map = {
      id: t('pdf.label.ref'),
      lote: t('pdf.label.lot'),
      fabricacao: t('pdf.label.manufacture'),
      validade: t('pdf.label.expiry'),
      cliente: t('pdf.label.client'),
      volume: t('pdf.label.volume', { defaultValue: 'VOLUME' }),
      responsavel_tecnico: t('pdf.label.technicalManager', { defaultValue: 'RESP. TÉC.' }),
    };
    return map[key] || key;
  };

  const wrapKey = (key) => key === 'responsavel_tecnico' || key === 'cliente';

  const renderRows = (rows, stacked = false) =>
    rows.map((row) => (
      <FieldRow
        key={row.key}
        stacked={stacked}
        wrap={wrapKey(row.key)}
        label={dataLabel(row.key)}
        value={dataValue(row.key)}
      />
    ));

  const embalagem = v.barril_number
    ? `${v.container_number || ''} (${v.barril_number})`
    : v.container_number || v.packaging_type || '—';

  const qrUrl = `${(import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/+$/, '')}/consulta/${v.publicToken || 'preview'}`;

  const allRows = [...(dataLayout.left || []), ...(dataLayout.right || [])];
  const byKey = new Map(allRows.map((row) => [row.key, row]));
  const dateRows = ['fabricacao', 'validade'].map((key) => byKey.get(key)).filter(Boolean);
  const rtRows = byKey.get('responsavel_tecnico') ? [byKey.get('responsavel_tecnico')] : [];
  const otherRows = allRows.filter(
    (row, index, list) =>
      list.findIndex((item) => item.key === row.key) === index &&
      row.key !== 'fabricacao' &&
      row.key !== 'validade' &&
      row.key !== 'responsavel_tecnico'
  );

  const packaging = layout.showEmbalagem && (
    <div className={`font-extrabold uppercase flex items-baseline gap-1 shrink-0 min-w-0 ${vertical ? 'text-[9px] mt-1' : 'text-[10px] mt-0.5'}`}>
      <span className="shrink-0">{t('pdf.label.packaging')}</span>
      <span>•</span>
      <span className={`truncate ${vertical ? 'text-[10px]' : 'text-[11px]'}`}>{embalagem}</span>
    </div>
  );

  const qrBlock = layout.showQr && (
    <div className={`shrink-0 flex flex-col items-center ${vertical ? 'py-1' : 'w-[88px] border-l border-black pl-2'}`}>
      {layout.showId && (
        <div className={`font-bold ${vertical ? 'text-[9px]' : 'text-[10px] self-start'}`}>
          {t('pdf.label.ref')}: {v.op_number || '—'}
        </div>
      )}
      <div className="flex items-center justify-center py-0.5">
        <QRCodeSVG value={qrUrl} size={vertical ? 84 : dense ? 64 : 72} level="M" bgColor="#ffffff" fgColor="#000000" />
      </div>
      <div className="text-[6px] font-bold uppercase text-center leading-tight">
        {t('pdf.label.qrHint')}
      </div>
    </div>
  );

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {t('painel.configuracao.etiquetas.previewTitle')}
      </p>
      <div
        className="bg-white text-black border border-black shadow-lg origin-top overflow-hidden"
        style={
          vertical
            ? { width: 200, height: 420, padding: '8px 10px' }
            : { width: 420, height: 200, padding: '5px 12px' }
        }
      >
        {vertical ? (
          <div className="flex h-full flex-col min-h-0">
            {layout.showNome && (
              <div className="text-[13px] font-extrabold leading-tight shrink-0 line-clamp-3">
                {v.product || '—'}
              </div>
            )}
            {qrBlock}
            <div className="flex-1 min-h-0 flex flex-col justify-start gap-[4px] overflow-hidden pt-1">
              {renderRows(otherRows)}
              {dateRows.length > 0 && (
                <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                  {renderRows(dateRows, true)}
                </div>
              )}
              {renderRows(rtRows)}
            </div>
            <WeightTable layout={layout} t={t} v={v} compact />
            {packaging}
          </div>
        ) : (
          <div className="flex h-full flex-col min-h-0">
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="flex-1 flex flex-col pr-2 min-w-0 overflow-hidden">
                {layout.showNome && (
                  <div
                    className={`font-extrabold leading-tight truncate shrink-0 ${
                      dense ? 'text-[15px]' : 'text-[18px]'
                    }`}
                  >
                    {v.product || '—'}
                  </div>
                )}
                <div className="flex gap-2 pt-1 min-h-0 overflow-hidden">
                  <div className="flex-1 flex flex-col justify-start gap-[3px] min-w-0">
                    {renderRows(dataLayout.left)}
                  </div>
                  {split && dataLayout.right.length > 0 && (
                    <div className="w-[34%] shrink-0 flex flex-col justify-start gap-1.5 min-w-0">
                      {renderRows(dataLayout.right, true)}
                    </div>
                  )}
                </div>
              </div>
              {qrBlock}
            </div>
            <WeightTable layout={layout} t={t} v={v} />
            {packaging}
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {vertical
          ? t('painel.configuracao.etiquetas.previewHintVertical')
          : t('painel.configuracao.etiquetas.previewHint')}
      </p>
    </div>
  );
}
