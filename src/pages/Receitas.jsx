import React, { useState, useMemo } from 'react';
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

const emptyMP = { mp_code: '', mp_name: '', mp_density: 1, percentage: 0, quantity_kg: 0 };

function ViewRecipeBody({ viewing, calcCapacidade, generateRecipePDF, onClose }) {
  const cap = calcCapacidade(viewing);
  return (
    <div>
      {cap && (
        <div className="flex items-center gap-6 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-4">
          <div>
            <p className="text-xs text-blue-500 font-medium uppercase tracking-wide">Capacidade de Produção (estoque atual)</p>
            <p className="text-xl font-bold text-blue-800">
              {cap.volume > 0 ? cap.volume.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' L' : '—'}
            </p>
          </div>
          <div className="border-l border-blue-200 pl-6">
            <p className="text-xs text-blue-500 font-medium uppercase tracking-wide">MP Limitante</p>
            <p className="text-sm font-bold text-red-600">{cap.limitante || '—'}</p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-4 text-sm mb-4">
        <div><p className="text-xs text-muted-foreground">CÓDIGO DO PRODUTO</p><p className="font-medium">{viewing.code || '—'}</p></div>
        <div><p className="text-xs text-muted-foreground">CLIENTE</p><p className="font-bold">{viewing.client}</p></div>
        <div><p className="text-xs text-muted-foreground">PREÇO UNITÁRIO</p><p className="font-bold">R$ {(viewing.price || 0).toFixed(4)}</p></div>
        <div><p className="text-xs text-muted-foreground">DENSIDADE PA</p><p className="font-medium">{viewing.density} g/mL</p></div>
        <div><p className="text-xs text-muted-foreground">VALIDADE</p><p className="font-medium">{viewing.validity_days} dias</p></div>
        <div><p className="text-xs text-muted-foreground">REVISÃO</p><p className="font-medium">{viewing.revision}</p></div>
        <div><p className="text-xs text-muted-foreground">DATA DA REVISÃO</p><p className="font-medium">{viewing.revision_date}</p></div>
      </div>
      <h4 className="text-sm font-semibold mb-2">Matérias Primas</h4>
      <table className="w-full text-sm border rounded-lg overflow-hidden">
        <thead><tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
          <th className="px-3 py-2 text-left">Código MP</th>
          <th className="px-3 py-2 text-left">Matéria Prima</th>
          <th className="px-3 py-2 text-right">Dens. MP (g/mL)</th>
          <th className="px-3 py-2 text-right">% m/m</th>
          <th className="px-3 py-2 text-right">Qtd. (kg)</th>
        </tr></thead>
        <tbody>
          {(viewing.raw_materials || []).map((m, i) => (
            <tr key={i} className="border-t">
              <td className="px-3 py-2 font-mono text-xs" style={{ color: '#2575D1' }}>{m.mp_code}</td>
              <td className="px-3 py-2">{m.mp_name}</td>
              <td className="px-3 py-2 text-right">{m.mp_density}</td>
              <td className="px-3 py-2 text-right">{(m.percentage || 0).toFixed(2)}%</td>
              <td className="px-3 py-2 text-right font-medium">{(m.quantity_kg || 0).toLocaleString('pt-BR')}</td>
            </tr>
          ))}
          <tr className="border-t bg-muted/50 font-bold">
            <td colSpan={3} className="px-3 py-2">Totais</td>
            <td className="px-3 py-2 text-right">{(viewing.raw_materials || []).reduce((s, m) => s + (m.percentage || 0), 0).toFixed(2)}%</td>
            <td className="px-3 py-2 text-right">{(viewing.raw_materials || []).reduce((s, m) => s + (m.quantity_kg || 0), 0).toLocaleString('pt-BR')} kg</td>
          </tr>
        </tbody>
      </table>
      <div className="flex justify-between mt-4">
        <Button variant="outline" onClick={() => generateRecipePDF(viewing)} className="gap-2">
          <FileText className="w-4 h-4" /> Gerar PDF
        </Button>
        <Button variant="outline" onClick={onClose}>Fechar</Button>
      </div>
    </div>
  );
}
const emptyRecipe = { product_name: '', client: '', code: '', price: 0, density: '', validity_days: 365, revision: 'Revisão 01', revision_date: new Date().toISOString().split('T')[0], raw_materials: [{ ...emptyMP }] };

export default function Receitas() {
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
  const { toast } = useToast();

  const filtered = recipes.filter(r => {
    const q = search.toLowerCase();
    return !q || [r.product_name, r.client, r.code].some(v => (v || '').toLowerCase().includes(q));
  });

  const openNew = () => { setEditing(null); setForm({ ...emptyRecipe, raw_materials: [{ ...emptyMP }] }); setShowForm(true); };
  const openEdit = (r) => {
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

  const save = async () => {
    if (!form.product_name) { toast({ title: 'Informe o nome do produto', variant: 'destructive' }); return; }
    const codes = form.raw_materials.map(m => (m.mp_code || '').trim()).filter(Boolean);
    const dupCode = codes.find((c, i) => codes.indexOf(c) !== i);
    if (dupCode) { toast({ title: `Código de MP duplicado: ${dupCode}`, description: 'Não é permitido cadastrar matérias primas com o mesmo código.', variant: 'destructive' }); return; }
    const mps = form.raw_materials.map(m => ({ ...m, quantity_kg: calcQty(m.percentage || 0) }));
    const data = { ...form, raw_materials: mps };
    setSaving(true);
    try {
      if (editing) {
        await base44.entities.Recipe.update(editing.id, data);
      } else {
        await base44.entities.Recipe.create(data);
      }
      setShowForm(false);
      load();
      toast({ title: editing ? 'Receita atualizada' : 'Nova receita cadastrada' });
    } catch (err) {
      toast({ title: 'Erro ao salvar receita', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    if (!confirm('Excluir esta receita?')) return;
    await base44.entities.Recipe.delete(r.id);
    load();
  };

  const avgPrice = recipes.length ? (recipes.reduce((s, r) => s + (r.price || 0), 0) / recipes.length) : 0;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">🧪 Receitas</h1>
          <p className="text-sm text-muted-foreground">{recipes.length} receita(s) cadastrada(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowSimulador(true)} style={{ background: '#1a5fb4' }} className="text-white hover:opacity-90">
            <FlaskConical className="w-4 h-4 mr-2" /> Simular Volume
          </Button>
          <Button onClick={openNew} style={{ background: '#2575D1' }} className="text-white hover:opacity-90">
            <Plus className="w-4 h-4 mr-2" /> Nova Receita
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar por ID, produto ou cliente..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-gray-50 bg-muted/50/50">
                  <th className="px-4 py-3 text-left">ID</th>
                  <th className="px-4 py-3 text-left">Produto</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-right">Preço (R$)</th>
                  <th className="px-4 py-3 text-left">Revisão</th>
                  <th className="px-4 py-3 text-left">Dt. Revisão</th>
                  <th className="px-4 py-3 text-right">Qtd. MP</th>
                  <th className="px-4 py-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, idx) => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-accent/30">
                    <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>RC{String(regNumMap[r.id] || 0).padStart(2, '0')}</td>
                    <td className="px-4 py-2.5 font-medium text-sm">{r.product_name}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{r.client}</td>
                    <td className="px-4 py-2.5 text-right text-sm">{(r.price || 0).toFixed(4)}</td>
                    <td className="px-4 py-2.5 text-sm">{r.revision}</td>
                    <td className="px-4 py-2.5 text-sm">{r.revision_date || '—'}</td>
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
          <span>Receitas cadastradas: {recipes.length}</span>
          <span>Preço médio: <strong>R$ {avgPrice.toFixed(4)}/kg</strong></span>
          <span>Com preço definido: {recipes.filter(r => r.price).length}</span>
        </div>
      </div>

      <SimuladorReceita recipes={recipes} open={showSimulador} onOpenChange={setShowSimulador} />

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `Editar Receita · ${editing.product_name}` : 'Nova Receita'}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">Nome do Produto *</label><Input value={form.product_name} onChange={e => setForm({ ...form, product_name: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Cliente</label><Combobox value={form.client} onValueChange={v => setForm({ ...form, client: v })} options={clientOptions} placeholder="Selecione ou digite um cliente..." /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">Código do Produto</label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Preço Unitário (R$)</label><Input type="number" step="0.0001" value={form.price} onChange={e => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Densidade PA (g/mL)</label><Input type="number" step="0.001" value={form.density} onChange={e => {
    const raw = e.target.value;
    const parsed = parseFloat(raw);
    const newDensity = isNaN(parsed) ? 0 : parsed;
    setForm({ ...form, density: raw === '' ? '' : newDensity, raw_materials: form.raw_materials.map(m => ({ ...m, quantity_kg: 5000 * (newDensity || 1) * ((m.percentage || 0) / 100) })) });
  }} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">Validade (dias)</label><Input type="number" value={form.validity_days} onChange={e => setForm({ ...form, validity_days: parseInt(e.target.value) || 0 })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Revisão *</label><Input value={form.revision} onChange={e => setForm({ ...form, revision: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Data da Revisão</label><Input type="date" value={form.revision_date} onChange={e => setForm({ ...form, revision_date: e.target.value })} /></div>
            </div>

            {/* Raw Materials */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">Matérias Primas</h3>
                <Button variant="outline" size="sm" onClick={addMP}><Plus className="w-3 h-3 mr-1" /> Adicionar MP</Button>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                    <th className="px-3 py-2 text-left">CÓDIGO MP</th>
                    <th className="px-3 py-2 text-left">MATÉRIA PRIMA</th>
                    <th className="px-3 py-2 text-right">DENS. (G/ML)</th>
                    <th className="px-3 py-2 text-right">% M/M</th>
                    <th className="px-3 py-2 text-right">QTD. (KG)</th>
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
                      <td colSpan={3} className="px-3 py-2 text-xs font-bold" style={{ color: '#2575D1' }}>TOTAIS</td>
                      <td className="px-3 py-2 text-right text-xs font-bold" style={{ color: totalPct === 100 ? '#10B981' : '#EF4444' }}>{totalPct.toFixed(2)} %</td>
                      <td className="px-3 py-2 text-right text-xs font-bold" style={{ color: '#2575D1' }}>{totalKg.toFixed(3)} kg</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving} style={{ background: '#2575D1' }} className="text-white">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</> : editing ? 'Salvar Alterações' : 'Cadastrar Receita'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>🧪 {viewing?.product_name}</DialogTitle></DialogHeader>
          {viewing && <ViewRecipeBody viewing={viewing} calcCapacidade={calcCapacidade} generateRecipePDF={generateRecipePDF} onClose={() => setShowView(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
