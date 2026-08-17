import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { fetchPublicProdutoInfo, fetchPublicProdutoSdsSignedUrl } from '@transbordo/api/publicApi';
import { openProtectedPdf, revokeBlobUrl } from '@industrializacao/lib/protectedDocument';
import { FileText, Download, Loader2, ShieldCheck, Package, Building2, Hash, AlertCircle, Eye } from 'lucide-react';

const LOGO_URL = 'https://media.base44.com/images/public/6a3bc68b6dcf809125758419/afb4730f3_image.png';

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

function ConsultaPublicaProdutoPage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [sdsLoading, setSdsLoading] = useState(false);
  const [pdfViewer, setPdfViewer] = useState(null);

  useForceLightMode();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPublicProdutoInfo(token);
        if (cancelled) return;
        if (data?.product) {
          setInfo(data);
          return;
        }
        setNotFound(true);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    return () => {
      if (pdfViewer?.revoke) {
        pdfViewer.revoke();
      } else if (pdfViewer?.url) {
        revokeBlobUrl(pdfViewer.url);
      }
    };
  }, [pdfViewer]);

  const closePdfViewer = () => {
    if (pdfViewer?.revoke) {
      pdfViewer.revoke();
    } else if (pdfViewer?.isBlob && pdfViewer.url) {
      revokeBlobUrl(pdfViewer.url);
    }
    setPdfViewer(null);
  };

  const handleSDS = async (view) => {
    setSdsLoading(true);
    try {
      const data = await fetchPublicProdutoSdsSignedUrl(token);
      if (!data?.signed_url) {
        window.alert('FDS não disponível para este produto.');
        return;
      }
      const filename = data.fds_filename || 'sds.pdf';
      const { objectUrl, revoke } = await openProtectedPdf({
        signedUrl: data.signed_url,
        filename,
        mode: view ? 'view' : 'download',
      });

      if (view) {
        setPdfViewer({
          url: objectUrl,
          title: `FDS — ${info?.product || 'Produto'}`,
          downloadName: filename,
          isBlob: true,
          revoke,
        });
      }
    } catch {
      window.alert('Não foi possível abrir a FDS. Tente novamente.');
    } finally {
      setSdsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100" style={{ colorScheme: 'light' }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#1e56a0' }} />
          <p className="text-sm text-gray-500">Carregando informações do produto…</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 p-4" style={{ colorScheme: 'light' }}>
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-gray-200 p-8 text-center">
          <img src={LOGO_URL} alt="ChemCtrl" className="h-12 mx-auto mb-4 object-contain" />
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <h1 className="text-xl font-bold text-gray-800 mb-2">Produto não encontrado</h1>
          <p className="text-sm text-gray-500">
            Este código QR não corresponde a um produto válido.
            <br />Verifique o código da etiqueta e tente novamente.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-4 px-4 sm:py-8" style={{ colorScheme: 'light' }}>
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden mb-4">
          <div className="px-6 py-4 flex items-center justify-between" style={{ background: '#1e56a0' }}>
            <span className="text-white text-lg font-bold">ChemCtrl</span>
            <span className="text-white text-xs font-medium opacity-90">Ficha de Dados de Segurança</span>
          </div>
          <div className="px-6 py-5">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4" style={{ color: '#00875a' }} />
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Documento verificado</p>
            </div>
            <h1 className="text-xl font-bold text-gray-800">{info.product}</h1>
            {info.code ? (
              <p className="text-sm text-gray-500">Código {info.code}</p>
            ) : null}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Produto</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <Package className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Nome</p>
                <p className="text-sm font-medium text-gray-800">{info.product}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Hash className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Código</p>
                <p className="text-sm font-medium text-gray-800">{info.code || '—'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 sm:col-span-2">
              <Building2 className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Cliente</p>
                <p className="text-sm font-medium text-gray-800">{info.client || '—'}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">FDS</h2>
              <p className="text-xs text-gray-500">Ficha de Dados de Segurança do produto</p>
            </div>
            {info.has_sds ? (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-green-100 text-green-700">Disponível</span>
            ) : (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Indisponível</span>
            )}
          </div>
          {info.has_sds ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => handleSDS(true)}
                disabled={sdsLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-colors hover:bg-blue-50 disabled:opacity-50"
                style={{ borderColor: '#1e56a0', color: '#1e56a0' }}
              >
                {sdsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                Visualizar
              </button>
              <button
                type="button"
                onClick={() => handleSDS(false)}
                disabled={sdsLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: '#1e56a0' }}
              >
                {sdsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Baixar
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-4 rounded-xl bg-gray-100">
              <FileText className="w-4 h-4 text-gray-400 shrink-0" />
              <p className="text-sm text-gray-500">A FDS deste produto ainda não foi anexada.</p>
            </div>
          )}
        </div>

        {pdfViewer && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={closePdfViewer}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col border border-gray-200" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200" style={{ background: '#1e56a0' }}>
                <span className="text-white text-sm font-semibold">{pdfViewer.title}</span>
                <div className="flex items-center gap-2">
                  <a href={pdfViewer.url} download={pdfViewer.downloadName} className="text-white text-xs font-medium px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 flex items-center gap-1">
                    <Download className="w-3.5 h-3.5" /> Baixar
                  </a>
                  <button type="button" onClick={closePdfViewer} className="text-white text-xs font-medium px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30">
                    Fechar
                  </button>
                </div>
              </div>
              <iframe src={pdfViewer.url} className="flex-1 w-full rounded-b-2xl bg-white" title={pdfViewer.downloadName} />
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6 leading-relaxed">
          Informações fornecidas pela ChemCtrl.
          <br />Documento destinado à consulta da FDS do produto.
        </p>
      </div>
    </div>
  );
}

export default function ConsultaPublicaProduto() {
  return (
    <ThemeProvider forcedTheme="light" enableSystem={false}>
      <ConsultaPublicaProdutoPage />
    </ThemeProvider>
  );
}
