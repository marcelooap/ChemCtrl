import React, { useState, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
// eslint-disable-next-line
import { uploadFileToSupabase } from '@/api/storage';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useOutletContext } from 'react-router-dom';
import { Search, Pencil, FileText, Camera, Trash2, Loader2, Eye } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { generateCOAPDF } from '@/lib/pdfReports';
import SignedImage from '@/components/SignedImage';
import { fmtDate, fmtNumber } from '@/i18n/formatters';
import COAViewDialog, { formatPackagingLabel } from '@/components/qualidade/COAViewDialog';

const parseArr = (v) => { if (!v) return []; if (Array.isArray(v)) return v; try { const p = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(p) ? p : []; } catch { return []; } };

const QC_STATUS_KEYS = {
  Aprovado: 'quality.fields.approved',
  Reprovado: 'quality.fields.rejected',
  'Com Restrição': 'quality.resultStatus.withRestriction',
  Pendente: 'quality.fields.pending',
};

export default function COA() {
  const { t, i18n } = useTranslation();
  const { isReadOnly } = useOutletContext();
  const parseResults = (r) => ({ ...r, results: parseArr(r.results) });
  const { data: results, loading, reload: load } = useRealtimeEntity('QualityResult', () => base44.entities.QualityResult.list('-created_date', 500), [], parseResults);
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500));
  const { data: containers } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const { data: productions } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('all');
  const [showEdit, setShowEdit] = useState(false);
  const [showView, setShowView] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [editForm, setEditForm] = useState({ analyst: '', observations: '', results: [] });
  const [generatingPDF, setGeneratingPDF] = useState(null);
  const { toast } = useToast();
  const photoInputRef = useRef(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);

  const na = t('common.notAvailable');

  const translateQcStatus = useCallback((status) => {
    if (!status) return status;
    const key = QC_STATUS_KEYS[status];
    return key ? t(key) : status;
  }, [t]);

  const fmt4 = useCallback((n) => {
    if (n == null) return na;
    return fmtNumber(n, { minimumFractionDigits: 4, maximumFractionDigits: 4 }, i18n.language);
  }, [na, i18n.language]);

  const containersByOp = useMemo(() => {
    const map = new Map();
    (containers || []).forEach(c => {
      const op = (c.op_number || '').trim();
      if (!op) return;
      if (!map.has(op)) map.set(op, []);
      map.get(op).push(c);
    });
    return map;
  }, [containers]);

  const packagingByOp = useMemo(() => {
    const map = new Map();
    (productions || []).forEach(p => {
      const op = (p.op_number || '').trim();
      if (!op) return;
      const values = [];
      if (p.packaging_type?.trim()) values.push(p.packaging_type.trim());
      if (p.packaging_info?.trim()) values.push(p.packaging_info.trim());
      if (values.length) map.set(op, values);
    });
    return map;
  }, [productions]);

  const clientOptions = useMemo(() => {
    const set = new Set();
    (recipes || []).forEach(r => { if (r.client?.trim()) set.add(r.client.trim()); });
    results.forEach(r => { if (r.client?.trim()) set.add(r.client.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, i18n.language));
  }, [recipes, results, i18n.language]);

  const filtered = results.filter(r => {
    const q = search.toLowerCase().trim();
    const opContainers = containersByOp.get(r.op_number) || [];
    const packagingTypes = packagingByOp.get(r.op_number) || [];
    const matchSearch = !q || [
      r.product,
      r.lot,
      r.op_number,
      ...opContainers.map(c => c.container_number),
      ...opContainers.map(c => c.barril_number),
      ...packagingTypes,
    ].some(v => (v || '').toLowerCase().includes(q));
    const matchClient = clientFilter === 'all' || (r.client || '') === clientFilter;
    return matchSearch && matchClient;
  });

  const openEdit = (r) => { setEditing(r); setEditForm({ analyst: r.analyst, observations: r.observations || '', results: parseArr(r.results), sample_photo_url: r.sample_photo_url || '' }); setShowEdit(true); };
  const openView = (r) => { setViewing(r); setShowView(true); };

  const renderPackagingCell = (r) => {
    const list = containersByOp.get(r.op_number) || [];
    if (list.length === 0) return na;
    if (list.length === 1) {
      return (list[0].container_number || '').trim() || na;
    }
    const countLabel = t('quality.coaPage.packagingCount', { count: String(list.length).padStart(2, '0') });
    const tooltipText = list.map(formatPackagingLabel).filter(Boolean).join('\n');
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default underline decoration-dotted underline-offset-2">{countLabel}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-pre-line bg-popover text-popover-foreground border shadow-md">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    );
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const url = await uploadFileToSupabase(file);
      setEditForm(prev => ({ ...prev, sample_photo_url: url }));
    } catch (e) {
      console.error('[COA] handlePhotoUpload erro:', e);
      toast({ title: t('quality.coaPage.photoUploadError'), description: e.message || t('quality.coaPage.photoBucketHint'), variant: 'destructive' });
    }
    finally { setUploadingPhoto(false); }
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await base44.entities.QualityResult.update(editing.id, { analyst: editForm.analyst, observations: editForm.observations, results: editForm.results, sample_photo_url: editForm.sample_photo_url || '' });
      setShowEdit(false); load();
      toast({ title: t('quality.coaPage.updated') });
    } catch (err) {
      toast({ title: t('errors.saveFailed'), description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePDF = async (r) => {
    setGeneratingPDF(r.id);
    try {
      const production = (productions || []).find(p => p.op_number === r.op_number) || null;
      const opContainers = containersByOp.get(r.op_number) || [];
      let recipe = null;
      if (production?.recipe_id) {
        recipe = (recipes || []).find(rc => rc.id === production.recipe_id) || null;
        if (!recipe) {
          try { recipe = await base44.entities.Recipe.get(production.recipe_id); } catch { /* keep null */ }
        }
      }
      if (!recipe) {
        recipe = (recipes || []).find(rc => rc.product_name === r.product) || null;
      }
      await generateCOAPDF({ ...r, results: parseArr(r.results) }, production, opContainers, recipe);
    } catch (e) {
      console.error(e);
      toast({ title: t('errors.pdfFailed'), variant: 'destructive' });
    } finally {
      setGeneratingPDF(null);
    }
  };

  const statusBadge = (s) => {
    const c = { Aprovado: 'bg-green-100 text-green-700', Reprovado: 'bg-red-100 text-red-700', 'Com Restrição': 'bg-amber-100 text-amber-700', Pendente: 'bg-muted text-foreground' };
    return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${c[s] || c.Pendente}`}>{translateQcStatus(s)}</span>;
  };

  const aprovados = results.filter(r => r.status === 'Aprovado').length;

  return (
    <TooltipProvider delayDuration={200}>
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      <div className="mb-4 shrink-0">
        <h1 className="text-2xl font-bold">{t('quality.coaPage.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('quality.coaPage.subtitle', { count: results.length })}</p>
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border shrink-0 flex items-center gap-3">
          <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder={t('quality.coaPage.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder={t('quality.fields.client')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('quality.coaPage.allClients')}</SelectItem>
              {clientOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {loading ? <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div> : (
          <div className="flex-1 overflow-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10"><tr className="border-b border-gray-50 bg-muted/50">
                <th className="px-4 py-3 text-left">{t('production.opNumber')}</th><th className="px-4 py-3 text-left">{t('quality.fields.product')}</th><th className="px-4 py-3 text-left">{t('quality.fields.client')}</th>
                <th className="px-4 py-3 text-left">{t('quality.fields.lot')}</th><th className="px-4 py-3 text-left">{t('quality.coaPage.packagingColumn')}</th><th className="px-4 py-3 text-left">{t('quality.coaPage.analysisDate')}</th><th className="px-4 py-3 text-left">{t('quality.fields.analyst')}</th>
                <th className="px-4 py-3 text-center">{t('quality.coaPage.qcStatus')}</th><th className="px-4 py-3 text-center">{t('quality.coaPage.editColumn')}</th><th className="px-4 py-3 text-center">{t('quality.coa')}</th>
              </tr></thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-accent/30">
                    <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>{r.op_number}</td>
                    <td className="px-4 py-2.5 font-medium text-sm">{r.product}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{r.client}</td>
                    <td className="px-4 py-2.5 text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        {r.lot}
                        {r.sample_photo_url && (
                          <Camera className="w-3.5 h-3.5 text-muted-foreground" title={t('quality.coaPage.samplePhotoTitle')} />
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-sm">{renderPackagingCell(r)}</td>
                    <td className="px-4 py-2.5 text-sm">{r.date ? fmtDate(r.date, undefined, i18n.language) : na}</td>
                    <td className="px-4 py-2.5 text-sm">{r.analyst}</td>
                    <td className="px-4 py-2.5 text-center">{statusBadge(r.status)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openView(r)} className="p-1 rounded hover:bg-muted" title={t('buttons.view')}>
                          <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                        {!isReadOnly && (
                          <button onClick={() => openEdit(r)} className="p-1 rounded hover:bg-muted" title={t('buttons.edit')}>
                            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {(() => {
                        const hasResults = parseArr(r.results).length > 0 && parseArr(r.results).some(res => res.result);
                        if (!hasResults) {
                          return (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-400 cursor-not-allowed" title={t('quality.coaPage.resultsNotRegistered')}>
                              <FileText className="w-3 h-3 opacity-40" /> PDF
                            </span>
                          );
                        }
                        return (
                          <button
                            onClick={() => handleGeneratePDF(r)}
                            disabled={generatingPDF === r.id}
                            className="text-xs font-medium px-2 py-1 rounded hover:bg-muted flex items-center gap-1 mx-auto disabled:opacity-50"
                            style={{ color: '#2575D1' }}
                          >
                            {generatingPDF === r.id ? <div className="w-3 h-3 border border-gray-300 border-t-[#2575D1] rounded-full animate-spin" /> : <FileText className="w-3 h-3" />}
                            PDF
                          </button>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="shrink-0 border-t border-border px-4 py-3 flex items-center gap-6 bg-muted/50/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase text-muted-foreground">{t('quality.coaPage.approvedCoas')}</span>
            <span className="text-sm font-bold px-2.5 py-0.5 rounded-full bg-green-100 text-green-700">{aprovados}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase text-muted-foreground">{t('quality.coaPage.registeredItems')}</span>
            <span className="text-sm font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700" style={{ color: '#2575D1' }}>{results.length}</span>
          </div>
        </div>
      </div>

      <COAViewDialog
        open={showView}
        onOpenChange={setShowView}
        result={viewing}
        containers={viewing ? (containersByOp.get(viewing.op_number) || []) : []}
      />

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t('quality.coaPage.editTitle', { product: editing?.product, lot: editing?.lot })}</DialogTitle></DialogHeader>
          {editing && (
            <div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div><label className="text-xs font-medium text-muted-foreground">{t('quality.fields.analyst')}</label><Input value={editForm.analyst} onChange={e => setEditForm({ ...editForm, analyst: e.target.value })} /></div>
                <div><label className="text-xs font-medium text-muted-foreground">{t('common.observations')}</label><Input value={editForm.observations} onChange={e => setEditForm({ ...editForm, observations: e.target.value })} /></div>
              </div>
              <div className="mb-4 flex items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground">{t('quality.sections.samplePhoto')}:</span>
                <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} />
                {editForm.sample_photo_url ? (
                  <div className="flex items-center gap-2">
                    <SignedImage url={editForm.sample_photo_url} alt={t('quality.producoesCq.sampleAlt')} className="w-16 h-16 object-cover rounded-lg border" />
                    <button type="button" onClick={() => setEditForm(prev => ({ ...prev, sample_photo_url: '' }))} className="p-1 rounded hover:bg-red-50 text-red-500" title={t('quality.coaPage.removePhoto')}><Trash2 className="w-4 h-4" /></button>
                    <button type="button" onClick={() => photoInputRef.current?.click()} className="p-1 rounded hover:bg-muted text-gray-500" title={t('quality.coaPage.replacePhoto')}><Camera className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto} className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border border-dashed border-gray-300 hover:border-[#2575D1] hover:text-[#2575D1] text-gray-500 transition-colors disabled:opacity-50">
                    <Camera className="w-4 h-4" /> {uploadingPhoto ? t('quality.coaPage.uploading') : t('quality.coaPage.addPhoto')}
                  </button>
                )}
              </div>
              <table className="w-full text-sm border rounded-lg overflow-hidden">
                <thead><tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                  <th className="px-3 py-2 text-left">{t('quality.ensaios.table.analysis').toUpperCase()}</th><th className="px-3 py-2 text-left">{t('quality.producoesCq.table.method')}</th><th className="px-3 py-2 text-left">{t('quality.producoesCq.table.unitShort')}</th>
                  <th className="px-3 py-2 text-right">{t('quality.fields.min').toUpperCase()}</th><th className="px-3 py-2 text-right">{t('quality.fields.max').toUpperCase()}</th><th className="px-3 py-2 text-left">{t('quality.producoesCq.table.result')}</th><th className="px-3 py-2 text-left">{t('common.status').toUpperCase()}</th>
                </tr></thead>
                <tbody>
                  {editForm.results.map((r, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="px-3 py-2 font-medium">{r.analysis_name}</td>
                      <td className="px-3 py-2">{r.methodology}</td>
                      <td className="px-3 py-2">{r.unit || na}</td>
                      <td className="px-3 py-2 text-right">{r.min_limit != null ? fmt4(r.min_limit) : na}</td>
                      <td className="px-3 py-2 text-right">{r.max_limit != null ? fmt4(r.max_limit) : na}</td>
                      <td className="px-2 py-1"><Input value={r.result} onChange={e => { const rs = [...editForm.results]; rs[idx] = { ...rs[idx], result: e.target.value }; setEditForm({ ...editForm, results: rs }); }} className="h-8 text-xs" /></td>
                      <td className="px-3 py-2 text-xs">{translateQcStatus(r.status) || na}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setShowEdit(false)} disabled={saving}>{t('buttons.cancel')}</Button>
                <Button onClick={saveEdit} disabled={saving} style={{ background: '#2575D1', color: 'white' }}>
                  {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('common.saving')}</> : t('quality.coaPage.saveChanges')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}
