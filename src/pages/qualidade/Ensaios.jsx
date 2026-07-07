import React, { useState, useMemo } from 'react';
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

const emptyAnalysis = { analysis_name: '', methodology: '', specification: '', unit: '', min_limit: null, max_limit: null };

const parseArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);

const isTextSpec = (name) => {
  const n = (name || '').toUpperCase().trim();
  return n === 'COR' || n === 'ASPECTO';
};

const fmtSpec = (a) => {
  if (isTextSpec(a.analysis_name)) return a.specification || '—';
  const min = a.min_limit != null ? a.min_limit.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '';
  const max = a.max_limit != null ? a.max_limit.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '';
  if (min && max) return `${min} — ${max}`;
  if (min) return `≥ ${min}`;
  if (max) return `≤ ${max}`;
  return '—';
};

export default function Ensaios() {
  const parseAnalyses = (item) => ({ ...item, analyses: parseArr(item.analyses) });
  const { data: tests, loading, reload: load } = useRealtimeEntity('QualityTest', () => base44.entities.QualityTest.list('-created_date', 500), [], parseAnalyses);
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500));
  const [search, setSearch] = useState('');

  const regNumMap = useMemo(() => {
    const asc = [...tests].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    const map = {};
    asc.forEach((t, i) => { map[t.id] = i + 1; });
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
    tests.forEach(t => (t.analyses || []).forEach(a => { if (a.analysis_name) set.add(a.analysis_name); }));
    return Array.from(set).map(v => ({ value: v, label: v, item: { name: v } }));
  }, [tests]);

  const { methodologyOptions, methodologyMap } = useMemo(() => {
    const set = new Set();
    const map = new Map();
    tests.forEach(t => (t.analyses || []).forEach(a => {
      if (a.methodology) set.add(a.methodology);
      if (a.analysis_name && a.methodology) map.set(a.analysis_name, a.methodology);
    }));
    return { methodologyOptions: Array.from(set).map(v => ({ value: v, label: v, item: { methodology: v } })), methodologyMap: map };
  }, [tests]);

  const { unitOptions, unitMap } = useMemo(() => {
    const set = new Set();
    const map = new Map();
    tests.forEach(t => (t.analyses || []).forEach(a => {
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

  const filtered = tests.filter(t => { const q = search.toLowerCase(); return !q || [t.product, t.client].some(v => (v || '').toLowerCase().includes(q)); });

  const openNew = () => { setEditing(null); setForm({ product: '', client: '', revision: 'Rev.01', revision_date: new Date().toISOString().split('T')[0], analyses: [{ ...emptyAnalysis }] }); setShowForm(true); };
  const openEdit = (t) => { setEditing(t); const a = parseArr(t.analyses); setForm({ ...t, analyses: a.length ? a : [{ ...emptyAnalysis }] }); setShowForm(true); };

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
    if (!form.product) { toast({ title: 'Informe o produto', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      if (editing) await base44.entities.QualityTest.update(editing.id, form);
      else await base44.entities.QualityTest.create(form);
      setShowForm(false); load();
      toast({ title: editing ? 'Ensaio atualizado' : 'Novo ensaio cadastrado' });
    } catch (err) {
      toast({ title: 'Erro ao salvar ensaio', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t) => { if (!confirm('Excluir?')) return; await base44.entities.QualityTest.delete(t.id); load(); };

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#1A1A2E' }}>🧪 Cadastro CQ</h1>
          <p className="text-sm text-muted-foreground">{tests.length} ensaio(s) cadastrado(s)</p>
        </div>
        <Button onClick={openNew} style={{ background: '#2575D1' }} className="text-white hover:opacity-90"><Plus className="w-4 h-4 mr-2" /> Novo Ensaio</Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Buscar produto ou cliente..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
        </div>
        {loading ? <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" /></div> : (
          <div className="flex-1 overflow-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10"><tr className="border-b border-gray-50 bg-gray-50/50">
                <th className="px-4 py-3 text-left">ID</th><th className="px-4 py-3 text-left">Produto</th><th className="px-4 py-3 text-left">Cliente</th>
                <th className="px-4 py-3 text-left">Revisão</th><th className="px-4 py-3 text-left">Dt. Revisão</th><th className="px-4 py-3 text-right">Análises</th><th className="px-4 py-3 text-center">Ações</th>
              </tr></thead>
              <tbody>
                {filtered.map((t, idx) => (
                  <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>EN{String(regNumMap[t.id] || 0).padStart(2, '0')}</td>
                    <td className="px-4 py-2.5 font-medium text-sm">{t.product}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{t.client}</td>
                    <td className="px-4 py-2.5 text-sm">{t.revision}</td>
                    <td className="px-4 py-2.5 text-sm">{t.revision_date || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-sm">{(t.analyses || []).length}</td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => { setViewing({ ...t, analyses: parseArr(t.analyses) }); setShowView(true); }} className="p-1 rounded hover:bg-gray-100"><Eye className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        <button onClick={() => openEdit(t)} className="p-1 rounded hover:bg-gray-100"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        <button onClick={() => remove(t)} className="p-1 rounded hover:bg-gray-100"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-6 text-xs text-muted-foreground">
          <span>Ensaios cadastrados: <strong>{tests.length}</strong></span>
          <span>Total de análises: <strong>{tests.reduce((s, t) => s + (t.analyses || []).length, 0)}</strong></span>
          <span>Exibidos: {filtered.length}</span>
        </div>
      </div>

      {/* Form */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `Editar · ${editing.product}` : 'Novo Ensaio'}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Produto * <span className="text-muted-foreground/60">(selecione ou digite)</span></label>
                <Combobox value={form.product} onValueChange={v => setForm({ ...form, product: v })} options={productOptions} onSelect={handleProductSelect} placeholder="Selecione um produto cadastrado ou digite..." />
              </div>
              <div><label className="text-xs font-medium text-muted-foreground">Cliente (automático)</label><Input value={form.client} readOnly className="bg-gray-50" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">Revisão</label><Input value={form.revision} onChange={e => setForm({ ...form, revision: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Data da Revisão</label><Input type="date" value={form.revision_date} onChange={e => setForm({ ...form, revision_date: e.target.value })} /></div>
            </div>
            <div className="flex items-center justify-between"><h4 className="text-sm font-semibold">Análises</h4><Button variant="outline" size="sm" onClick={addAnalysis}><Plus className="w-3 h-3 mr-1" /> Adicionar Análise</Button></div>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-xs font-semibold text-muted-foreground">
                  <th className="px-3 py-2 text-left">ANÁLISE</th><th className="px-3 py-2 text-left">METODOLOGIA</th><th className="px-3 py-2 text-left">UNIDADE</th><th className="px-3 py-2 text-left">ESPECIFICAÇÃO</th><th className="px-3 py-2 w-8"></th>
                </tr></thead>
                <tbody>
                  {form.analyses.map((a, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="px-2 py-1 align-top">
                        <Combobox value={a.analysis_name} onValueChange={v => { const an = [...form.analyses]; an[idx] = { ...an[idx], analysis_name: v }; setForm({ ...form, analyses: an }); }} options={analysisNameOptions} onSelect={(item) => handleAnalysisNameSelect(idx, item)} placeholder="Análise" inputClassName="h-8 text-xs" />
                      </td>
                      <td className="px-2 py-1 align-top">
                        <Combobox value={a.methodology} onValueChange={v => updateAnalysis(idx, 'methodology', v)} options={methodologyOptions} onSelect={(item) => updateAnalysis(idx, 'methodology', item.methodology)} placeholder="Metodologia" inputClassName="h-8 text-xs" />
                      </td>
                      <td className="px-2 py-1 align-top">
                        <Combobox value={a.unit} onValueChange={v => updateAnalysis(idx, 'unit', v)} options={unitOptions} onSelect={(item) => updateAnalysis(idx, 'unit', item.unit)} placeholder="Unid." inputClassName="h-8 text-xs" />
                      </td>
                      <td className="px-2 py-1 align-top">
                        {isTextSpec(a.analysis_name) ? (
                          <Input value={a.specification || ''} onChange={e => updateAnalysis(idx, 'specification', e.target.value)} className="h-8 text-xs" placeholder="Ex: Líquido, límpido sem sobrenadante..." />
                        ) : (
                          <div className="flex gap-1">
                            <PtBRInput value={a.min_limit} onChange={v => updateAnalysis(idx, 'min_limit', v)} placeholder="Mín." className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs" />
                            <PtBRInput value={a.max_limit} onChange={v => updateAnalysis(idx, 'max_limit', v)} placeholder="Máx." className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs" />
                          </div>
                        )}
                      </td>
                      <td className="px-1"><button onClick={() => removeAnalysis(idx)} className="p-1 hover:bg-gray-100 rounded"><X className="w-3 h-3 text-red-400" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving} style={{ background: '#2575D1' }} className="text-white">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</> : editing ? 'Salvar' : 'Cadastrar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View */}
      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{viewing?.product}</DialogTitle></DialogHeader>
          {viewing && (
            <div>
              <div className="grid grid-cols-3 gap-3 text-sm mb-4">
                <div><p className="text-xs text-muted-foreground">Cliente</p><p className="font-medium">{viewing.client}</p></div>
                <div><p className="text-xs text-muted-foreground">Revisão</p><p className="font-medium">{viewing.revision}</p></div>
                <div><p className="text-xs text-muted-foreground">Data</p><p className="font-medium">{viewing.revision_date}</p></div>
              </div>
              <table className="w-full text-sm border rounded-lg overflow-hidden">
                <thead><tr className="bg-gray-50 text-xs font-semibold text-muted-foreground">
                  <th className="px-3 py-2 text-left">Análise</th><th className="px-3 py-2 text-left">Metodologia</th><th className="px-3 py-2 text-left">Unidade</th><th className="px-3 py-2 text-left">Especificação</th>
                </tr></thead>
                <tbody>
                  {(viewing.analyses || []).map((a, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-medium">{a.analysis_name}</td>
                      <td className="px-3 py-2">{a.methodology}</td>
                      <td className="px-3 py-2">{a.unit || '—'}</td>
                      <td className="px-3 py-2">{fmtSpec(a)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-between mt-4">
            <Button variant="outline" onClick={() => generateEnsaioPDF(viewing)} className="gap-2"><FileText className="w-4 h-4" /> Gerar PDF</Button>
            <Button variant="outline" onClick={() => setShowView(false)}>Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
