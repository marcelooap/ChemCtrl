import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@industrializacao/api/base44Client';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Play, FileText, Trash2 } from 'lucide-react';
import ConfirmDialog from '@industrializacao/components/ConfirmDialog';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/components/ui/select';
import { useToast } from '@shared/components/ui/use-toast';
import InventoryWizard from '@industrializacao/components/inventario/InventoryWizard';
import { generateInventoryPDF } from '@industrializacao/lib/pdfReports';
import { inventoryScopeText, inventoryScopeValues } from '@industrializacao/lib/inventoryComposition';
import { fmtDateTime } from '@/i18n/formatters';
import { translateInventoryStatus } from '@/i18n/domainMaps';

const parseArr = (v) => { if (!v) return []; if (Array.isArray(v)) return v; try { const p = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(p) ? p : []; } catch { return []; } };

import { usePermissions } from '@industrializacao/lib/rbac/PermissionProvider';
import { useInventories } from '@industrializacao/hooks/useInventories';

export default function Inventario() {
  const { t, i18n } = useTranslation();
  const { user, isReadOnly } = useOutletContext();
  const { hasPermission } = usePermissions();
  const canCreate = !isReadOnly && hasPermission('inventory.create');
  const canEdit = !isReadOnly && hasPermission('inventory.edit');
  const canDelete = !isReadOnly && hasPermission('inventory.delete');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: inventories, loading, reload } = useInventories();
  const [search, setSearch] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [statusFilter, setStatusFilter] = useState('todos');
  const [generatingPDF, setGeneratingPDF] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = inventories.filter(inv => {
    const q = search.toLowerCase();
    const matchesSearch = !q || [
      inv.inventory_number,
      inventoryScopeText(inv, 'clients'),
      inventoryScopeText(inv, 'products'),
      inventoryScopeText(inv, 'lots'),
      inv.opened_by,
    ].some(v => (v || '').toLowerCase().includes(q));
    const matchesStatus = statusFilter === 'todos' || inv.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusBadge = (s) => {
    const c = { 'Aberto': 'bg-blue-100 text-blue-700', 'Em andamento': 'bg-amber-100 text-amber-700', 'Finalizado': 'bg-green-100 text-green-700' };
    return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${c[s] || c['Aberto']}`}>{translateInventoryStatus(s)}</span>;
  };

  const formatFilterValue = (value) => {
    if (value === 'TODOS') return t('inventory.page.allItems');
    return value;
  };

  const formatProductColumn = (inv) => {
    const names = inventoryScopeValues(inv, 'products');
    if (!names.length) return t('common.notAvailable');
    if (names.length === 1 && names[0] === 'TODOS') return formatFilterValue('TODOS');
    if (names.length === 1) return names[0];
    return t('inventory.page.productsCount', {
      count: String(names.length).padStart(2, '0'),
    });
  };

  const inventoryRouteId = (inv) => inv?.inventario_id || inv?.id;

  const handleStart = async (inv) => {
    try {
      const userName = user?.nome || user?.full_name || t('common.notAvailable');
      const patch = {
        status: 'Em andamento',
        start_date: new Date().toISOString(),
        started_by: userName,
      };
      if (inv._is_grouped && inv.inventario_id) {
        await base44.entities.Inventory.updateMany({ inventario_id: inv.inventario_id }, patch);
      } else {
        await base44.entities.Inventory.update(inv.id, patch);
      }
      navigate(`/inventario/${inventoryRouteId(inv)}`);
    } catch (e) {
      toast({ title: t('inventory.page.startError'), description: e?.message || String(e), variant: 'destructive' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget._is_grouped && deleteTarget.inventario_id) {
        await base44.entities.Inventory.deleteMany({
          inventario_id: deleteTarget.inventario_id,
        });
      } else {
        await base44.entities.Inventory.delete(deleteTarget.id);
      }
      toast({ title: t('success.deleted') });
      setDeleteTarget(null);
      reload();
    } catch (e) {
      toast({
        title: t('inventory.page.deleteError'),
        description: e?.message || String(e),
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handlePDF = (inv) => {
    setGeneratingPDF(inv.id);
    try {
      generateInventoryPDF({
        ...inv,
        items: parseArr(inv.items),
        clients: inventoryScopeText(inv, 'clients'),
        products: inventoryScopeText(inv, 'products'),
        lots: inventoryScopeText(inv, 'lots'),
      });
    } catch (e) {
      toast({ title: t('inventory.page.pdfError'), variant: 'destructive' });
    } finally {
      setGeneratingPDF(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">📋 {t('inventory.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('inventory.page.subtitle', { count: inventories.length })}</p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowWizard(true)} style={{ background: '#2575D1' }} className="text-white hover:opacity-90">
            <Plus className="w-4 h-4 mr-2" /> {t('inventory.page.openInventory')}
          </Button>
        )}
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="shrink-0 p-4 border-b border-border flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder={t('inventory.page.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t('common.all')}</SelectItem>
              <SelectItem value="Aberto">{translateInventoryStatus('Aberto')}</SelectItem>
              <SelectItem value="Em andamento">{translateInventoryStatus('Em andamento')}</SelectItem>
              <SelectItem value="Finalizado">{translateInventoryStatus('Finalizado')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
          ) : (
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold">{t('inventory.number')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">{t('inventory.page.openingDate')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">{t('common.client')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">{t('common.product')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">{t('inventory.page.user')}</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold">{t('common.status')}</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-sm text-muted-foreground">{t('inventory.page.noResults')}</td></tr>
                ) : filtered.map(inv => {
                  const clientsLabel = inventoryScopeText(inv, 'clients');
                  const clients = clientsLabel === 'TODOS' ? formatFilterValue('TODOS') : clientsLabel;
                  const products = formatProductColumn(inv);
                  const isFinished = inv.status === 'Finalizado';
                  const canStart = inv.status === 'Aberto' && canEdit;
                  return (
                    <tr key={inv.id} className="border-b border-border hover:bg-accent/30">
                      <td className="px-4 py-3 font-semibold text-sm text-primary">{inv.inventory_number}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDateTime(inv.opening_date, undefined, i18n.language)}</td>
                      <td className="px-4 py-3 text-sm text-foreground">{clients || t('common.notAvailable')}</td>
                      <td className="px-4 py-3 text-sm text-foreground">{products || t('common.notAvailable')}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{inv.opened_by || t('common.notAvailable')}</td>
                      <td className="px-4 py-3 text-center">{statusBadge(inv.status)}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => navigate(`/inventario/${inventoryRouteId(inv)}`)} className="p-1.5 rounded hover:bg-accent" title={t('inventory.page.view')}>
                            <Eye className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                          </button>
                          {canStart && (
                            <button onClick={() => handleStart(inv)} className="p-1.5 rounded hover:bg-accent" title={t('inventory.actions.start')}>
                              <Play className="w-4 h-4 text-green-500" />
                            </button>
                          )}
                          <button onClick={() => handlePDF(inv)} disabled={!isFinished || generatingPDF === inv.id}
                            className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed" title={isFinished ? t('inventory.page.downloadPdf') : t('inventory.page.pdfAfterFinish')}>
                            {generatingPDF === inv.id
                              ? <div className="w-4 h-4 border-2 border-border border-t-primary rounded-full animate-spin" />
                              : <FileText className="w-4 h-4 text-muted-foreground hover:text-foreground" />}
                          </button>
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(inv)}
                              className="p-1.5 rounded hover:bg-accent"
                              title={t('buttons.delete')}
                            >
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="shrink-0 px-4 py-3 border-t border-border flex items-center gap-6 text-xs text-muted-foreground">
          <span>{t('inventory.page.totalCount', { count: filtered.length })}</span>
          <span>{t('inventory.page.openCount', { count: inventories.filter(i => i.status === 'Aberto').length })}</span>
          <span>{t('inventory.page.inProgressCount', { count: inventories.filter(i => i.status === 'Em andamento').length })}</span>
          <span>{t('inventory.page.finishedCount', { count: inventories.filter(i => i.status === 'Finalizado').length })}</span>
        </div>
      </div>

      <InventoryWizard open={showWizard} onOpenChange={setShowWizard} onCreated={reload} inventories={inventories} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}
        title={t('inventory.page.deleteConfirm.title')}
        message={t('inventory.page.deleteConfirm.message', {
          number: deleteTarget?.inventory_number || '',
        })}
        confirmLabel={t('buttons.delete')}
        confirmColor="#DC2626"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
