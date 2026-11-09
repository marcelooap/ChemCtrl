import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Search, MapPin, Copy, Trash2 } from 'lucide-react';
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
import {
  createDestino,
  deleteDestino,
  listDestinosCadastro,
  renameDestinoComHistorico,
} from '@transbordo/lib/saidaDestinos';
import destinosSql from '@transbordo/sql/057_t_saida_destinos.sql?raw';

export default function DestinoCarregamentos() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [nome, setNome] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listDestinosCadastro());
    } catch (err) {
      console.error('[DestinoCarregamentos] load:', err);
      toast({
        title: t('painel.configuracao.destinos.loadError'),
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
      await navigator.clipboard.writeText(destinosSql);
      toast({ title: t('painel.configuracao.destinos.sqlCopied') });
    } catch {
      toast({
        title: t('painel.configuracao.destinos.sqlCopyError'),
        variant: 'destructive',
      });
    }
  };

  const virtualMode = rows.some((r) => r._virtual);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.nome || '').toLowerCase().includes(q));
  }, [rows, search]);

  const openNew = () => {
    setEditing(null);
    setNome('');
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setNome(row.nome || '');
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e?.preventDefault?.();
    const trimmed = nome.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      toast({
        title: t('painel.configuracao.destinos.nameRequired'),
        variant: 'destructive',
      });
      return;
    }
    const duplicate = rows.find(
      (r) =>
        r.id !== editing?.id &&
        String(r.nome || '').trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      toast({
        title: t('painel.configuracao.destinos.duplicateName'),
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await renameDestinoComHistorico(editing, trimmed);
        toast({ title: t('painel.configuracao.destinos.updated') });
      } else {
        await createDestino(trimmed);
        toast({ title: t('painel.configuracao.destinos.created') });
      }
      setModalOpen(false);
      setEditing(null);
      await loadData();
    } catch (err) {
      toast({
        title: editing
          ? t('painel.configuracao.destinos.updateError')
          : t('painel.configuracao.destinos.createError'),
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
      await deleteDestino(deleteTarget.id);
      toast({ title: t('painel.configuracao.destinos.deleted') });
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      toast({
        title: t('painel.configuracao.destinos.deleteError'),
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
              {t('painel.configuracao.destinos.title')}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('painel.configuracao.destinos.subtitle')}
            </p>
          </div>
          <Button onClick={openNew} className="bg-primary hover:bg-primary/90 gap-2">
            <Plus className="w-4 h-4" />
            {t('painel.configuracao.destinos.add')}
          </Button>
        </div>
      </div>

      {virtualMode && (
        <div className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="flex-1">{t('painel.configuracao.destinos.tableMissingBanner')}</p>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 bg-white gap-2"
            onClick={handleCopySql}
          >
            <Copy className="w-4 h-4" />
            {t('painel.configuracao.destinos.copySql')}
          </Button>
        </div>
      )}

      <div className="relative max-w-md shrink-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('painel.configuracao.destinos.search')}
          className="pl-10 bg-card"
        />
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-4 py-3 font-medium">
                  {t('painel.configuracao.destinos.columns.name')}
                </th>
                <th className="px-4 py-3 font-medium text-right">
                  {t('painel.configuracao.destinos.columns.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={2} className="px-4 py-10 text-center text-muted-foreground">
                    {t('painel.configuracao.destinos.loading')}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <MapPin className="w-8 h-8 opacity-50" />
                      <p>{t('painel.configuracao.destinos.empty')}</p>
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
                    <td className="px-4 py-3 font-medium text-foreground">{row.nome}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <RowActionButton
                          onClick={() => openEdit(row)}
                          title={t('painel.configuracao.destinos.edit')}
                        >
                          <Pencil />
                        </RowActionButton>
                        <RowActionButton
                          tone="danger"
                          onClick={() => setDeleteTarget(row)}
                          title={t('painel.configuracao.destinos.remove')}
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
            {t('painel.configuracao.destinos.total', { count: rows.length })}
          </span>
          <span className="text-muted-foreground">
            {t('painel.configuracao.destinos.showing', { count: filtered.length })}
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
                ? t('painel.configuracao.destinos.editTitle')
                : t('painel.configuracao.destinos.addTitle')}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('painel.configuracao.destinos.nameLabel')}</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder={t('painel.configuracao.destinos.namePlaceholder')}
                autoFocus
              />
              {editing && (
                <p className="text-xs text-muted-foreground">
                  {t('painel.configuracao.destinos.renameHint')}
                </p>
              )}
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
                    : t('painel.configuracao.destinos.add')}
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
        title={t('painel.configuracao.destinos.removeTitle')}
        message={t('painel.configuracao.destinos.removeMessage', {
          name: deleteTarget?.nome,
        })}
        confirmLabel={t('painel.configuracao.destinos.remove')}
        onConfirm={handleDelete}
      />
    </div>
  );
}
