import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { AlertCircle, Download, Eye, FileText, Loader2, ShieldCheck } from 'lucide-react';
import publicI18n, { initPublicI18n } from '@/i18n/publicI18n';
import { fetchPublicEquipmentFileUrl, fetchPublicEquipmentInfo } from '@industrializacao/api/publicApi';
import { fetchProtectedPdf, openProtectedPdf, revokeBlobUrl } from '@industrializacao/lib/protectedDocument';
import { fileNameFromPath, parseJsonArray } from '@industrializacao/lib/equipmentFiles';
import { getEquipmentStatus } from '@industrializacao/lib/equipmentUtils';
import { translateEquipmentCalibrationStatus, translateEquipmentType } from '@/i18n/domainMaps';
import { fmtDate } from '@/i18n/formatters';

function useForceLightMode() {
  useEffect(() => {
    const html = document.documentElement;
    const hadDark = html.classList.contains('dark');
    html.classList.remove('dark');
    html.classList.add('light');
    html.style.colorScheme = 'light';
    return () => {
      html.classList.remove('light');
      html.style.colorScheme = '';
      if (hadDark) html.classList.add('dark');
    };
  }, []);
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-800">{value || '—'}</p>
    </div>
  );
}

function ConsultaEquipamentoPage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [fileBusy, setFileBusy] = useState('');
  const [viewer, setViewer] = useState(null);
  const lang = 'pt-BR';

  useForceLightMode();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!publicI18n.hasResourceBundle('pt-BR', 'translation')) {
          const mod = await import('@/i18n/pt-BR.json');
          publicI18n.addResourceBundle('pt-BR', 'translation', mod.default, true, true);
        }
        await publicI18n.changeLanguage('pt-BR');
        const info = await fetchPublicEquipmentInfo(token);
        if (cancelled) return;
        if (!info?.name) {
          setNotFound(true);
          return;
        }
        setData(info);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => () => {
    viewer?.revoke?.();
  }, [viewer]);

  const openFile = async (path, mode, title) => {
    if (!path) return;
    const key = `${mode}:${path}`;
    setFileBusy(key);
    try {
      const signedUrl = await fetchPublicEquipmentFileUrl(path);
      if (!signedUrl) throw new Error('missing');
      const filename = fileNameFromPath(path);
      if (mode === 'download') {
        await openProtectedPdf({ signedUrl, filename, mode: 'download' });
        return;
      }
      const { blob, objectUrl } = await fetchProtectedPdf(signedUrl);
      setViewer((current) => {
        current?.revoke?.();
        return {
          url: objectUrl,
          title: title || filename,
          filename,
          isImage: (blob.type || '').startsWith('image/'),
          revoke: () => revokeBlobUrl(objectUrl),
        };
      });
    } catch {
      alert(t('publicTraceability.equipment.openFailed'));
    } finally {
      setFileBusy('');
    }
  };

  const closeViewer = () => {
    setViewer((current) => {
      current?.revoke?.();
      return null;
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100" style={{ colorScheme: 'light' }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#1e56a0' }} />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 p-4" style={{ colorScheme: 'light' }}>
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-lg">
          <AlertCircle className="mx-auto mb-3 h-12 w-12 text-gray-400" />
          <h1 className="mb-2 text-xl font-bold text-gray-800">{t('publicTraceability.equipment.notFound')}</h1>
        </div>
      </div>
    );
  }

  const status = translateEquipmentCalibrationStatus(getEquipmentStatus(data.next_calibration_date).key);
  const history = parseJsonArray(data.calibration_history);
  const hasCertificate = Boolean(data.certificate_url);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 px-4 py-4 sm:py-8" style={{ colorScheme: 'light' }}>
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between px-6 py-4" style={{ background: '#1e56a0' }}>
            <span className="text-lg font-bold text-white">{t('publicTraceability.header.brand')}</span>
            <span className="text-xs font-medium text-white opacity-90">{t('publicTraceability.equipment.subtitle')}</span>
          </div>
          <div className="px-6 py-5">
            <div className="mb-1 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" style={{ color: '#00875a' }} />
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('publicTraceability.equipment.verified')}</p>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{data.name}</h1>
            <p className="mt-1 text-sm font-medium text-gray-500">{status}</p>
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">{t('publicTraceability.equipment.sections.info')}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label={t('quality.equipment.viewDialog.type')} value={translateEquipmentType(data.type)} />
            <Field label={t('quality.equipment.viewDialog.manufacturer')} value={data.manufacturer} />
            <Field label={t('quality.equipment.viewDialog.model')} value={data.model} />
            <Field label={t('quality.equipment.viewDialog.serial')} value={data.serial_number} />
            <Field label={t('quality.equipment.viewDialog.patrimony')} value={data.patrimony_number} />
            <Field label={t('quality.equipment.viewDialog.location')} value={data.location} />
            <Field label={t('publicTraceability.equipment.registeredBy')} value={data.responsible || data.lab_responsible} />
            {data.lab_responsible && data.lab_responsible !== data.responsible ? (
              <Field label={t('quality.equipment.viewDialog.labResponsible')} value={data.lab_responsible} />
            ) : null}
            <Field label={t('quality.equipment.viewDialog.certificateLabel')} value={data.certificate_number} />
            <Field label={t('quality.equipment.viewDialog.lastCalibration')} value={fmtDate(data.last_calibration_date, undefined, lang)} />
            <Field label={t('quality.equipment.viewDialog.nextCalibration')} value={fmtDate(data.next_calibration_date, undefined, lang)} />
            <Field label={t('quality.equipment.viewDialog.calibrationCompany')} value={data.calibration_company} />
          </div>
          {data.observations ? (
            <div className="mt-4">
              <p className="text-xs text-gray-500">{t('quality.equipment.viewDialog.obs')}</p>
              <p className="whitespace-pre-wrap text-sm font-medium text-gray-800">{data.observations}</p>
            </div>
          ) : null}
        </div>

        <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
            <FileText className="h-4 w-4 text-gray-400" />
            {t('publicTraceability.equipment.sections.certificate')}
          </h2>
          {hasCertificate ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => openFile(data.certificate_url, 'view', data.name)}
                disabled={!!fileBusy}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-colors hover:bg-blue-50 disabled:opacity-50"
                style={{ borderColor: '#1e56a0', color: '#1e56a0' }}
              >
                {fileBusy === `view:${data.certificate_url}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                {t('publicTraceability.equipment.view')}
              </button>
              <button
                type="button"
                onClick={() => openFile(data.certificate_url, 'download', data.name)}
                disabled={!!fileBusy}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: '#1e56a0' }}
              >
                {fileBusy === `download:${data.certificate_url}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {t('publicTraceability.equipment.download')}
              </button>
            </div>
          ) : (
            <p className="rounded-xl bg-gray-100 p-4 text-sm text-gray-500">{t('publicTraceability.equipment.noCertificate')}</p>
          )}
        </div>

        <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">{t('publicTraceability.equipment.sections.history')}</h2>
          {history.length === 0 ? (
            <p className="text-sm text-gray-500">{t('publicTraceability.equipment.noHistory')}</p>
          ) : (
            <div className="space-y-2">
              {[...history].reverse().map((item, index) => (
                <div key={index} className="rounded-xl border border-gray-200 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-gray-900">{fmtDate(item.date, undefined, lang)}</p>
                    {item.certificate_url ? (
                      <span className="flex gap-3 text-xs font-medium">
                        <button type="button" className="text-blue-700 hover:underline" onClick={() => openFile(item.certificate_url, 'view', data.name)}>{t('publicTraceability.equipment.view')}</button>
                        <button type="button" className="text-gray-700 hover:underline" onClick={() => openFile(item.certificate_url, 'download', data.name)}>{t('publicTraceability.equipment.download')}</button>
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-gray-600">{t('quality.equipment.viewDialog.certificateLabel')}: {item.certificate_number || '—'}</p>
                  <p className="text-gray-600">{t('quality.equipment.viewDialog.company')}: {item.company || '—'}</p>
                  <p className="text-gray-600">{t('quality.equipment.viewDialog.next')}: {fmtDate(item.next_calibration_date, undefined, lang)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-gray-400">
          {t('publicTraceability.footer')}<br />
          {t('publicTraceability.equipment.footerSub')}
        </p>
      </div>

      {viewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeViewer}>
          <div className="flex h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3" style={{ background: '#1e56a0' }}>
              <span className="text-sm font-semibold text-white">{viewer.title}</span>
              <button type="button" onClick={closeViewer} className="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/30">
                {t('publicTraceability.coa.close')}
              </button>
            </div>
            {viewer.isImage ? (
              <img src={viewer.url} alt={viewer.title} className="h-full w-full object-contain" />
            ) : (
              <iframe src={viewer.url} title={viewer.title} className="h-full w-full flex-1 rounded-b-2xl border-0 bg-white" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConsultaEquipamento() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initPublicI18n().then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <ThemeProvider forcedTheme="light" enableSystem={false}>
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#1e56a0' }} />
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider forcedTheme="light" enableSystem={false}>
      <I18nextProvider i18n={publicI18n}>
        <ConsultaEquipamentoPage />
      </I18nextProvider>
    </ThemeProvider>
  );
}
