import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { fetchPublicLotInfo, fetchPublicCoaData } from '@/api/publicApi';
import { generateCOAPDF } from '@/lib/pdfReports';
import publicI18n, { initPublicI18n } from '@/i18n/publicI18n';
import { fmtDate } from '@/i18n/formatters';
import { FileText, Download, Loader2, ShieldCheck, Package, Calendar, Building2, Hash, AlertCircle, Eye } from 'lucide-react';

const LOGO_URL = 'https://media.base44.com/images/public/6a3bc68b6dcf809125758419/afb4730f3_image.png';

const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { const p = typeof val === 'string' ? JSON.parse(val) : val; return Array.isArray(p) ? p : []; } catch { return []; }
};

const fmtDateEn = (d) => fmtDate(d, undefined, 'en');

function ConsultaPublicaPage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const [lotInfo, setLotInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [coaLoading, setCoaLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPublicLotInfo(token);
        if (cancelled) return;
        if (!data || !data.product) { setNotFound(true); }
        else { setLotInfo(data); }
      } catch (e) {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleCOA = async (view) => {
    setCoaLoading(true);
    try {
      const coaData = await fetchPublicCoaData(token);
      if (!coaData || !coaData.result) {
        alert(t('publicTraceability.coa.notAvailable'));
        return;
      }
      const result = { ...coaData.result, results: parseArr(coaData.result.results) };
      const containers = parseArr(coaData.containers);
      const blob = await generateCOAPDF(result, coaData.production || {}, containers, coaData.recipe || {}, { returnBlob: true, locale: 'en' });
      const url = URL.createObjectURL(blob);
      if (view) {
        setPdfUrl(url);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'COA ' + (result.lot || 'report') + '.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      alert(t('publicTraceability.coa.generateError'));
    } finally {
      setCoaLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#1e56a0' }} />
          <p className="text-sm text-gray-500">{t('publicTraceability.loading')}</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 p-4">
        <div className="max-w-md w-full bg-card rounded-2xl shadow-lg border border-border p-8 text-center">
          <img src={LOGO_URL} alt="ChemCtrl" className="h-12 mx-auto mb-4 object-contain" />
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <h1 className="text-xl font-bold text-gray-800 mb-2">{t('publicTraceability.notFound.title')}</h1>
          <p className="text-sm text-gray-500">
            {t('publicTraceability.notFound.message')}
            <br />{t('publicTraceability.notFound.hint')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-4 px-4 sm:py-8">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="bg-card rounded-2xl shadow-lg border border-border overflow-hidden mb-4">
          <div className="px-6 py-4 flex items-center justify-between" style={{ background: '#1e56a0' }}>
            <span className="text-white text-lg font-bold">{t('publicTraceability.header.brand')}</span>
            <span className="text-white text-xs font-medium opacity-90">{t('publicTraceability.header.subtitle')}</span>
          </div>
          <div className="px-6 py-5">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4" style={{ color: '#00875a' }} />
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('publicTraceability.verified')}</p>
            </div>
            <h1 className="text-xl font-bold text-gray-800">{lotInfo.product}</h1>
            <p className="text-sm text-gray-500">{t('publicTraceability.lotLabel', { lot: lotInfo.lot })}</p>
          </div>
        </div>

        {/* Lot Details */}
        <div className="bg-card rounded-2xl shadow-sm border border-border p-6 mb-4">
          <h2 className="text-sm font-semibold text-foreground mb-4">{t('publicTraceability.sections.lotInfo')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <Package className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">{t('publicTraceability.fields.product')}</p>
                <p className="text-sm font-medium text-gray-800">{lotInfo.product}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Building2 className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">{t('publicTraceability.fields.client')}</p>
                <p className="text-sm font-medium text-gray-800">{lotInfo.client || '—'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Hash className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">{t('publicTraceability.fields.lotNumber')}</p>
                <p className="text-sm font-medium text-gray-800">{lotInfo.lot}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">{t('publicTraceability.fields.mfgDate')}</p>
                <p className="text-sm font-medium text-gray-800">{fmtDateEn(lotInfo.mfg_date)}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">{t('publicTraceability.fields.expiryDate')}</p>
                <p className="text-sm font-medium text-gray-800">{fmtDateEn(lotInfo.expiry_date)}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">{t('publicTraceability.fields.situation')}</p>
                {lotInfo.status === 'Finalizado' ? (
                  <span className="inline-block text-xs font-bold px-2.5 py-0.5 rounded-full mt-0.5" style={{ color: '#00875a', background: '#dcfce7' }}>{t('publicTraceability.status.released')}</span>
                ) : (
                  <span className="inline-block text-xs font-bold px-2.5 py-0.5 rounded-full mt-0.5" style={{ color: '#dc2626', background: '#fee2e2' }}>{t('publicTraceability.status.blocked')}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* COA Section */}
        <div className="bg-card rounded-2xl shadow-sm border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t('publicTraceability.sections.coa')}</h2>
              <p className="text-xs text-gray-500">{t('publicTraceability.sections.coaSubtitle')}</p>
            </div>
            {lotInfo.has_coa ? (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-green-100 text-green-700">{t('publicTraceability.coa.available')}</span>
            ) : (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-muted text-gray-500">{t('publicTraceability.coa.unavailable')}</span>
            )}
          </div>
          {lotInfo.has_coa ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => handleCOA(true)}
                disabled={coaLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-colors hover:bg-accent/50 disabled:opacity-50"
                style={{ borderColor: '#1e56a0', color: '#1e56a0' }}
              >
                {coaLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                {t('publicTraceability.coa.view')}
              </button>
              <button
                onClick={() => handleCOA(false)}
                disabled={coaLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: '#1e56a0' }}
              >
                {coaLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {t('publicTraceability.coa.download')}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-4 rounded-xl bg-muted/50">
              <FileText className="w-4 h-4 text-gray-400 shrink-0" />
              <p className="text-sm text-gray-500">{t('publicTraceability.coa.notAvailable')}</p>
            </div>
          )}
        </div>

        {/* PDF Viewer Overlay */}
        {pdfUrl && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }}>
            <div className="bg-card rounded-2xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ background: '#1e56a0' }}>
                <span className="text-white text-sm font-semibold">{t('publicTraceability.coa.viewerTitle', { lot: lotInfo?.lot })}</span>
                <div className="flex items-center gap-2">
                  <a href={pdfUrl} download={'COA ' + (lotInfo?.lot || 'report') + '.pdf'} className="text-white text-xs font-medium px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 flex items-center gap-1"><Download className="w-3.5 h-3.5" /> {t('publicTraceability.coa.downloadButton')}</a>
                  <button onClick={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }} className="text-white text-xs font-medium px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30">{t('publicTraceability.coa.close')}</button>
                </div>
              </div>
              <iframe src={pdfUrl} className="flex-1 w-full rounded-b-2xl" title="COA" />
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6 leading-relaxed">
          {t('publicTraceability.footer')}<br />
          {t('publicTraceability.footerSub')}
        </p>
      </div>
    </div>
  );
}

export default function ConsultaPublica() {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    initPublicI18n().then(() => setI18nReady(true));
  }, []);

  if (!i18nReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#1e56a0' }} />
      </div>
    );
  }

  return (
    <I18nextProvider i18n={publicI18n}>
      <ConsultaPublicaPage />
    </I18nextProvider>
  );
}
