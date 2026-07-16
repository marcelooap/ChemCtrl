import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useInternalAuth } from '@/lib/InternalAuthContext';
// eslint-disable-next-line
import { uploadFileToSupabase } from '@/api/storage';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useToast } from '@/components/ui/use-toast';
import { Search, FileCheck, CheckCircle, XCircle, Camera, Trash2, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ProductionCard from '@/components/ProductionCard';
import { NotificationService } from '@/notifications/services/NotificationService';
import SignedImage from '@/components/SignedImage';
import { fmtDate, fmtNumber, fmtVolume } from '@/i18n/formatters';
import { syncOrderFromProductions } from '@/lib/orderProductionStatus';

const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) { return []; }
};

const isTextAnalysis = (name) => {
  const n = (name || '').toUpperCase().trim();
  return n === 'COR' || n === 'ASPECTO';
};

const RESULT_STATUS_KEYS = {
  Aprovado: 'quality.fields.approved',
  Reprovado: 'quality.fields.rejected',
  'Com Restrição': 'quality.resultStatus.withRestriction',
};

export default function ProducoesCQ() {
  const { t, i18n } = useTranslation();
  const { user: internalUser } = useInternalAuth();
  const { data: allProds, loading } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 500));
  const { data: tests } = useRealtimeEntity('QualityTest', () => base44.entities.QualityTest.list('-created_date', 500));
  const { data: results, reload: load } = useRealtimeEntity('QualityResult', () => base44.entities.QualityResult.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [selectedProd, setSelectedProd] = useState(null);
  const [analysisForm, setAnalysisForm] = useState({ analyst: '', observations: '', results: [], sample_photo_url: '' });
  const [saving, setSaving] = useState(false);
  const photoInputRef = React.useRef(null);
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const na = t('common.notAvailable');

  const translateResultStatus = useCallback((status) => {
    if (!status || status === '—') return na;
    const key = RESULT_STATUS_KEYS[status];
    return key ? t(key) : status;
  }, [t, na]);

  const fmtNum = useCallback((n) => {
    if (n === null || n === undefined || n === '') return '';
    const num = typeof n === 'number' ? n : parseFloat(String(n).replace(/\./g, '').replace(',', '.'));
    if (isNaN(num)) return n;
    return fmtNumber(num, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, i18n.language);
  }, [i18n.language]);

  const productions = useMemo(() =>
    allProds.filter(p =>
      p.status === 'Qualidade' ||
      (p.bypass_qc && ['Envase', 'Finalizado'].includes(p.status) && !results.some(res => res.production_id === p.id))
    ),
    [allProds, results]
  );

  const openAnalysis = useCallback((prod) => {
    setSelectedProd(prod);
    const test = tests.find(item => item.product === prod.product);
    const existing = results.find(r => r.production_id === prod.id);
    if (existing) {
      const savedResults = parseArr(existing.results);
      const items = parseArr(test?.analyses).map(a => {
        const saved = savedResults.find(r => r.analysis_name === a.analysis_name);
        return {
          analysis_name: a.analysis_name,
          methodology: a.methodology,
          unit: a.unit,
          min_limit: a.min_limit,
          max_limit: a.max_limit,
          specification: a.specification,
          result: saved?.result ?? '',
          status: saved?.status ?? '—',
        };
      });
      setAnalysisForm({ analyst: existing.analyst || '', observations: existing.observations || '', results: items, sample_photo_url: existing.sample_photo_url || '' });
    } else {
      const items = parseArr(test?.analyses).map(a => ({
        analysis_name: a.analysis_name, methodology: a.methodology, unit: a.unit,
        min_limit: a.min_limit, max_limit: a.max_limit, specification: a.specification,
        result: '', status: '—'
      }));
      setAnalysisForm({ analyst: '', observations: '', results: items, sample_photo_url: '' });
    }
    setShowAnalysis(true);
  }, [tests, results]);

  useEffect(() => {
    const prodId = searchParams.get('prod');
    if (prodId && !loading && !showAnalysis) {
      const prod = productions.find(p => p.id === prodId);
      if (prod) {
        openAnalysis(prod);
        searchParams.delete('prod');
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [searchParams, loading, productions, showAnalysis, openAnalysis, setSearchParams]);

  const handleCapturePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadFileToSupabase(file);
      setAnalysisForm(prev => ({ ...prev, sample_photo_url: url }));
    } catch (_e) {}
  };

  const updateResult = (idx, val) => {
    const r = [...analysisForm.results];
    r[idx] = { ...r[idx], result: val };
    const item = r[idx];
    if (isTextAnalysis(item.analysis_name)) {
      const spec = (item.specification || '').trim();
      const valUpper = (val || '').trim();
      r[idx].status = (valUpper === 'Conforme' || (spec && valUpper === spec)) ? 'Aprovado' : 'Reprovado';
    } else {
      const num = parseFloat(String(val).replace(/\./g, '').replace(',', '.'));
      if (!isNaN(num)) {
        if ((item.min_limit != null && num < item.min_limit) || (item.max_limit != null && num > item.max_limit)) {
          r[idx].status = 'Reprovado';
        } else {
          r[idx].status = 'Aprovado';
        }
      } else {
        r[idx].status = '—';
      }
    }
    setAnalysisForm({ ...analysisForm, results: r });
  };

  const computeOverallStatus = () => {
    const statuses = analysisForm.results.map(r => r.status);
    if (statuses.length === 0 || statuses.some(s => s === '—')) return null;
    if (statuses.every(s => s === 'Aprovado')) return 'Aprovado';
    if (statuses.some(s => s === 'Reprovado')) return 'Reprovado';
    return 'Aprovado';
  };

  const overallStatus = computeOverallStatus();

  const saveAndApprove = async (status) => {
    const analystName = internalUser?.nome_completo || internalUser?.nome || '';
    const existing = results.find(r => r.production_id === selectedProd.id);
    const data = {
      production_id: selectedProd.id, op_number: selectedProd.op_number,
      product: selectedProd.product, client: selectedProd.client, lot: selectedProd.lot,
      date: new Date().toISOString(), analyst: analystName,
      status, observations: analysisForm.observations, results: analysisForm.results,
      sample_photo_url: analysisForm.sample_photo_url || '',
    };
    setSaving(true);
    try {
      if (existing) await base44.entities.QualityResult.update(existing.id, data);
      else await base44.entities.QualityResult.create(data);

      const alreadyFinished = selectedProd.status === 'Finalizado';
      let newProdStatus;
      if (status === 'Reprovado') {
        newProdStatus = 'Cancelado';
      } else if (alreadyFinished) {
        newProdStatus = 'Finalizado';
      } else {
        newProdStatus = 'Envase';
      }
      const prodUpdates = { qc_status: status, qc_analyst: analystName, qc_observations: analysisForm.observations, status: newProdStatus };
      if (newProdStatus === 'Envase') {
        prodUpdates.envase_start_time = new Date().toISOString();
      }
      await base44.entities.Production.update(selectedProd.id, prodUpdates);

      if (newProdStatus === 'Cancelado' && selectedProd.order_id) {
        try {
          await syncOrderFromProductions(selectedProd.order_id, base44.entities);
        } catch (orderErr) {
          console.error('Falha ao sincronizar pedido após reprovação CQ:', orderErr);
        }
      }

      if (newProdStatus === 'Envase') {
        await NotificationService.cqReleased({
          id: selectedProd.id,
          op_number: selectedProd.op_number,
          client: selectedProd.client,
        });
      }

      setShowAnalysis(false);
      load();
    } catch (err) {
      toast({ title: t('quality.producoesCq.saveError'), description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const filtered = productions.filter(p => { const q = search.toLowerCase(); return !q || [p.op_number, p.product, p.client].some(v => (v || '').toLowerCase().includes(q)); });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('quality.producoesCq.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('quality.producoesCq.subtitle', { count: productions.length })}</p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder={t('common.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(prod => (
            <ProductionCard key={prod.id} prod={prod}>
              <Button onClick={() => openAnalysis(prod)} className="w-full text-white" style={{ background: '#1e40af' }}>
                <FileCheck className="w-3.5 h-3.5 mr-1.5" /> {t('quality.producoesCq.analyze')}
              </Button>
            </ProductionCard>
          ))}
        </div>
      )}

      {filtered.length === 0 && !loading && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium mb-1">{t('quality.producoesCq.empty')}</p>
        </div>
      )}

      <Dialog open={showAnalysis} onOpenChange={setShowAnalysis}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t('quality.producoesCq.dialogTitle', { product: selectedProd?.product, lot: selectedProd?.lot })}</DialogTitle></DialogHeader>
          {selectedProd && (
            <div>
              <div className="grid grid-cols-3 gap-3 text-sm mb-4 bg-muted/50 rounded-lg p-3">
                <div><p className="text-xs text-muted-foreground">{t('production.opNumber')}</p><p className="font-bold">{selectedProd.op_number}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('common.volume')}</p><p className="font-medium">{fmtVolume(selectedProd.volume || 0, 'L', i18n.language)}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('common.date')}</p><p className="font-medium">{fmtDate(selectedProd.date, undefined, i18n.language)}</p></div>
              </div>
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t('quality.producoesCq.analystAuto')}</p>
                  <p className="text-sm font-semibold text-foreground mt-1">{t('quality.producoesCq.analystAutoHint')}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCapturePhoto} />
                  {analysisForm.sample_photo_url ? (
                    <div className="flex items-center gap-2">
                      <SignedImage url={analysisForm.sample_photo_url} alt={t('quality.producoesCq.sampleAlt')} className="w-16 h-16 object-cover rounded-lg border" />
                      <button type="button" onClick={() => setAnalysisForm(prev => ({ ...prev, sample_photo_url: '' }))} className="p-1 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => photoInputRef.current?.click()} className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border border-dashed border-gray-300 hover:border-[#2575D1] hover:text-[#2575D1] text-gray-500 transition-colors">
                      <Camera className="w-4 h-4" /> {t('quality.producoesCq.samplePhoto')}
                    </button>
                  )}
                </div>
              </div>
              <h4 className="text-sm font-semibold mb-2">{t('quality.producoesCq.resultsTitle', { revision: selectedProd.recipe_revision || 'Rev.01' })}</h4>
              <table className="w-full text-sm border rounded-lg overflow-hidden">
                <thead><tr className="text-xs font-semibold text-muted-foreground">
                  <th className="px-3 py-2 text-left">{t('quality.ensaios.table.analysis').toUpperCase()}</th><th className="px-3 py-2 text-left">{t('quality.producoesCq.table.method')}</th><th className="px-3 py-2 text-left">{t('quality.producoesCq.table.unitShort')}</th>
                  <th className="px-3 py-2 text-right">{t('quality.fields.min').toUpperCase()}</th><th className="px-3 py-2 text-right">{t('quality.fields.max').toUpperCase()}</th><th className="px-3 py-2 text-left">{t('quality.producoesCq.table.specification')}</th><th className="px-3 py-2 text-left">{t('quality.producoesCq.table.result')}</th><th className="px-3 py-2 text-left">{t('common.status').toUpperCase()}</th>
                </tr></thead>
                <tbody>
                  {analysisForm.results.map((r, idx) => {
                    const isText = isTextAnalysis(r.analysis_name);
                    const statusColor = r.status === 'Aprovado' ? 'text-green-600 font-semibold' : r.status === 'Reprovado' ? 'text-red-600 font-semibold' : 'text-muted-foreground';
                    return (
                      <tr key={idx} className="border-t">
                        <td className="px-3 py-2 font-medium">{r.analysis_name}</td>
                        <td className="px-3 py-2">{r.methodology}</td>
                        <td className="px-3 py-2">{r.unit || na}</td>
                        <td className="px-3 py-2 text-right">{isText ? na : (r.min_limit != null ? fmtNum(r.min_limit) : na)}</td>
                        <td className="px-3 py-2 text-right">{isText ? na : (r.max_limit != null ? fmtNum(r.max_limit) : na)}</td>
                        <td className="px-3 py-2 text-xs">{isText ? (r.specification || na) : na}</td>
                        <td className="px-2 py-1">
                          {isText ? (
                            <Select value={r.result} onValueChange={v => updateResult(idx, v)}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('quality.producoesCq.conformPlaceholder')} /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Conforme">{t('quality.resultStatus.conforming')}</SelectItem>
                                {r.specification && r.specification !== 'Conforme' && <SelectItem value={r.specification}>{r.specification}</SelectItem>}
                                <SelectItem value="Não Conforme">{t('quality.resultStatus.nonConforming')}</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input value={r.result} onChange={e => updateResult(idx, e.target.value)} className="h-8 text-xs" placeholder={t('quality.producoesCq.resultPlaceholder')} />
                          )}
                        </td>
                        <td className={`px-3 py-2 text-xs ${statusColor}`}>{translateResultStatus(r.status)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-4"><label className="text-xs font-medium text-muted-foreground">{t('common.observations')}</label><textarea className="w-full border rounded-md px-3 py-2 text-sm" rows={2} value={analysisForm.observations} onChange={e => setAnalysisForm({ ...analysisForm, observations: e.target.value })} /></div>

              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{t('quality.fields.finalStatus')}</span>
                  {overallStatus ? (
                    <span className={`inline-flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-lg ${overallStatus === 'Aprovado' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {overallStatus === 'Aprovado' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      {translateResultStatus(overallStatus)}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">{t('quality.producoesCq.fillAllResults')}</span>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setShowAnalysis(false)} disabled={saving}>{t('buttons.cancel')}</Button>
                <Button variant="outline" className="text-amber-600 border-amber-300" disabled={saving} onClick={() => saveAndApprove('Com Restrição')}>
                  {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />...</> : t('quality.producoesCq.releaseWithPending')}
                </Button>
                <Button variant="destructive" disabled={saving} onClick={() => saveAndApprove('Reprovado')}>
                  {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />...</> : t('quality.producoesCq.block')}
                </Button>
                <Button onClick={() => saveAndApprove('Aprovado')} disabled={overallStatus !== 'Aprovado' || saving} className="text-white" style={{ background: overallStatus === 'Aprovado' ? '#2575D1' : '#94a3b8' }} title={overallStatus !== 'Aprovado' ? t('quality.producoesCq.allMustApprove') : ''}>
                  {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('common.saving')}</> : t('quality.producoesCq.saveAndRelease')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
