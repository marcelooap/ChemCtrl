import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import {
  formatEtiquetaDate,
  getVerticalEtiquetaLayout,
  partitionEtiquetaCampos,
} from '@transbordo/lib/etiquetaConfig';

function FieldRow({ label, value, wrap = false, stacked = false, fill = false, emphasis = false }) {
  if (stacked) {
    return (
      <div className="min-w-0">
        <div className={`font-extrabold uppercase leading-none tracking-wide ${emphasis ? 'text-[10px]' : 'text-[8px]'}`}>
          {label}
        </div>
        <div className={`font-bold leading-tight truncate mt-[1px] ${emphasis ? 'text-[12px]' : 'text-[10px]'}`}>
          {value}
        </div>
      </div>
    );
  }

  const sizeClass = fill
    ? (emphasis ? 'w-full text-[14px] items-start leading-snug' : 'w-full text-[12px] items-start leading-snug')
    : emphasis
      ? `text-[12px] ${wrap ? 'items-start leading-tight' : 'items-baseline leading-tight'}`
      : `text-[10px] ${wrap ? 'items-start leading-snug' : 'items-baseline leading-tight'}`;

  return (
    <div className={`flex gap-1 min-w-0 shrink-0 ${sizeClass}`}>
      <span className="font-extrabold uppercase shrink-0">{label}</span>
      <span className="font-bold text-black/80 shrink-0">•</span>
      <span className={`font-bold min-w-0 flex-1 ${fill || wrap ? 'whitespace-normal break-words' : 'truncate'}`}>
        {value}
      </span>
    </div>
  );
}

function formatWeight(n, decimals = 3) {
  const value = Number(n) || 0;
  if (decimals <= 0) return `${Math.round(value)}`;
  return value.toFixed(decimals);
}

function WeightTable({ layout, t, v, compact = false, weightDecimals = 3, spaced = false }) {
  if (layout.weights.length === 0) return null;
  return (
    <table className={`w-full border-collapse shrink-0 ${compact ? 'mt-1 text-[8px]' : spaced ? 'mt-1 text-[9px]' : 'mt-0.5 text-[9px]'}`}>
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
                ? `${formatWeight(v.gross_weight, weightDecimals)} kg`
                : `${formatWeight(v.net_weight, weightDecimals)} kg`}
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
  consultaPath = '/consulta',
  className = '',
  chrome = true,
  weightDecimals = 3,
  emphasis = false,
}) {
  const { t, i18n } = useTranslation();
  const layout = partitionEtiquetaCampos(campos);
  const verticalLayout = getVerticalEtiquetaLayout(campos);
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

  const wrapKey = (key) => vertical || key === 'responsavel_tecnico' || key === 'cliente';

  const renderRows = (rows, stacked = false) =>
    rows.map((row) => (
      <FieldRow
        key={row.key}
        stacked={stacked}
        fill={vertical}
        wrap={wrapKey(row.key)}
        emphasis={emphasis}
        label={dataLabel(row.key)}
        value={dataValue(row.key)}
      />
    ));

  const embalagem = v.embalagem
    || (v.barril_number
      ? `${v.container_number || ''} (${v.barril_number})`
      : v.container_number || v.packaging_type || '—');

  const qrUrl = `${(import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/+$/, '')}${consultaPath}/${v.publicToken || 'preview'}`;

  const packaging = (vertical ? verticalLayout.showEmbalagem : layout.showEmbalagem) && (
    <div className={`font-extrabold uppercase flex gap-1 shrink-0 min-w-0 ${vertical ? `w-full items-start leading-snug ${emphasis ? 'text-[14px]' : 'text-[12px]'}` : `${emphasis ? 'text-[12px]' : 'text-[10px]'} mt-0.5 items-baseline`}`}>
      <span className="shrink-0">{t('pdf.label.packaging')}</span>
      <span className="font-bold text-black/80 shrink-0">•</span>
      <span className={`font-bold min-w-0 flex-1 ${vertical ? 'whitespace-normal break-words' : 'truncate text-[11px]'}`}>{embalagem}</span>
    </div>
  );

  const qrBlock = (vertical ? verticalLayout.showQr : layout.showQr) && (
    <div className={`shrink-0 flex flex-col items-center ${vertical ? 'w-full py-1' : 'w-[88px] border-l border-black pl-2'}`}>
      {!vertical && layout.showId && (
        <div className="font-bold text-[10px] self-start">
          {t('pdf.label.ref')}: {v.op_number || '—'}
        </div>
      )}
      <div className="flex items-center justify-center py-0.5">
        <QRCodeSVG value={qrUrl} size={vertical ? 88 : dense ? 64 : 72} level="M" bgColor="#ffffff" fgColor="#000000" />
      </div>
      <div className={`font-bold uppercase text-center leading-tight ${vertical ? 'text-[7px]' : 'text-[6px]'}`}>
        {t('pdf.label.qrHint')}
      </div>
    </div>
  );

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      {chrome && (
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t('painel.configuracao.etiquetas.previewTitle')}
        </p>
      )}
      <div
        className="bg-white text-black border border-black shadow-lg origin-top"
        style={
          vertical
            ? { width: 200, height: 420, padding: '7px 8px' }
            : { width: 420, height: 200, padding: '5px 12px', overflow: 'hidden' }
        }
      >
        {vertical ? (
          <div className="flex h-full min-h-0 w-full flex-col">
            {verticalLayout.showNome && (
              <div className={`font-extrabold leading-tight text-center shrink-0 line-clamp-4 pb-1.5 mb-1 border-b border-black ${emphasis ? 'text-[19px]' : 'text-[17px]'}`}>
                {v.product || '—'}
              </div>
            )}
            <div className={`flex min-h-0 flex-1 flex-col justify-between ${emphasis ? 'gap-1.5' : 'gap-1'}`}>
              <div className={`flex w-full flex-1 flex-col justify-evenly ${emphasis ? 'gap-1.5' : 'gap-0.5'}`}>
                {renderRows(verticalLayout.dataRows)}
              </div>
              {qrBlock}
              <div className="flex w-full shrink-0 flex-col justify-evenly gap-1">
                {verticalLayout.weights.map((w) => (
                  <FieldRow
                    key={w.key}
                    fill
                    wrap
                    emphasis={emphasis}
                    label={w.key === 'peso_bruto' ? t('pdf.label.grossWeight') : t('pdf.label.netWeight')}
                    value={
                      w.key === 'peso_bruto'
                        ? `${formatWeight(v.gross_weight, weightDecimals)} kg`
                        : `${formatWeight(v.net_weight, weightDecimals)} kg`
                    }
                  />
                ))}
                {packaging}
              </div>
            </div>
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
                <div className={`flex gap-2 min-h-0 overflow-hidden ${emphasis ? 'pt-1 flex-1' : 'pt-1'}`}>
                  <div className={`flex-1 flex flex-col min-w-0 ${emphasis ? 'justify-between gap-0 pb-1' : 'justify-start gap-[3px]'}`}>
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
            <WeightTable layout={layout} t={t} v={v} weightDecimals={weightDecimals} spaced={emphasis} />
            {packaging}
          </div>
        )}
      </div>
      {chrome && (
        <p className="text-[11px] text-muted-foreground">
          {vertical
            ? t('painel.configuracao.etiquetas.previewHintVertical')
            : t('painel.configuracao.etiquetas.previewHint')}
        </p>
      )}
    </div>
  );
}
