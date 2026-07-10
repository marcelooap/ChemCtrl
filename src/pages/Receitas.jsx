import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { Plus, Search, Eye, Pencil, Trash2, X, FileText, FlaskConical, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { generateRecipePDF } from '@/lib/pdfReports';
import Combobox from '@/components/ui/combobox';
import SimuladorReceita from '@/components/receitas/SimuladorReceita';
import RecipeFdsSection, { RecipeFdsViewSection } from '@/components/receitas/RecipeFdsSection';
import ConfirmDialog from '@/components/ConfirmDialog';
import { fmtNumber, fmtCurrency, fmtVolume } from '@/i18n/formatters';
import { canManageRecipeFds, canRemoveRecipeFds, canViewRecipeFds } from '@/lib/permissions';
import { uploadRecipeDocument, deleteRecipeDocument, validatePdfFile, DOC_TYPES } from '@/api/storage';

const emptyMP = { mp_code: '', mp_name: '', mp_density: 1, percentage: 0, quantity_kg: 0 };

function ViewRecipeBody({ viewing, calcCapacidade, generateRecipePDF, onClose, canViewFds }) {
  const { t } = useTranslation();
  const cap = calcCapacidade(viewing);
  return (
    <div>
      {cap && (
        <div className="flex items-center gap-6 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-4">
          <div>
            <p className="text-xs text-blue-500 font-medium uppercase tracking-wide">{t('recipes.view.productionCapacity')}</p>
            <p className="text-xl font-bold text-blue-800">
              {cap.volume > 0 ? fmtVolume(cap.volume, 'L') : t('common.notAvailable')}
            </p>
          </div>
          <div className="border-l border-blue-200 pl-6">
            <p className="text-xs text-blue-500 font-medium uppercase tracking-wide">{t('recipes.view.limitingMp')}</p>
            <p className="text-sm font-bold text-red-600">{cap.limitante || t('common.notAvailable')}</p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-4 text-sm mb-4">
        <div><p className="text-xs text-muted-foreground">{t('recipes.view.productCode')}</p><p className="font-medium">{viewing.code || t('common.notAvailable')}</p></div>
        <div><p className="text-xs text-muted-foreground">{t('recipes.view.client')}</p><p className="font-bold">{viewing.client}</p></div>
        <div><p className="text-xs text-muted-foreground">{t('recipes.view.unitPrice')}</p><p className="font-bold">{fmtCurrency(viewing.price || 0)}</p></div>
        <div><p className="text-xs text-muted-foreground">{t('recipes.view.productDensity')}</p><p className="font-medium">{viewing.density} g/mL</p></div>
        <div><p className="text-xs text-muted-foreground">{t('recipes.view.validity')}</p><p className="font-medium">{viewing.validity_days} {t('common.days')}</p></div>
        <div><p className="text-xs text-muted-foreground">{t('recipes.view.revision')}</p><p className="font-medium">{viewing.revision}</p></div>
        <div><p className="text-xs text-muted-foreground">{t('recipes.view.revisionDate')}</p><p className="font-medium">{viewing.revision_date}</p></div>
      </div>
      <h4 className="text-sm font-semibold mb-2">{t('recipes.view.rawMaterials')}</h4>
      <table className="w-full text-sm border rounded-lg overflow-hidden">
        <thead><tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
          <th className="px-3 py-2 text-left">{t('recipes.view.mpCode')}</th>
          <th className="px-3 py-2 text-left">{t('recipes.view.mpName')}</th>
          <th className="px-3 py-2 text-right">{t('recipes.view.mpDensity')}</th>
          <th className="px-3 py-2 text-right">{t('recipes.view.percentMass')}</th>
          <th className="px-3 py-2 text-right">{t('recipes.view.quantityKg')}</th>
        </tr></thead>
        <tbody>
          {(viewing.raw_materials || []).map((m, i) => (
            <tr key={i} className="border-t">
              <td className="px-3 py-2 font-mono text-xs" style={{ color: '#2575D1' }}>{m.mp_code}</td>
              <td className="px-3 py-2">{m.mp_name}</td>
              <td className="px-3 py-2 text-right">{m.mp_density}</td>
              <td className="px-3 py-2 text-right">{(m.percentage || 0).toFixed(2)}%</td>
              <td className="px-3 py-2 text-right font-medium">{fmtNumber(m.quantity_kg || 0)}</td>
            </tr>
          ))}
          <tr className="border-t bg-muted/50 font-bold">
            <td colSpan={3} className="px-3 py-2">{t('common.totals')}</td>
            <td className="px-3 py-2 text-right">{(viewing.raw_materials || []).reduce((s, m) => s + (m.percentage || 0), 0).toFixed(2)}%</td>
            <td className="px-3 py-2 text-right">{fmtNumber((viewing.raw_materials || []).reduce((s, m) => s + (m.quantity_kg || 0), 0))} {t('common.units.kg')}</td>
          </tr>
        </tbody>
      </table>
      <RecipeFdsViewSection
        fdsUrl={viewing.fds_url}
        fdsFilename={viewing.fds_filename}
        canView={canViewFds}
      />
      <div className="flex justify-between mt-4">
        <Button variant="outline" onClick={() => generateRecipePDF(viewing)} className="gap-2">
          <FileText className="w-4 h-4" /> {t('buttons.generatePdf')}
        </Button>
        <Button variant="outline" onClick={onClose}>{t('buttons.close')}</Button>
      </div>
    </div>
  );
}
const emptyRecipe = { product_name: '', client: '', code: '', price: 0, density: '', validity_days: 365, revision: 'Revisão 01', revision_date: new Date().toISOString().split('T')[0], raw_materials: [{ ...emptyMP }] };

export default function Receitas() {
  const { t } = useTranslation();
  const { user } = useOutletContext();
  const canManageFds = canManageRecipeFds(user);
  const canRemoveFds = canRemoveRecipeFds(user);
  const canViewFds = canViewRecipeFds(user);
  const parseRawMaterials = (r) => ({ ...r, raw_materials: Array.isArray(r.raw_materials) ? r.raw_materials : (typeof r.raw_materials === 'string' ? (() => { try { return JSON.parse(r.raw_materials); } catch { return []; } })() : []) });
  const { data: recipes, loading, reload: load } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500), [], parseRawMaterials);
  const { data: stocks } = useRealtimeEntity('RawMaterialStock', () => base44.entities.RawMaterialStock.list('-created_date', 500), []);

  const convertToKg = (value, unit, density) => {
    const d = density || 1;
    switch (unit) {
      case 'kg':  return value;
      case 'L':   return value * d;
      case 'gal': return value * 3.78541 * d;
      case 'lb':  return value * 0.453592;
      default:    return value;
    }
  };

  const stockByMPCode = useMemo(() => {
    const map = {};
    stocks.forEach((s) => {
      const key = (s.mp_code || '').trim().toLowerCase();
      if (!key) return;
      const kg = convertToKg(s.current_stock || 0, s.unit, s.density || 1);
      map[key] = (map[key] || 0) + kg;
    });
    return map;
  }, [stocks]);

  const calcCapacidade = (recipe) => {
    if (!recipe) return null;
    const mps = recipe.raw_materials || [];
    const density = parseFloat(recipe.density) || 1;
    // Para cada MP calcula quantos kg consigo produzir (total massa) com o estoque disponível
    // massa_total = volume * density, portanto volume = massa_total / density
    // mp_kg_needed = massa_total * (pct/100)
    // max_massa_por_mp = estoque_mp_kg / (pct/100)
    let limitante = null;
    let maxMassaKg = Infinity;

    mps.forEach((m) => {
      const pct = (m.percentage || 0) / 100;
      if (pct <= 0) return;
      const key = (m.mp_code || '').trim().toLowerCase();
      const estoqueKg = key ? (stockByMPCode[key] || 0) : 0;
      const massaMaxima = estoqueKg / pct;
      if (massaMaxima < maxMassaKg) {
        maxMassaKg = massaMaxima;
        limitante = m.mp_name;
      }
    });

    if (maxMassaKg === Infinity || maxMassaKg <= 0) return { volume: 0, limitante: limitante || '—' };
    const volume = maxMassaKg / density;
    return { volume, limitante };
  };
  const [search, setSearch] = useState('');

  const regNumMap = useMemo(() => {
    const asc = [...recipes].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    const map = {};
    asc.forEach((r, i) => { map[r.id] = i + 1; });
    return map;
  }, [recipes]);

  const clientOptions = useMemo(() => {
    const set = new Set();
    recipes.forEach(r => { if (r.client) set.add(r.client); });
    return Array.from(set).map(v => ({ value: v, label: v }));
  }, [recipes]);
  const [showForm, setShowForm] = useState(false);
  const [showView, setShowView] = useState(false);
  const [showSimulador, setShowSimulador] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [form, setForm] = useState(emptyRecipe);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [pendingFdsFile, setPendingFdsFile] = useState(null);
  const { toast } = useToast();

  const filtered = recipes.filter(r => {
    const q = search.toLowerCase();
    return !q || [r.product_name, r.client, r.code].some(v => (v || '').toLowerCase().includes(q));
  });

  const openNew = () => { setEditing(null); setPendingFdsFile(null); setForm({ ...emptyRecipe, raw_materials: [{ ...emptyMP }] }); setShowForm(true); };
  const openEdit = (r) => {
    setPendingFdsFile(null);
    const raw = r.raw_materials;
    const parsed = Array.isArray(raw) ? raw : (typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : []);
    setEditing(r);
    setForm({ ...r, raw_materials: parsed.length ? parsed : [{ ...emptyMP }] });
    setShowForm(true);
  };
  const openView = (r) => {
    const raw = r.raw_materials;
    const parsed = Array.isArray(raw) ? raw : (typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : []);
    setViewing({ ...r, raw_materials: parsed });
    setShowView(true);
  };

  // Cálculo de quantidade em massa: 5000 L × densidade PA × %m/m
  const calcQty = (pct) => 5000 * (parseFloat(form.density) || 1) * ((pct || 0) / 100);

  const updateMP = (idx, field, val) => {
    const mps = [...form.raw_materials];
    mps[idx] = { ...mps[idx], [field]: val };
    if (field === 'percentage' || field === 'mp_density') {
      mps[idx].quantity_kg = calcQty(mps[idx].percentage || 0);
    }
    setForm({ ...form, raw_materials: mps });
  };

  const addMP = () => setForm({ ...form, raw_materials: [...form.raw_materials, { ...emptyMP }] });
  const removeMP = (idx) => setForm({ ...form, raw_materials: form.raw_materials.filter((_, i) => i !== idx) });

  const totalPct = form.raw_materials.reduce((s, m) => s + (m.percentage || 0), 0);
  const totalKg = form.raw_materials.reduce((s, m) => s + (m.quantity_kg || 0), 0);

  const handleFdsMetadataChange = (metadata) => {
    setForm((prev) => ({ ...prev, ...metadata }));
    if (editing) setEditing((prev) => ({ ...prev, ...metadata }));
  };

  const save = async () => {
    if (!form.product_name) { toast({ title: t('recipes.messages.productRequired'), variant: 'destructive' }); return; }
    const codes = form.raw_materials.map(m => (m.mp_code || '').trim()).filter(Boolean);
    const dupCode = codes.find((c, i) => codes.indexOf(c) !== i);
    if (dupCode) { toast({ title: t('recipes.messages.duplicateMpCode', { code: dupCode }), description: t('recipes.messages.duplicateMpDesc'), variant: 'destructive' }); return; }
    if (pendingFdsFile && !editing) {
      const validation = await validatePdfFile(pendingFdsFile);
      if (!validation.valid) {
        toast({ title: t('recipes.fds.errors.title'), description: t(`recipes.fds.errors.${validation.error}`), variant: 'destructive' });
        return;
      }
    }
    const mps = form.raw_materials.map(m => ({ ...m, quantity_kg: calcQty(m.percentage || 0) }));
    const { fds_url, fds_filename, fds_uploaded_at, fds_uploaded_by, ...recipeData } = form;
    const data = { ...recipeData, raw_materials: mps };
    setSaving(true);
    try {
      if (editing) {
        await base44.entities.Recipe.update(editing.id, data);
      } else {
        const created = await base44.entities.Recipe.create(data);
        if (pendingFdsFile && created?.id) {
          const path = await uploadRecipeDocument(created.id, DOC_TYPES.SDS, pendingFdsFile);
          await base44.entities.Recipe.update(created.id, {
            fds_url: path,
            fds_filename: pendingFdsFile.name,
            fds_uploaded_at: new Date().toISOString(),
            fds_uploaded_by: user?.nome || user?.full_name || user?.id || '',
          });
          setPendingFdsFile(null);
        }
      }
      setShowForm(false);
      load();
      toast({ title: editing ? t('success.updated') : t('success.created') });
    } catch (err) {
      toast({ title: t('errors.saveFailed'), description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const remove = (r) => setDeleteTarget(r);
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.fds_url) {
        await deleteRecipeDocument(deleteTarget.id, DOC_TYPES.SDS).catch(() => {});
      }
      await base44.entities.Recipe.delete(deleteTarget.id);
      setDeleteTarget(null);
      load();
      toast({ title: t('success.deleted') });
    } catch (err) {
      toast({ title: t('errors.saveFailed'), description: err.message, variant: 'destructive' });
    }
  };

  const avgPrice = recipes.length ? (recipes.reduce((s, r) => s + (r.price || 0), 0) / recipes.length) : 0;

  const recipesWithFdsCount = useMemo(
    () => recipes.filter((r) => r.fds_url).length,
    [recipes],
  );

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">🧪 {t('recipes.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('recipes.subtitle', { count: recipes.length })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowSimulador(true)} style={{ background: '#1a5fb4' }} className="text-white hover:opacity-90">
            <FlaskConical className="w-4 h-4 mr-2" /> {t('recipes.simulateVolume')}
          </Button>
          <Button onClick={openNew} style={{ background: '#2575D1' }} className="text-white hover:opacity-90">
            <Plus className="w-4 h-4 mr-2" /> {t('recipes.newRecipe')}
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder={t('recipes.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-gray-50 bg-muted/50/50">
                  <th className="px-4 py-3 text-left">{t('recipes.table.id')}</th>
                  <th className="px-4 py-3 text-left">{t('recipes.table.product')}</th>
                  <th className="px-4 py-3 text-left">{t('recipes.table.client')}</th>
                  <th className="px-4 py-3 text-right">{t('recipes.table.price')}</th>
                  <th className="px-4 py-3 text-left">{t('recipes.table.revision')}</th>
                  <th className="px-4 py-3 text-left">{t('recipes.table.revisionDate')}</th>
                  <th className="px-4 py-3 text-right">{t('recipes.table.mpCount')}</th>
                  <th className="px-4 py-3 text-center">{t('recipes.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, idx) => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-accent/30">
                    <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>RC{String(regNumMap[r.id] || 0).padStart(2, '0')}</td>
                    <td className="px-4 py-2.5 font-medium text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        {r.product_name}
                        {r.fds_url && (
                          <FileText
                            className="w-3.5 h-3.5 shrink-0 text-red-500"
                            title={t('recipes.table.fdsAttached')}
                            aria-label={t('recipes.table.fdsAttached')}
                          />
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{r.client}</td>
                    <td className="px-4 py-2.5 text-right text-sm">{(r.price || 0).toFixed(4)}</td>
                    <td className="px-4 py-2.5 text-sm">{r.revision}</td>
                    <td className="px-4 py-2.5 text-sm">{r.revision_date || t('common.notAvailable')}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-sm">{(r.raw_materials || []).length}</td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openView(r)} className="p-1 rounded hover:bg-muted"><Eye className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        <button onClick={() => openEdit(r)} className="p-1 rounded hover:bg-muted"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button>
                        <button onClick={() => remove(r)} className="p-1 rounded hover:bg-muted"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-4 py-3 border-t border-border flex items-center gap-6 text-xs text-muted-foreground">
          <span>{t('recipes.footer.registered')}: {recipes.length}</span>
          <span>{t('recipes.footer.avgPrice')}: <strong>{fmtCurrency(avgPrice)}/{t('common.units.kg')}</strong></span>
          <span>{t('recipes.footer.withPrice')}: {recipes.filter(r => r.price).length}</span>
          <span>{t('recipes.footer.withFds', { count: recipesWithFdsCount })}</span>
        </div>
      </div>

      <SimuladorReceita recipes={recipes} open={showSimulador} onOpenChange={setShowSimulador} />

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? t('recipes.editRecipe', { product: editing.product_name }) : t('recipes.newRecipe')}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">{t('recipes.form.productName')} *</label><Input value={form.product_name} onChange={e => setForm({ ...form, product_name: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">{t('recipes.form.client')}</label><Combobox value={form.client} onValueChange={v => setForm({ ...form, client: v })} options={clientOptions} placeholder={t('recipes.form.clientPlaceholder')} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">{t('recipes.form.productCode')}</label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">{t('recipes.form.unitPrice')}</label><Input type="number" step="0.0001" value={form.price} onChange={e => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">{t('recipes.form.productDensity')}</label><Input type="number" step="0.001" value={form.density} onChange={e => {
    const raw = e.target.value;
    const parsed = parseFloat(raw);
    const newDensity = isNaN(parsed) ? 0 : parsed;
    setForm({ ...form, density: raw === '' ? '' : newDensity, raw_materials: form.raw_materials.map(m => ({ ...m, quantity_kg: 5000 * (newDensity || 1) * ((m.percentage || 0) / 100) })) });
  }} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">{t('recipes.form.validityDays')}</label><Input type="number" value={form.validity_days} onChange={e => setForm({ ...form, validity_days: parseInt(e.target.value) || 0 })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">{t('recipes.form.revision')} *</label><Input value={form.revision} onChange={e => setForm({ ...form, revision: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">{t('recipes.form.revisionDate')}</label><Input type="date" value={form.revision_date} onChange={e => setForm({ ...form, revision_date: e.target.value })} /></div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">{t('recipes.form.rawMaterials')}</h3>
                <Button variant="outline" size="sm" onClick={addMP}><Plus className="w-3 h-3 mr-1" /> {t('recipes.form.addMp')}</Button>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                    <th className="px-3 py-2 text-left">{t('recipes.form.mpCode')}</th>
                    <th className="px-3 py-2 text-left">{t('recipes.form.mpName')}</th>
                    <th className="px-3 py-2 text-right">{t('recipes.form.density')}</th>
                    <th className="px-3 py-2 text-right">{t('recipes.form.percentMass')}</th>
                    <th className="px-3 py-2 text-right">{t('recipes.form.quantityKg')}</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr></thead>
                  <tbody>
                    {form.raw_materials.map((m, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-2 py-1"><Input value={m.mp_code} onChange={e => updateMP(idx, 'mp_code', e.target.value)} className="h-8 text-xs" /></td>
                        <td className="px-2 py-1"><Input value={m.mp_name} onChange={e => updateMP(idx, 'mp_name', e.target.value)} className="h-8 text-xs" /></td>
                        <td className="px-2 py-1"><Input type="number" step="0.001" value={m.mp_density} onChange={e => updateMP(idx, 'mp_density', parseFloat(e.target.value) || 0)} className="h-8 text-xs text-right" /></td>
                        <td className="px-2 py-1"><Input type="number" step="0.01" value={m.percentage} onChange={e => updateMP(idx, 'percentage', parseFloat(e.target.value) || 0)} className="h-8 text-xs text-right" /></td>
                        <td className="px-2 py-1 text-right text-xs font-medium text-muted-foreground">{calcQty(m.percentage || 0).toFixed(3)}</td>
                        <td className="px-1"><button onClick={() => removeMP(idx)} className="p-1 hover:bg-muted rounded"><X className="w-3 h-3 text-red-400" /></button></td>
                      </tr>
                    ))}
                    <tr className="border-t bg-muted/50">
                      <td colSpan={3} className="px-3 py-2 text-xs font-bold" style={{ color: '#2575D1' }}>{t('common.totals').toUpperCase()}</td>
                      <td className="px-3 py-2 text-right text-xs font-bold" style={{ color: totalPct === 100 ? '#10B981' : '#EF4444' }}>{totalPct.toFixed(2)} %</td>
                      <td className="px-3 py-2 text-right text-xs font-bold" style={{ color: '#2575D1' }}>{totalKg.toFixed(3)} {t('common.units.kg')}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {(canManageFds || (editing && form.fds_url && canViewFds)) && (
              <RecipeFdsSection
                recipeId={editing?.id || null}
                fdsUrl={form.fds_url}
                fdsFilename={form.fds_filename}
                fdsUploadedAt={form.fds_uploaded_at}
                canManage={canManageFds}
                canRemove={canRemoveFds}
                canView={canViewFds}
                uploadedBy={user?.nome || user?.full_name || user?.id || ''}
                onMetadataChange={handleFdsMetadataChange}
                pendingFile={pendingFdsFile}
                onPendingFileChange={setPendingFdsFile}
                mode={editing ? 'edit' : 'create'}
              />
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>{t('buttons.cancel')}</Button>
            <Button onClick={save} disabled={saving} style={{ background: '#2575D1' }} className="text-white">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('common.saving')}</> : editing ? t('recipes.form.saveChanges') : t('recipes.form.register')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>🧪 {viewing?.product_name}</DialogTitle></DialogHeader>
          {viewing && <ViewRecipeBody viewing={viewing} calcCapacidade={calcCapacidade} generateRecipePDF={generateRecipePDF} onClose={() => setShowView(false)} canViewFds={canViewFds} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t('recipes.deleteConfirm.title')}
        message={t('recipes.deleteConfirm.message')}
        onConfirm={confirmDelete}
        confirmLabel={t('buttons.delete')}
        confirmColor="#DC2626"
      />
    </div>
  );
}
