import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@industrializacao/api/base44Client';
import { useRealtimeEntity } from '@industrializacao/hooks/useRealtimeEntity';
import { useOutletContext } from 'react-router-dom';
import { Search, Pencil, FileText, Camera, Eye } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/components/ui/select';
import { Input } from '@shared/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@shared/components/ui/tooltip';
import { useToast } from '@shared/components/ui/use-toast';
import { generateCOAPDF } from '@industrializacao/lib/pdfReports';
import { fmtDate } from '@/i18n/formatters';
import COAViewDialog, { formatPackagingLabel } from '@industrializacao/components/qualidade/COAViewDialog';
import QualityAnalysisDialog from '@industrializacao/components/qualidade/QualityAnalysisDialog';
import { usePermissions } from '@industrializacao/lib/rbac/PermissionProvider';

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
  const { hasPermission } = usePermissions();
  const canIssue = !isReadOnly && hasPermission('quality_coa.issue_coa');
  const parseResults = (r) => ({ ...r, results: parseArr(r.results) });
  const { data: results, loading, reload: load } = useRealtimeEntity('QualityResult', () => base44.entities.QualityResult.list('-created_date', 500), [], parseResults);
  const { data: recipes } = useRealtimeEntity('Recipe', () => base44.entities.Recipe.list('-created_date', 500));
  const { data: containers } = useRealtimeEntity('Container', () => base44.entities.Container.list('-created_date', 500));
  const { data: productions } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 500));
  const { data: tests } = useRealtimeEntity('QualityTest', () => base44.entities.QualityTest.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('all');
  const [showEdit, setShowEdit] = useState(false);
  const [showView, setShowView] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editingProd, setEditingProd] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [generatingPDF, setGeneratingPDF] = useState(null);
  const { toast } = useToast();

  const na = t('common.notAvailable');

  const translateQcStatus = useCallback((status) => {
    if (!status) return status;
    const key = QC_STATUS_KEYS[status];
    return key ? t(key) : status;
  }, [t]);

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

  const openEdit = (r) => {
    const prod =
      (productions || []).find(p => p.id === r.production_id) ||
      (productions || []).find(p => p.op_number === r.op_number) ||
      null;
    if (!prod) {
      toast({
        title: t('errors.saveFailed'),
        description: t('quality.coaPage.productionNotFound', {
          defaultValue: 'Produção vinculada não encontrada. Não é possível editar a análise.',
        }),
        variant: 'destructive',
      });
      return;
    }
    setEditing(r);
    setEditingProd(prod);
    setShowEdit(true);
  };

  const openView = (r) => { setViewing(r); setShowView(true); };

  const editingTest = editingProd ? (tests || []).find(item => item.product === editingProd.product) : null;

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
    } catch (_e) {
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
              <thead className="sticky top-0 z-10"><tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left">{t('production.opNumber')}</th><th className="px-4 py-3 text-left">{t('quality.fields.product')}</th><th className="px-4 py-3 text-left">{t('quality.fields.client')}</th>
                <th className="px-4 py-3 text-left">{t('quality.fields.lot')}</th><th className="px-4 py-3 text-left">{t('quality.coaPage.packagingColumn')}</th><th className="px-4 py-3 text-left">{t('quality.coaPage.analysisDate')}</th><th className="px-4 py-3 text-left">{t('quality.fields.analyst')}</th>
                <th className="px-4 py-3 text-center">{t('quality.coaPage.qcStatus')}</th><th className="px-4 py-3 text-center">{t('quality.coaPage.editColumn')}</th><th className="px-4 py-3 text-center">{t('quality.coa')}</th>
              </tr></thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-b border-border hover:bg-accent/30">
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
                        {canIssue && (
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

      <QualityAnalysisDialog
        open={showEdit}
        onOpenChange={(open) => {
          setShowEdit(open);
          if (!open) {
            setEditing(null);
            setEditingProd(null);
          }
        }}
        production={editingProd}
        qualityTest={editingTest}
        existingResult={editing}
        onSaved={() => {
          load();
          toast({ title: t('quality.coaPage.updated') });
        }}
      />
    </div>
    </TooltipProvider>
  );
}
