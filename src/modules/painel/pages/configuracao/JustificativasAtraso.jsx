import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Search, ClipboardList, Copy, Trash2 } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { RowActionButton } from '@shared/components/ui/RowActionButton';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import { useToast } from '@shared/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import ConfirmDialog from '@shared/components/ConfirmDialog';
import ConfigBackLink from '@painel/components/configuracao/ConfigBackLink';
import { toMotivoAtrasoInput, normalizeMotivoAtraso } from '@painel/lib/agendamentosCarregamento';
import {
  createJustificativaAtraso,
  deleteJustificativaAtraso,
  listJustificativasAtrasoCadastro,
  updateJustificativaAtraso,
} from '@painel/lib/justificativasAtrasoCadastro';
import justificativasSql from '@transbordo/sql/058_t_justificativas_atraso.sql?raw';

export default function JustificativasAtraso() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listJustificativasAtrasoCadastro());
    } catch (err) {
      console.error('[JustificativasAtraso] load:', err);
      toast({
        title: t('painel.configuracao.justificativasAtraso.loadError'),
        description: err?.message,
        variant: 'destructive',
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(justificativasSql);
      toast({ title: t('painel.configuracao.justificativasAtraso.sqlCopied') });
    } catch {
      toast({
        title: t('painel.configuracao.justificativasAtraso.sqlCopyError'),
        variant: 'destructive',
      });
    }
  };

  const virtualMode = rows.some((r) => r._virtual);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.motivo || '').toLowerCase().includes(q));
  }, [rows, search]);

  const openNew = () => {
    setEditing(null);
    setMotivo('');
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setMotivo(row.motivo || '');
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e?.preventDefault?.();
    const trimmed = normalizeMotivoAtraso(motivo);
    if (!trimmed) {
      toast({
        title: t('painel.configuracao.justificativasAtraso.nameRequired'),
        variant: 'destructive',
      });
      return;
    }
    const duplicate = rows.find(
      (r) =>
        r.id !== editing?.id &&
        normalizeMotivoAtraso(r.motivo) === trimmed
    );
    if (duplicate) {
      toast({
        title: t('painel.configuracao.justificativasAtraso.duplicateName'),
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updateJustificativaAtraso(editing.id, { motivo: trimmed });
        toast({ title: t('painel.configuracao.justificativasAtraso.updated') });
      } else {
        await createJustificativaAtraso(trimmed);
        toast({ title: t('painel.configuracao.justificativasAtraso.created') });
      }
      setModalOpen(false);
      setEditing(null);
      await loadData();
    } catch (err) {
      toast({
        title: editing
          ? t('painel.configuracao.justificativasAtraso.updateError')
          : t('painel.configuracao.justificativasAtraso.createError'),
        description: err?.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteJustificativaAtraso(deleteTarget.id);
      toast({ title: t('painel.configuracao.justificativasAtraso.deleted') });
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      toast({
        title: t('painel.configuracao.justificativasAtraso.deleteError'),
        description: err?.message,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 space-y-2">
        <ConfigBackLink />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {t('painel.configuracao.justificativasAtraso.title')}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('painel.configuracao.justificativasAtraso.subtitle')}
            </p>
          </div>
          <Button onClick={openNew} className="bg-primary hover:bg-primary/90 gap-2">
            <Plus className="w-4 h-4" />
            {t('painel.configuracao.justificativasAtraso.add')}
          </Button>
        </div>
      </div>

      {virtualMode && (
        <div className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="flex-1">
            {t('painel.configuracao.justificativasAtraso.tableMissingBanner')}
          </p>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 bg-white gap-2"
            onClick={handleCopySql}
          >
            <Copy className="w-4 h-4" />
            {t('painel.configuracao.justificativasAtraso.copySql')}
          </Button>
        </div>
      )}

      <div className="relative max-w-md shrink-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('painel.configuracao.justificativasAtraso.search')}
          className="pl-10 bg-card"
        />
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-4 py-3 font-medium">
                  {t('painel.configuracao.justificativasAtraso.columns.name')}
                </th>
                <th className="px-4 py-3 font-medium text-right">
                  {t('painel.configuracao.justificativasAtraso.columns.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={2} className="px-4 py-10 text-center text-muted-foreground">
                    {t('painel.configuracao.justificativasAtraso.loading')}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <ClipboardList className="w-8 h-8 opacity-50" />
                      <p>{t('painel.configuracao.justificativasAtraso.empty')}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((row, i) => (
                  <tr
                    key={row.id}
                    className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                      i % 2 === 1 ? 'bg-muted/20' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-foreground uppercase">
                      {row.motivo}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <RowActionButton
                          onClick={() => openEdit(row)}
                          title={t('painel.configuracao.justificativasAtraso.edit')}
                        >
                          <Pencil />
                        </RowActionButton>
                        <RowActionButton
                          tone="danger"
                          onClick={() => setDeleteTarget(row)}
                          title={t('painel.configuracao.justificativasAtraso.remove')}
                          disabled={row._virtual}
                        >
                          <Trash2 />
                        </RowActionButton>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm shrink-0">
          <span className="text-muted-foreground">
            {t('painel.configuracao.justificativasAtraso.total', { count: rows.length })}
          </span>
          <span className="text-muted-foreground">
            {t('painel.configuracao.justificativasAtraso.showing', {
              count: filtered.length,
            })}
          </span>
        </div>
      </div>

      <Dialog
        open={modalOpen}
        onOpenChange={(v) => {
          if (!saving) setModalOpen(v);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t('painel.configuracao.justificativasAtraso.editTitle')
                : t('painel.configuracao.justificativasAtraso.addTitle')}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('painel.configuracao.justificativasAtraso.nameLabel')}</Label>
              <Input
                value={motivo}
                onChange={(e) => setMotivo(toMotivoAtrasoInput(e.target.value))}
                placeholder={t('painel.configuracao.justificativasAtraso.namePlaceholder')}
                className="uppercase placeholder:normal-case"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setModalOpen(false)}
                disabled={saving}
              >
                {t('buttons.cancel')}
              </Button>
              <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={saving}>
                {saving
                  ? t('common.saving')
                  : editing
                    ? t('buttons.save')
                    : t('painel.configuracao.justificativasAtraso.add')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
        title={t('painel.configuracao.justificativasAtraso.removeTitle')}
        message={t('painel.configuracao.justificativasAtraso.removeMessage', {
          name: deleteTarget?.motivo,
        })}
        confirmLabel={t('painel.configuracao.justificativasAtraso.remove')}
        onConfirm={handleDelete}
      />
    </div>
  );
}
