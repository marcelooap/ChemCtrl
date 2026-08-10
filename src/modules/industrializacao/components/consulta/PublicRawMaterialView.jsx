import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Package, Box } from 'lucide-react';
import publicI18n from '@/i18n/publicI18n';
import { fmtDate, fmtDateTime, fmtNumber } from '@/i18n/formatters';

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function Field({ label, value, mono }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-medium text-gray-800 ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</p>
    </div>
  );
}

/**
 * Public view for raw-material stock QR labels (sempre em português).
 * Espelha o conteúdo do RawMaterialViewDialog.
 */
export default function PublicRawMaterialView({ data }) {
  const { t, i18n } = useTranslation();
  const [langReady, setLangReady] = useState(i18n.language === 'pt-BR');
  const lang = 'pt-BR';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!publicI18n.hasResourceBundle('pt-BR', 'translation')) {
          const mod = await import('@/i18n/pt-BR.json');
          publicI18n.addResourceBundle('pt-BR', 'translation', mod.default, true, true);
        }
        await publicI18n.changeLanguage('pt-BR');
      } finally {
        if (!cancelled) setLangReady(true);
      }
    })();
    return () => {
      cancelled = true;
      // Mantém consulta de lote de produção em inglês se o usuário navegar de volta
      publicI18n.changeLanguage('en');
    };
  }, []);

  const fmt = (n) => fmtNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: 3 }, lang);
  const productions = asArray(data?.productions);
  const movements = asArray(data?.movements);
  const unit = data?.unit || '';

  const totalFiscal = productions.reduce((s, c) => s + (Number(c.qty_fiscal) || 0), 0);
  const totalOp = productions.reduce((s, c) => s + (Number(c.qty_operational) || 0), 0);
  const totalMoved = movements.reduce((s, m) => s + (Number(m.quantity) || 0), 0);

  if (!langReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100" style={{ colorScheme: 'light' }}>
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-4 px-4 sm:py-8" style={{ colorScheme: 'light' }}>
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden mb-4">
          <div className="px-6 py-4 flex items-center justify-between" style={{ background: '#1e56a0' }}>
            <span className="text-white text-lg font-bold">{t('publicTraceability.header.brand')}</span>
            <span className="text-white text-xs font-medium opacity-90">{t('publicTraceability.rawMaterial.subtitle')}</span>
          </div>
          <div className="px-6 py-5">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4" style={{ color: '#00875a' }} />
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('publicTraceability.rawMaterial.verified')}</p>
            </div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Box className="w-5 h-5 text-gray-400 shrink-0" />
              <span>
                <span style={{ color: '#2563eb' }}>{data.entry_id || '—'}</span>
                {' · '}
                <span className="font-bold">{data.mp_code || '—'}</span>
                {' – '}
                {data.mp_name || '—'}
              </span>
            </h1>
            <p className="text-sm text-gray-500 mt-1">{t('publicTraceability.lotLabel', { lot: data.lot || '—' })}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Package className="w-4 h-4 text-gray-400" />
            {t('publicTraceability.rawMaterial.sections.info')}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Field label={t('publicTraceability.rawMaterial.fields.regId')} value={data.entry_id} />
            <Field label={t('publicTraceability.rawMaterial.fields.entryDate')} value={fmtDate(data.entry_date, undefined, lang)} />
            <Field label={t('publicTraceability.rawMaterial.fields.code')} value={data.mp_code} mono />
            <Field label={t('publicTraceability.rawMaterial.fields.name')} value={data.mp_name} />
            <Field label={t('publicTraceability.fields.client')} value={data.client} />
            <Field label={t('publicTraceability.fields.lotNumber')} value={data.lot} />
            <Field label={t('publicTraceability.rawMaterial.fields.supplier')} value={data.supplier} />
            <Field label={t('publicTraceability.fields.mfgDate')} value={fmtDate(data.manufacture_date, undefined, lang)} />
            <Field label={t('publicTraceability.fields.expiryDate')} value={fmtDate(data.expiry_date, undefined, lang)} />
            <Field label={t('publicTraceability.rawMaterial.fields.unit')} value={data.unit} />
            <Field label={t('publicTraceability.rawMaterial.fields.initialStock')} value={`${fmt(data.initial_stock)} ${unit}`} />
            <Field label={t('publicTraceability.rawMaterial.fields.currentBalance')} value={`${fmt(data.current_stock)} ${unit}`} />
            <Field label={t('publicTraceability.rawMaterial.fields.unitPrice')} value={(Number(data.unit_price) || 0).toFixed(4)} />
            <Field label={t('publicTraceability.rawMaterial.fields.packagingType')} value={data.packaging_type} />
            <Field label={t('publicTraceability.rawMaterial.fields.packagingCapacity')} value={`${fmt(data.packaging_capacity)} kg`} />
            <Field label={t('publicTraceability.rawMaterial.fields.packagingQuantity')} value={fmt(data.packaging_quantity)} />
          </div>
          <div className="mt-4">
            <p className="text-xs text-gray-500">{t('publicTraceability.rawMaterial.fields.observations')}</p>
            <p className="text-sm font-medium text-gray-800 whitespace-pre-wrap">{data.observations?.trim() || '—'}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{t('publicTraceability.rawMaterial.sections.ops')}</h2>
          {productions.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">{t('publicTraceability.rawMaterial.noOps')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border rounded-lg overflow-hidden">
                <thead>
                  <tr className="text-xs font-semibold text-gray-500 bg-gray-50">
                    <th className="px-3 py-2 text-left">{t('publicTraceability.rawMaterial.fields.op')}</th>
                    <th className="px-3 py-2 text-left">{t('publicTraceability.fields.product')}</th>
                    <th className="px-3 py-2 text-left">{t('publicTraceability.rawMaterial.fields.date')}</th>
                    <th className="px-3 py-2 text-right">{t('publicTraceability.rawMaterial.fields.fiscalQty')}</th>
                    <th className="px-3 py-2 text-right">{t('publicTraceability.rawMaterial.fields.operationalQty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {productions.map((c, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-medium" style={{ color: '#2563eb' }}>{c.op_number || '—'}</td>
                      <td className="px-3 py-2">{c.product || '—'}</td>
                      <td className="px-3 py-2">{fmtDate(c.date, undefined, lang)}</td>
                      <td className="px-3 py-2 text-right">{fmt(c.qty_fiscal)} {unit}</td>
                      <td className="px-3 py-2 text-right">{fmt(c.qty_operational)} kg</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-gray-50 font-bold">
                    <td colSpan={3} className="px-3 py-2" style={{ color: '#2563eb' }}>{t('publicTraceability.rawMaterial.totalConsumed')}</td>
                    <td className="px-3 py-2 text-right" style={{ color: '#2563eb' }}>{fmt(totalFiscal)} {unit}</td>
                    <td className="px-3 py-2 text-right" style={{ color: '#2563eb' }}>{fmt(totalOp)} kg</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{t('publicTraceability.rawMaterial.sections.movements')}</h2>
          {movements.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-3 border border-gray-100 rounded-lg">{t('publicTraceability.rawMaterial.noMovements')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border rounded-lg overflow-hidden">
                <thead>
                  <tr className="text-xs font-semibold text-gray-500 bg-gray-50">
                    <th className="px-3 py-2 text-left">{t('publicTraceability.rawMaterial.fields.date')}</th>
                    <th className="px-3 py-2 text-left">{t('publicTraceability.rawMaterial.fields.destination')}</th>
                    <th className="px-3 py-2 text-right">{t('publicTraceability.rawMaterial.fields.quantity')}</th>
                    <th className="px-3 py-2 text-right">{t('publicTraceability.rawMaterial.fields.balanceBefore')}</th>
                    <th className="px-3 py-2 text-right">{t('publicTraceability.rawMaterial.fields.balanceAfter')}</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-2 whitespace-nowrap text-xs">{fmtDateTime(m.movement_date, undefined, lang)}</td>
                      <td className="px-3 py-2">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                          {m.destination || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-red-600 whitespace-nowrap">-{fmt(m.quantity)} {m.unit || unit}</td>
                      <td className="px-3 py-2 text-right text-xs">{fmt(m.balance_before)} {m.unit || unit}</td>
                      <td className="px-3 py-2 text-right font-semibold text-blue-700 text-xs">{fmt(m.balance_after)} {m.unit || unit}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-gray-50 font-bold">
                    <td colSpan={2} className="px-3 py-2 text-red-600">{t('publicTraceability.rawMaterial.totalMoved')}</td>
                    <td className="px-3 py-2 text-right text-red-600">-{fmt(totalMoved)} {unit}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6 leading-relaxed">
          {t('publicTraceability.footer')}<br />
          {t('publicTraceability.rawMaterial.footerSub')}
        </p>
      </div>
    </div>
  );
}
