import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { Plus, Search, Eye, Pencil, Trash2, X, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import Combobox from '@/components/ui/combobox';
import PtBRInput from '@/components/ui/pt-br-input';
import { generateEnsaioPDF } from '@/lib/pdfReports';
import { fmtDate, fmtNumber } from '@/i18n/formatters';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';

const emptyAnalysis = { analysis_name: '', methodology: '', specification: '', unit: '', min_limit: null, max_limit: null };

const parseArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);

const isTextSpec = (name) => {
  const n = (name || '').toUpperCase().trim();
  return n === 'COR' || n === 'ASPECTO';
};

export default function Ensaios() {
  const { t, i18n } = useTranslation();
  const parseAnalyses = (item) => ({ ...item, analyses: parseArr(item.analyses) });
  const { data: tests, loading, reload: load } = useRealtimeEntity('QualityTest', () => base44.entities.QualityTest.list('-created_date', 500), [], parseAnalyses);
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const pdfGuard = useSubmitGuard();

  const fmtSpec = useCallback((a) => {
    if (isTextSpec(a.analysis_name)) return a.specification || t('common.notAvailable');
    const opts = { minimumFractionDigits: 4, maximumFractionDigits: 4 };
    const min = a.min_limit != null ? fmtNumber(a.min_limit, opts, i18n.language) : '';
    const max = a.max_limit != null ? fmtNumber(a.max_limit, opts, i18n.language) : '';
    if (min && max) return `${min} — ${max}`;
    if (min) return `≥ ${min}`;
    if (max) return `≤ ${max}`;
    return t('common.notAvailable');
  }, [t, i18n.language]);

  const regNumMap = useMemo(() => {
    const asc = [...tests].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    const map = {};
    asc.forEach((item, i) => { map[item.id] = i + 1; });
    return map;
  }, [tests]);
  const [showForm, setShowForm] = useState(false);
  const [showView, setShowView] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [form, setForm] = useState({ product: '', client: '', revision: 'Rev.01', revision_date: new Date().toISOString().split('T')[0], analyses: [{ ...emptyAnalysis }] });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const analysisNameOptions = useMemo(() => {
    const set = new Set();
    tests.forEach(item => (item.analyses || []).forEach(a => { if (a.analysis_name) set.add(a.analysis_name); }));
    return Array.from(set).map(v => ({ value: v, label: v, item: { name: v } }));
  }, [tests]);

  const { methodologyOptions, methodologyMap } = useMemo(() => {
    const set = new Set();
    const map = new Map();
    tests.forEach(item => (item.analyses || []).forEach(a => {
      if (a.methodology) set.add(a.methodology);
      if (a.analysis_name && a.methodology) map.set(a.analysis_name, a.methodology);
    }));
    return { methodologyOptions: Array.from(set).map(v => ({ value: v, label: v, item: { methodology: v } })), methodologyMap: map };
  }, [tests]);

  const { unitOptions, unitMap } = useMemo(() => {
    const set = new Set();
    const map = new Map();
    tests.forEach(item => (item.analyses || []).forEach(a => {
      if (a.unit) set.add(a.unit);
      if (a.analysis_name && a.unit) map.set(a.analysis_name, a.unit);
    }));
    return { unitOptions: Array.from(set).map(v => ({ value: v, label: v, item: { unit: v } })), unitMap: map };
  }, [tests]);

  const productOptions = useMemo(() => {
    return recipes.map(r => ({ value: r.product_name, label: r.product_name, item: r }));
  }, [recipes]);

  const handleProductSelect = (selected) => {
    if (selected) {
      setForm(prev => ({ ...prev, product: selected.product_name || prev.product, client: selected.client || prev.client }));
    }
  };

  const filtered = tests.filter(item => { const q = search.toLowerCase(); return !q || [item.product, item.client].some(v => (v || '').toLowerCase().includes(q)); });

  const openNew = () => { setEditing(null); setForm({ product: '', client: '', revision: 'Rev.01', revision_date: new Date().toISOString().split('T')[0], analyses: [{ ...emptyAnalysis }] }); setShowForm(true); };
  const openEdit = (item) => { setEditing(item); const a = parseArr(item.analyses); setForm({ ...item, analyses: a.length ? a : [{ ...emptyAnalysis }] }); setShowForm(true); };

  const addAnalysis = () => setForm(prev => ({ ...prev, analyses: [...prev.analyses, { ...emptyAnalysis }] }));
  const removeAnalysis = (idx) => setForm(prev => ({ ...prev, analyses: prev.analyses.filter((_, i) => i !== idx) }));

  const updateAnalysis = (idx, field, val) => {
    const a = [...form.analyses]; a[idx] = { ...a[idx], [field]: val }; setForm({ ...form, analyses: a });
  };

  const handleAnalysisNameSelect = (idx, item) => {
    const a = [...form.analyses];
    a[idx] = { ...a[idx], analysis_name: item.name };
    if (methodologyMap.has(item.name)) a[idx].methodology = methodologyMap.get(item.name);
    if (unitMap.has(item.name)) a[idx].unit = unitMap.get(item.name);
    if (isTextSpec(item.name)) { a[idx].min_limit = null; a[idx].max_limit = null; }
    else { a[idx].specification = ''; }
    setForm({ ...form, analyses: a });
  };

  const save = async () => {
    if (!form.product) { toast({ title: t('quality.ensaios.messages.productRequired'), variant: 'destructive' }); return; }
    setSaving(true);
    try {
      if (editing) await base44.entities.QualityTest.update(editing.id, form);
      else await base44.entities.QualityTest.create(form);
      setShowForm(false); load();
      toast({ title: editing ? t('quality.ensaios.messages.updated') : t('quality.ensaios.messages.created') });
    } catch (err) {
      toast({ title: t('quality.ensaios.messages.saveError'), description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item) => {
    if (!confirm(t('quality.ensaios.messages.deleteConfirm'))) return;
    try {
      await base44.entities.QualityTest.delete(item.id);
      load();
      toast({ title: t('quality.ensaios.messages.deleted') });
    } catch (err) {
      toast({ title: t('quality.ensaios.messages.deleteError'), description: err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">{t('quality.ensaios.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('quality.ensaios.subtitle', { count: tests.length })}</p>
        </div>
        <Button onClick={openNew} style={{ background: '#2575D1' }} className="text-white hover:opacity-90"><Plus className="w-4 h-4 mr-2" /> {t('quality.ensaios.newTest')}</Button>
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="shrink-0 p-4 border-b border-border">
          <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder={t('quality.ensaios.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
        </div>
        {loading ? <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div> : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10"><tr className="border-b border-border bg-muted/50/50">
                <th className="px-4 py-3 text-left">{t('quality.ensaios.table.id')}</th><th className="px-4 py-3 text-left">{t('quality.fields.product')}</th><th className="px-4 py-3 text-left">{t('quality.fields.client')}</th>
                <th className="px-4 py-3 text-left">{t('quality.ensaios.table.revision')}</th><th className="px-4 py-3 text-left">{t('quality.ensaios.table.revisionDate')}</th><th className="px-4 py-3 text-right">{t('quality.ensaios.table.analyses')}</th><th className="px-4 py-3 text-center">{t('common.actions')}</th>
              </tr></thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b border-border hover:bg-accent/30">
                    <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>EN{String(regNumMap[item.id] || 0).padStart(2, '0')}</td>
                    <td className="px-4 py-2.5 font-medium text-sm">{item.product}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{item.client}</td>
                    <td className="px-4 py-2.5 text-sm">{item.revision}</td>
                    <td className="px-4 py-2.5 text-sm">{item.revision_date ? fmtDate(item.revision_date, undefined, i18n.language) : t('common.notAvailable')}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-sm">{(item.analyses || []).length}</td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => { setViewing({ ...item, analyses: parseArr(item.analyses) }); setShowView(true); }} className="p-1 rounded hover:bg-muted"><Eye className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        <button onClick={() => openEdit(item)} className="p-1 rounded hover:bg-muted"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        <button onClick={() => remove(item)} className="p-1 rounded hover:bg-muted"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="shrink-0 px-4 py-3 border-t border-border flex items-center gap-6 text-xs text-muted-foreground">
          <span>{t('quality.ensaios.footer.registered')}: <strong>{tests.length}</strong></span>
          <span>{t('quality.ensaios.footer.totalAnalyses')}: <strong>{tests.reduce((s, item) => s + (item.analyses || []).length, 0)}</strong></span>
          <span>{t('quality.ensaios.footer.displayed')}: {filtered.length}</span>
        </div>
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? t('quality.ensaios.form.editTitle', { product: editing.product }) : t('quality.ensaios.newTest')}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('quality.fields.product')} * <span className="text-muted-foreground/60">{t('quality.ensaios.form.productHint')}</span></label>
                <Combobox value={form.product} onValueChange={v => setForm({ ...form, product: v })} options={productOptions} onSelect={handleProductSelect} placeholder={t('quality.ensaios.form.productPlaceholder')} />
              </div>
              <div><label className="text-xs font-medium text-muted-foreground">{t('quality.ensaios.form.clientAuto')}</label><Input value={form.client} readOnly className="bg-muted/50" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">{t('quality.ensaios.table.revision')}</label><Input value={form.revision} onChange={e => setForm({ ...form, revision: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">{t('quality.ensaios.form.revisionDate')}</label><Input type="date" value={form.revision_date} onChange={e => setForm({ ...form, revision_date: e.target.value })} /></div>
            </div>
            <div className="flex items-center justify-between"><h4 className="text-sm font-semibold">{t('quality.sections.analyses')}</h4><Button variant="outline" size="sm" onClick={addAnalysis}><Plus className="w-3 h-3 mr-1" /> {t('quality.ensaios.form.addAnalysis')}</Button></div>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                  <th className="px-3 py-2 text-left">{t('quality.ensaios.table.analysis').toUpperCase()}</th><th className="px-3 py-2 text-left">{t('quality.ensaios.table.methodology').toUpperCase()}</th><th className="px-3 py-2 text-left">{t('quality.fields.unit').toUpperCase()}</th><th className="px-3 py-2 text-left">{t('quality.fields.specification').toUpperCase()}</th><th className="px-3 py-2 w-8"></th>
                </tr></thead>
                <tbody>
                  {form.analyses.map((a, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="px-2 py-1 align-top">
                        <Combobox value={a.analysis_name} onValueChange={v => { const an = [...form.analyses]; an[idx] = { ...an[idx], analysis_name: v }; setForm({ ...form, analyses: an }); }} options={analysisNameOptions} onSelect={(selected) => handleAnalysisNameSelect(idx, selected)} placeholder={t('quality.ensaios.form.analysisPlaceholder')} inputClassName="h-8 text-xs" />
                      </td>
                      <td className="px-2 py-1 align-top">
                        <Combobox value={a.methodology} onValueChange={v => updateAnalysis(idx, 'methodology', v)} options={methodologyOptions} onSelect={(selected) => updateAnalysis(idx, 'methodology', selected.methodology)} placeholder={t('quality.ensaios.form.methodologyPlaceholder')} inputClassName="h-8 text-xs" />
                      </td>
                      <td className="px-2 py-1 align-top">
                        <Combobox value={a.unit} onValueChange={v => updateAnalysis(idx, 'unit', v)} options={unitOptions} onSelect={(selected) => updateAnalysis(idx, 'unit', selected.unit)} placeholder={t('quality.ensaios.form.unitPlaceholder')} inputClassName="h-8 text-xs" />
                      </td>
                      <td className="px-2 py-1 align-top">
                        {isTextSpec(a.analysis_name) ? (
                          <Input value={a.specification || ''} onChange={e => updateAnalysis(idx, 'specification', e.target.value)} className="h-8 text-xs" placeholder={t('quality.ensaios.form.specPlaceholder')} />
                        ) : (
                          <div className="flex gap-1">
                            <PtBRInput value={a.min_limit} onChange={v => updateAnalysis(idx, 'min_limit', v)} placeholder={t('quality.ensaios.form.minPlaceholder')} className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs" />
                            <PtBRInput value={a.max_limit} onChange={v => updateAnalysis(idx, 'max_limit', v)} placeholder={t('quality.ensaios.form.maxPlaceholder')} className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs" />
                          </div>
                        )}
                      </td>
                      <td className="px-1"><button onClick={() => removeAnalysis(idx)} className="p-1 hover:bg-muted rounded"><X className="w-3 h-3 text-red-400" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>{t('buttons.cancel')}</Button>
            <Button onClick={save} disabled={saving} style={{ background: '#2575D1' }} className="text-white">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('common.saving')}</> : editing ? t('buttons.save') : t('buttons.register')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{viewing?.product}</DialogTitle></DialogHeader>
          {viewing && (
            <div>
              <div className="grid grid-cols-3 gap-3 text-sm mb-4">
                <div><p className="text-xs text-muted-foreground">{t('quality.fields.client')}</p><p className="font-medium">{viewing.client}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('quality.ensaios.table.revision')}</p><p className="font-medium">{viewing.revision}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('common.date')}</p><p className="font-medium">{viewing.revision_date ? fmtDate(viewing.revision_date, undefined, i18n.language) : t('common.notAvailable')}</p></div>
              </div>
              <table className="w-full text-sm border rounded-lg overflow-hidden">
                <thead><tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                  <th className="px-3 py-2 text-left">{t('quality.ensaios.table.analysis')}</th><th className="px-3 py-2 text-left">{t('quality.fields.method')}</th><th className="px-3 py-2 text-left">{t('quality.fields.unit')}</th><th className="px-3 py-2 text-left">{t('quality.fields.specification')}</th>
                </tr></thead>
                <tbody>
                  {(viewing.analyses || []).map((a, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-medium">{a.analysis_name}</td>
                      <td className="px-3 py-2">{a.methodology}</td>
                      <td className="px-3 py-2">{a.unit || t('common.notAvailable')}</td>
                      <td className="px-3 py-2">{fmtSpec(a)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-between mt-4">
            <Button variant="outline" disabled={pdfGuard.busy} onClick={() => pdfGuard.run(() => generateEnsaioPDF(viewing))} className="gap-2"><FileText className="w-4 h-4" /> {t('buttons.generatePdf')}</Button>
            <Button variant="outline" onClick={() => setShowView(false)}>{t('buttons.close')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
