import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@industrializacao/api/base44Client';
import { useRealtimeEntity } from '@industrializacao/hooks/useRealtimeEntity';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { Plus, Search, Eye, Pencil, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Switch } from '@shared/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { useToast } from '@shared/components/ui/use-toast';
import { cn } from '@shared/lib/utils';

const parseArr = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return []; }
  }
  return [];
};

const normalizeName = (name) => (name || '').trim();
const nameKey = (name) => normalizeName(name).toLocaleUpperCase('pt-BR');
const isActiveValue = (value) => value !== false && value !== 'false' && value !== 0;

const STATUS_STORAGE_KEY = 'chemctrl.quality_analyses.status';

const readLocalStatuses = () => {
  try {
    const raw = localStorage.getItem(STATUS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeLocalStatuses = (map) => {
  try {
    localStorage.setItem(STATUS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
};

const emptyForm = { analysis_name: '', methodology: '', unit: '' };
const DEFAULT_CREATED_BY = 'Marcelo Amaral';

/**
 * Aggregates unique analyses from Cadastro CQ (quality_tests.analyses)
 * and keeps a master catalog in quality_analyses when the table exists.
 */
export default function ListaEnsaios() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useInternalAuth();
  const currentUserName = user?.nome_completo || user?.nome || user?.full_name || '';
  const parseAnalyses = useCallback((item) => ({ ...item, analyses: parseArr(item.analyses) }), []);
  const { data: tests, loading: loadingTests, reload: reloadTests } = useRealtimeEntity(
    'QualityTest',
    () => base44.entities.QualityTest.list('-created_date', 500),
    [],
    parseAnalyses,
  );

  const [catalog, setCatalog] = useState([]);
  const [catalogAvailable, setCatalogAvailable] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [localStatuses, setLocalStatuses] = useState(() => readLocalStatuses());
  const [togglingKey, setTogglingKey] = useState(null);
  const syncingRef = useRef(false);
  const backfillCreatedByRef = useRef(false);

  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showView, setShowView] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const rows = await base44.entities.QualityAnalysis.list('analysis_name', 500);
      setCatalog(rows || []);
      setCatalogAvailable(true);
      return rows || [];
    } catch {
      setCatalog([]);
      setCatalogAvailable(false);
      return [];
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  /** One-time backfill: set Resp. Cadastro for existing analyses */
  useEffect(() => {
    if (!catalogAvailable || backfillCreatedByRef.current || catalog.length === 0) return;

    const toUpdate = catalog.filter(
      (row) => row.id && normalizeName(row.created_by) !== DEFAULT_CREATED_BY,
    );
    backfillCreatedByRef.current = true;
    if (toUpdate.length === 0) return;

    (async () => {
      try {
        for (const row of toUpdate) {
          try {
            await base44.entities.QualityAnalysis.update(row.id, { created_by: DEFAULT_CREATED_BY });
          } catch {
            // ignore row-level failures
          }
        }
        await loadCatalog();
      } catch {
        backfillCreatedByRef.current = false;
      }
    })();
  }, [catalogAvailable, catalog, loadCatalog]);

  /** Seed / sync catalog from analyses already registered in Cadastro CQ */
  useEffect(() => {
    if (!catalogAvailable || loadingTests || syncingRef.current) return;

    const existingKeys = new Set(catalog.map((c) => nameKey(c.analysis_name)));
    const toCreate = [];
    const seen = new Set();

    for (const test of tests) {
      for (const a of test.analyses || []) {
        const name = normalizeName(a.analysis_name);
        if (!name) continue;
        const key = nameKey(name);
        if (existingKeys.has(key) || seen.has(key)) continue;
        seen.add(key);
        toCreate.push({
          analysis_name: name,
          methodology: normalizeName(a.methodology) || null,
          unit: normalizeName(a.unit) || null,
          is_active: localStatuses[key] !== false,
          created_by: DEFAULT_CREATED_BY,
        });
      }
    }

    if (toCreate.length === 0) return;

    syncingRef.current = true;
    (async () => {
      try {
        for (const row of toCreate) {
          try {
            await base44.entities.QualityAnalysis.create(row);
          } catch {
            // Unique conflict or race — ignore and continue
          }
        }
        await loadCatalog();
      } finally {
        syncingRef.current = false;
      }
    })();
  }, [catalogAvailable, catalog, tests, loadingTests, loadCatalog, localStatuses]);

  const usageByKey = useMemo(() => {
    const map = new Map();
    for (const test of tests) {
      for (const a of test.analyses || []) {
        const name = normalizeName(a.analysis_name);
        if (!name) continue;
        const key = nameKey(name);
        let entry = map.get(key);
        if (!entry) {
          entry = {
            analysis_name: name,
            methodologies: new Map(),
            units: new Map(),
            products: new Map(),
          };
          map.set(key, entry);
        }
        if (a.methodology) {
          const m = normalizeName(a.methodology);
          entry.methodologies.set(m, (entry.methodologies.get(m) || 0) + 1);
        }
        if (a.unit) {
          const u = normalizeName(a.unit);
          entry.units.set(u, (entry.units.get(u) || 0) + 1);
        }
        if (test.product) {
          entry.products.set(test.product, {
            product: test.product,
            client: test.client || '',
            methodology: a.methodology || '',
            unit: a.unit || '',
            testId: test.id,
          });
        }
      }
    }
    return map;
  }, [tests]);

  const pickMostCommon = (freqMap) => {
    let best = '';
    let bestCount = -1;
    for (const [value, count] of freqMap.entries()) {
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    return best;
  };

  const rows = useMemo(() => {
    const map = new Map();

    for (const [key, usage] of usageByKey.entries()) {
      map.set(key, {
        key,
        id: null,
        analysis_name: usage.analysis_name,
        methodology: pickMostCommon(usage.methodologies),
        unit: pickMostCommon(usage.units),
        productCount: usage.products.size,
        products: Array.from(usage.products.values()).sort((a, b) =>
          a.product.localeCompare(b.product, 'pt-BR'),
        ),
        is_active: localStatuses[key] !== false,
        created_by: DEFAULT_CREATED_BY,
        fromCatalog: false,
      });
    }

    for (const item of catalog) {
      const key = nameKey(item.analysis_name);
      const usage = usageByKey.get(key);
      const existing = map.get(key);
      const active = isActiveValue(item.is_active);
      if (existing) {
        existing.id = item.id;
        existing.analysis_name = item.analysis_name || existing.analysis_name;
        existing.methodology = item.methodology || existing.methodology;
        existing.unit = item.unit || existing.unit;
        existing.is_active = active;
        existing.created_by = item.created_by || DEFAULT_CREATED_BY;
        existing.fromCatalog = true;
      } else {
        map.set(key, {
          key,
          id: item.id,
          analysis_name: item.analysis_name,
          methodology: item.methodology || '',
          unit: item.unit || '',
          productCount: usage?.products.size || 0,
          products: usage
            ? Array.from(usage.products.values()).sort((a, b) =>
              a.product.localeCompare(b.product, 'pt-BR'),
            )
            : [],
          is_active: active,
          created_by: item.created_by || DEFAULT_CREATED_BY,
          fromCatalog: true,
        });
      }
    }

    return Array.from(map.values())
      .sort((a, b) => a.analysis_name.localeCompare(b.analysis_name, 'pt-BR'))
      .map((row, index) => ({
        ...row,
        displayId: String(index + 1).padStart(2, '0'),
      }));
  }, [catalog, usageByKey, localStatuses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.analysis_name, row.methodology, row.unit, row.created_by]
        .some((v) => (v || '').toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const loading = loadingTests || loadingCatalog;

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      analysis_name: row.analysis_name || '',
      methodology: row.methodology || '',
      unit: row.unit || '',
    });
    setShowForm(true);
  };

  const openView = (row) => {
    setViewing(row);
    setShowView(true);
  };

  const propagateToTests = async (originalName, next) => {
    const originalKey = nameKey(originalName);
    const updates = [];

    for (const test of tests) {
      const analyses = parseArr(test.analyses);
      let changed = false;
      const nextAnalyses = analyses.map((a) => {
        if (nameKey(a.analysis_name) !== originalKey) return a;
        changed = true;
        return {
          ...a,
          analysis_name: next.analysis_name,
          methodology: next.methodology,
          unit: next.unit,
        };
      });
      if (changed) {
        updates.push(base44.entities.QualityTest.update(test.id, { ...test, analyses: nextAnalyses }));
      }
    }

    if (updates.length) await Promise.all(updates);
    return updates.length;
  };

  const removeFromTests = async (analysisName) => {
    const key = nameKey(analysisName);
    const updates = [];

    for (const test of tests) {
      const analyses = parseArr(test.analyses);
      const nextAnalyses = analyses.filter((a) => nameKey(a.analysis_name) !== key);
      if (nextAnalyses.length !== analyses.length) {
        updates.push(base44.entities.QualityTest.update(test.id, { ...test, analyses: nextAnalyses }));
      }
    }

    if (updates.length) await Promise.all(updates);
    return updates.length;
  };

  const persistLocalStatus = (key, active) => {
    setLocalStatuses((prev) => {
      const next = { ...prev, [key]: active };
      writeLocalStatuses(next);
      return next;
    });
  };

  const toggleStatus = async (row, nextActive) => {
    setTogglingKey(row.key);
    try {
      if (catalogAvailable && row.id) {
        await base44.entities.QualityAnalysis.update(row.id, { is_active: nextActive });
        setCatalog((prev) => prev.map((item) => (
          item.id === row.id ? { ...item, is_active: nextActive } : item
        )));
      } else if (catalogAvailable) {
        const created = await base44.entities.QualityAnalysis.create({
          analysis_name: row.analysis_name,
          methodology: row.methodology || null,
          unit: row.unit || null,
          is_active: nextActive,
          created_by: currentUserName || null,
          created_by_id: user?.id || null,
        });
        if (created?.id) {
          setCatalog((prev) => [...prev, created]);
        } else {
          await loadCatalog();
        }
      } else {
        persistLocalStatus(row.key, nextActive);
      }

      toast({
        title: nextActive
          ? t('quality.listaEnsaios.messages.statusInUse')
          : t('quality.listaEnsaios.messages.statusOutOfUse'),
      });
    } catch (err) {
      toast({
        title: t('quality.listaEnsaios.messages.statusError'),
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setTogglingKey(null);
    }
  };

  const save = async () => {
    const analysisName = normalizeName(form.analysis_name);
    if (!analysisName) {
      toast({ title: t('quality.listaEnsaios.messages.nameRequired'), variant: 'destructive' });
      return;
    }

    const payload = {
      analysis_name: analysisName,
      methodology: normalizeName(form.methodology) || null,
      unit: normalizeName(form.unit) || null,
    };

    const duplicate = rows.find(
      (r) => nameKey(r.analysis_name) === nameKey(analysisName) && (!editing || r.key !== editing.key),
    );
    if (duplicate) {
      toast({ title: t('quality.listaEnsaios.messages.duplicate'), variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        if (catalogAvailable && editing.id) {
          await base44.entities.QualityAnalysis.update(editing.id, payload);
        } else if (catalogAvailable && !editing.id) {
          const created = await base44.entities.QualityAnalysis.create({
            ...payload,
            is_active: editing.is_active !== false,
            created_by: currentUserName || null,
            created_by_id: user?.id || null,
          });
          editing.id = created?.id || null;
        }
        await propagateToTests(editing.analysis_name, payload);
        toast({ title: t('quality.listaEnsaios.messages.updated') });
      } else if (catalogAvailable) {
        await base44.entities.QualityAnalysis.create({
          ...payload,
          is_active: true,
          created_by: currentUserName || null,
          created_by_id: user?.id || null,
        });
        toast({ title: t('quality.listaEnsaios.messages.created') });
      } else {
        toast({
          title: t('quality.listaEnsaios.messages.catalogUnavailable'),
          variant: 'destructive',
        });
        return;
      }

      setShowForm(false);
      await Promise.all([loadCatalog(), reloadTests()]);
    } catch (err) {
      toast({
        title: t('quality.listaEnsaios.messages.saveError'),
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    const confirmMsg = row.productCount > 0
      ? t('quality.listaEnsaios.messages.deleteConfirmWithProducts', { count: row.productCount })
      : t('quality.listaEnsaios.messages.deleteConfirm');
    if (!confirm(confirmMsg)) return;

    try {
      if (catalogAvailable && row.id) {
        await base44.entities.QualityAnalysis.delete(row.id);
      }
      await removeFromTests(row.analysis_name);
      await Promise.all([loadCatalog(), reloadTests()]);
      toast({ title: t('quality.listaEnsaios.messages.deleted') });
    } catch (err) {
      toast({
        title: t('quality.listaEnsaios.messages.deleteError'),
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">{t('quality.listaEnsaios.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('quality.listaEnsaios.subtitle', { count: rows.length })}
          </p>
        </div>
        <Button
          onClick={openNew}
          style={{ background: '#2575D1' }}
          className="text-white hover:opacity-90"
          disabled={!catalogAvailable}
          title={!catalogAvailable ? t('quality.listaEnsaios.messages.catalogUnavailable') : undefined}
        >
          <Plus className="w-4 h-4 mr-2" />
          {t('quality.listaEnsaios.newAnalysis')}
        </Button>
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="shrink-0 p-4 border-b border-border">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t('quality.listaEnsaios.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left">{t('quality.listaEnsaios.table.id')}</th>
                  <th className="px-4 py-3 text-left">{t('quality.listaEnsaios.table.analysis')}</th>
                  <th className="px-4 py-3 text-left">{t('quality.listaEnsaios.table.methodology')}</th>
                  <th className="px-4 py-3 text-left">{t('quality.listaEnsaios.table.unit')}</th>
                  <th className="px-4 py-3 text-right">{t('quality.listaEnsaios.table.productCount')}</th>
                  <th className="px-4 py-3 text-center">{t('quality.listaEnsaios.table.status')}</th>
                  <th className="px-4 py-3 text-left">{t('quality.listaEnsaios.table.createdBy')}</th>
                  <th className="px-4 py-3 text-center">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      {t('quality.listaEnsaios.empty')}
                    </td>
                  </tr>
                ) : filtered.map((row) => (
                  <tr
                    key={row.key}
                    className="border-b border-border hover:bg-accent/30"
                    style={{ opacity: row.is_active ? 1 : 0.45 }}
                  >
                    <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#2575D1' }}>
                      {row.displayId}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-sm">{row.analysis_name}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">
                      {row.methodology || t('common.notAvailable')}
                    </td>
                    <td className="px-4 py-2.5 text-sm">
                      {row.unit || t('common.notAvailable')}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-sm">{row.productCount}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-2">
                        <Switch
                          checked={row.is_active}
                          disabled={togglingKey === row.key}
                          onCheckedChange={(checked) => toggleStatus(row, checked)}
                          className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-orange-500"
                          aria-label={row.is_active
                            ? t('quality.listaEnsaios.status.inUse')
                            : t('quality.listaEnsaios.status.outOfUse')}
                        />
                        <span
                          className={cn(
                            'text-xs font-semibold whitespace-nowrap',
                            row.is_active ? 'text-emerald-600' : 'text-orange-600',
                          )}
                        >
                          {row.is_active
                            ? t('quality.listaEnsaios.status.inUse')
                            : t('quality.listaEnsaios.status.outOfUse')}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground whitespace-nowrap">
                      {row.created_by || t('common.notAvailable')}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => openView(row)}
                          className="p-1 rounded hover:bg-muted"
                          title={t('buttons.view')}
                        >
                          <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          className="p-1 rounded hover:bg-muted"
                          title={t('buttons.edit')}
                        >
                          <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(row)}
                          className="p-1 rounded hover:bg-muted"
                          title={t('buttons.delete')}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="shrink-0 px-4 py-3 border-t border-border flex items-center gap-6 text-xs text-muted-foreground">
          <span>
            {t('quality.listaEnsaios.footer.registered')}: <strong>{rows.length}</strong>
          </span>
          <span>
            {t('quality.listaEnsaios.footer.displayed')}: {filtered.length}
          </span>
        </div>
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t('quality.listaEnsaios.form.editTitle')
                : t('quality.listaEnsaios.newAnalysis')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {t('quality.listaEnsaios.table.analysis')} *
              </label>
              <Input
                value={form.analysis_name}
                onChange={(e) => setForm({ ...form, analysis_name: e.target.value })}
                placeholder={t('quality.listaEnsaios.form.analysisPlaceholder')}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {t('quality.listaEnsaios.table.methodology')}
              </label>
              <Input
                value={form.methodology}
                onChange={(e) => setForm({ ...form, methodology: e.target.value })}
                placeholder={t('quality.listaEnsaios.form.methodologyPlaceholder')}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {t('quality.listaEnsaios.table.unit')}
              </label>
              <Input
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                placeholder={t('quality.listaEnsaios.form.unitPlaceholder')}
              />
            </div>
            {editing && editing.productCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('quality.listaEnsaios.form.propagateHint', { count: editing.productCount })}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>
              {t('buttons.cancel')}
            </Button>
            <Button onClick={save} disabled={saving} style={{ background: '#2575D1' }} className="text-white">
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t('common.saving')}
                </>
              ) : editing ? t('buttons.save') : t('buttons.register')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{viewing?.analysis_name}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div>
              <div className="grid grid-cols-5 gap-3 text-sm mb-4">
                <div>
                  <p className="text-xs text-muted-foreground">{t('quality.listaEnsaios.table.id')}</p>
                  <p className="font-medium" style={{ color: '#2575D1' }}>{viewing.displayId}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('quality.listaEnsaios.table.methodology')}</p>
                  <p className="font-medium">{viewing.methodology || t('common.notAvailable')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('quality.listaEnsaios.table.unit')}</p>
                  <p className="font-medium">{viewing.unit || t('common.notAvailable')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('quality.listaEnsaios.table.status')}</p>
                  <p className={cn('font-medium', viewing.is_active ? 'text-emerald-600' : 'text-orange-600')}>
                    {viewing.is_active
                      ? t('quality.listaEnsaios.status.inUse')
                      : t('quality.listaEnsaios.status.outOfUse')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('quality.listaEnsaios.table.createdBy')}</p>
                  <p className="font-medium">{viewing.created_by || t('common.notAvailable')}</p>
                </div>
              </div>

              <h4 className="text-sm font-semibold mb-2">
                {t('quality.listaEnsaios.view.productsTitle', { count: viewing.productCount })}
              </h4>
              {viewing.products.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('quality.listaEnsaios.view.noProducts')}</p>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-[13.75rem] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                          <th className="px-3 py-2 text-left">{t('quality.fields.product')}</th>
                          <th className="px-3 py-2 text-left">{t('quality.fields.client')}</th>
                          <th className="px-3 py-2 text-left whitespace-nowrap">{t('quality.listaEnsaios.table.methodology')}</th>
                          <th className="px-3 py-2 text-left whitespace-nowrap">{t('quality.listaEnsaios.table.unit')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewing.products.map((p) => (
                          <tr key={`${p.testId}-${p.product}`} className="border-t bg-card">
                            <td className="px-3 py-2 font-medium whitespace-nowrap">{p.product}</td>
                            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{p.client || t('common.notAvailable')}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{p.methodology || t('common.notAvailable')}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{p.unit || t('common.notAvailable')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end mt-4">
            <Button variant="outline" onClick={() => setShowView(false)}>{t('buttons.close')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
