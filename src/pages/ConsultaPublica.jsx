import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { fetchPublicLotInfo, fetchPublicCoaData } from '@/api/publicApi';
import { generateCOAPDF } from '@/lib/pdfReports';
import { FileText, Download, Loader2, ShieldCheck, Package, Calendar, Building2, Hash, AlertCircle, Eye } from 'lucide-react';

const LOGO_URL = 'https://media.base44.com/images/public/6a3bc68b6dcf809125758419/afb4730f3_image.png';

const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { const p = typeof val === 'string' ? JSON.parse(val) : val; return Array.isArray(p) ? p : []; } catch { return []; }
};

const STATUS_MAP = {
  'Finalizado': { label: 'Disponível', color: '#00875a', bg: '#dcfce7' },
  'Em Produção': { label: 'Em Produção', color: '#2563eb', bg: '#dbeafe' },
  'Qualidade': { label: 'Em Controle de Qualidade', color: '#d97706', bg: '#fef3c7' },
  'Envase': { label: 'Em Envase', color: '#7c3aed', bg: '#ede9fe' },
  'Aguardando Início': { label: 'Aguardando Produção', color: '#6b7280', bg: '#f3f4f6' },
};

const fmtDate = (d) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return '—'; }
};

export default function ConsultaPublica() {
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
        alert('Certificado de Análise ainda não disponível.');
        return;
      }
      const result = { ...coaData.result, results: parseArr(coaData.result.results) };
      const containers = parseArr(coaData.containers);
      const blob = await generateCOAPDF(result, coaData.production || {}, containers, coaData.recipe || {}, { returnBlob: true });
      const url = URL.createObjectURL(blob);
      if (view) {
        setPdfUrl(url);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'COA ' + (result.lot || 'relatorio') + '.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      alert('Erro ao gerar Certificado de Análise. Tente novamente.');
    } finally {
      setCoaLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#1e56a0' }} />
          <p className="text-sm text-gray-500">Consultando lote...</p>
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
          <h1 className="text-xl font-bold text-gray-800 mb-2">Lote não encontrado</h1>
          <p className="text-sm text-gray-500">
            O código consultado não corresponde a nenhum lote válido.
            <br />Verifique o QR Code e tente novamente.
          </p>
        </div>
      </div>
    );
  }

  const statusInfo = STATUS_MAP[lotInfo?.status] || { label: lotInfo?.status || '—', color: '#6b7280', bg: '#f3f4f6' };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-4 px-4 sm:py-8">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="bg-card rounded-2xl shadow-lg border border-border overflow-hidden mb-4">
          <div className="px-6 py-4 flex items-center justify-between" style={{ background: '#1e56a0' }}>
            <span className="text-white text-lg font-bold">ChemCtrl</span>
            <span className="text-white text-xs font-medium opacity-90">Rastreabilidade</span>
          </div>
          <div className="px-6 py-5">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4" style={{ color: '#00875a' }} />
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Lote Verificado</p>
            </div>
            <h1 className="text-xl font-bold text-gray-800">{lotInfo.product}</h1>
            <p className="text-sm text-gray-500">Lote {lotInfo.lot}</p>
          </div>
        </div>

        {/* Lot Details */}
        <div className="bg-card rounded-2xl shadow-sm border border-border p-6 mb-4">
          <h2 className="text-sm font-semibold text-foreground mb-4">Informações do Lote</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <Package className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Produto</p>
                <p className="text-sm font-medium text-gray-800">{lotInfo.product}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Building2 className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Cliente</p>
                <p className="text-sm font-medium text-gray-800">{lotInfo.client || '—'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Hash className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Número do Lote</p>
                <p className="text-sm font-medium text-gray-800">{lotInfo.lot}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Data de Fabricação</p>
                <p className="text-sm font-medium text-gray-800">{fmtDate(lotInfo.mfg_date)}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Data de Validade</p>
                <p className="text-sm font-medium text-gray-800">{fmtDate(lotInfo.expiry_date)}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Situação</p>
                {lotInfo.status === 'Finalizado' ? (
                  <span className="inline-block text-xs font-bold px-2.5 py-0.5 rounded-full mt-0.5" style={{ color: '#00875a', background: '#dcfce7' }}>Lote liberado</span>
                ) : (
                  <span className="inline-block text-xs font-bold px-2.5 py-0.5 rounded-full mt-0.5" style={{ color: '#dc2626', background: '#fee2e2' }}>Lote bloqueado</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* COA Section */}
        <div className="bg-card rounded-2xl shadow-sm border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Certificado de Análise</h2>
              <p className="text-xs text-gray-500">Documento oficial de qualidade</p>
            </div>
            {lotInfo.has_coa ? (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-green-100 text-green-700">Disponível</span>
            ) : (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-muted text-gray-500">Indisponível</span>
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
                Visualizar COA
              </button>
              <button
                onClick={() => handleCOA(false)}
                disabled={coaLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: '#1e56a0' }}
              >
                {coaLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Baixar COA
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-4 rounded-xl bg-muted/50">
              <FileText className="w-4 h-4 text-gray-400 shrink-0" />
              <p className="text-sm text-gray-500">Certificado de Análise ainda não disponível.</p>
            </div>
          )}
        </div>

        {/* PDF Viewer Overlay */}
        {pdfUrl && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }}>
            <div className="bg-card rounded-2xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ background: '#1e56a0' }}>
                <span className="text-white text-sm font-semibold">Certificado de Análise — {lotInfo?.lot}</span>
                <div className="flex items-center gap-2">
                  <a href={pdfUrl} download={'COA ' + (lotInfo?.lot || 'relatorio') + '.pdf'} className="text-white text-xs font-medium px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 flex items-center gap-1"><Download className="w-3.5 h-3.5" /> Baixar</a>
                  <button onClick={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }} className="text-white text-xs font-medium px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30">Fechar</button>
                </div>
              </div>
              <iframe src={pdfUrl} className="flex-1 w-full rounded-b-2xl" title="COA" />
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6 leading-relaxed">
          ChemCtrl · Sistema de Controle de Produção Química<br />
          Consulta pública de rastreabilidade de lote
        </p>
      </div>
    </div>
  );
}
