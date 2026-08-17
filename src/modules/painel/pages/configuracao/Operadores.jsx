import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Power, Search, HardHat, Copy } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
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
import {
  createOperador,
  listOperadoresCadastro,
  renameOperadorComHistorico,
  setOperadorAtivo,
} from '@transbordo/lib/operadoresCadastro';
import operadoresSql from '@transbordo/sql/025_t_operadores.sql?raw';

export default function Operadores() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [nome, setNome] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggleTarget, setToggleTarget] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listOperadoresCadastro());
    } catch (err) {
      console.error('[Operadores] load:', err);
      toast({
        title: t('painel.configuracao.operadores.loadError'),
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
      await navigator.clipboard.writeText(operadoresSql);
      toast({ title: t('painel.configuracao.operadores.sqlCopied') });
    } catch {
      toast({
        title: t('painel.configuracao.operadores.sqlCopyError'),
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
    const trimmed = nome.trim();
    if (!trimmed) {
      toast({
        title: t('painel.configuracao.operadores.nameRequired'),
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
        title: t('painel.configuracao.operadores.duplicateName'),
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await renameOperadorComHistorico(editing, trimmed);
        toast({ title: t('painel.configuracao.operadores.updated') });
      } else {
        await createOperador(trimmed);
        toast({ title: t('painel.configuracao.operadores.created') });
      }
      setModalOpen(false);
      setEditing(null);
      await loadData();
    } catch (err) {
      toast({
        title: editing
          ? t('painel.configuracao.operadores.updateError')
          : t('painel.configuracao.operadores.createError'),
        description: err?.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    if (!toggleTarget) return;
    const nextAtivo = toggleTarget.ativo === false;
    await setOperadorAtivo(toggleTarget.id, nextAtivo);
    toast({
      title: nextAtivo
        ? t('painel.configuracao.operadores.activated')
        : t('painel.configuracao.operadores.inactivated'),
    });
    setToggleTarget(null);
    await loadData();
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t('painel.configuracao.operadores.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('painel.configuracao.operadores.subtitle')}
          </p>
        </div>
        <Button onClick={openNew} className="bg-primary hover:bg-primary/90 gap-2">
          <Plus className="w-4 h-4" />
          {t('painel.configuracao.operadores.add')}
        </Button>
      </div>

      {virtualMode && (
        <div className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="flex-1">{t('painel.configuracao.operadores.tableMissingBanner')}</p>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 bg-white gap-2"
            onClick={handleCopySql}
          >
            <Copy className="w-4 h-4" />
            {t('painel.configuracao.operadores.copySql')}
          </Button>
        </div>
      )}

      <div className="relative max-w-md shrink-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('painel.configuracao.operadores.search')}
          className="pl-10 bg-card"
        />
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-4 py-3 font-medium">
                  {t('painel.configuracao.operadores.columns.name')}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t('painel.configuracao.operadores.columns.status')}
                </th>
                <th className="px-4 py-3 font-medium text-right">
                  {t('painel.configuracao.operadores.columns.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                    {t('painel.configuracao.operadores.loading')}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <HardHat className="w-8 h-8 opacity-50" />
                      <p>{t('painel.configuracao.operadores.empty')}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((row, i) => {
                  const ativo = row.ativo !== false;
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                        i % 2 === 1 ? 'bg-muted/20' : ''
                      } ${ativo ? '' : 'opacity-60'}`}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{row.nome}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                            ativo
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {ativo
                            ? t('painel.configuracao.operadores.statusActive')
                            : t('painel.configuracao.operadores.statusInactive')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title={t('painel.configuracao.operadores.edit')}
                            aria-label={t('painel.configuracao.operadores.edit')}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setToggleTarget(row)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title={
                              ativo
                                ? t('painel.configuracao.operadores.inactivate')
                                : t('painel.configuracao.operadores.activate')
                            }
                            aria-label={
                              ativo
                                ? t('painel.configuracao.operadores.inactivate')
                                : t('painel.configuracao.operadores.activate')
                            }
                          >
                            <Power className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm shrink-0">
          <span className="text-muted-foreground">
            {t('painel.configuracao.operadores.total', { count: rows.length })}
          </span>
          <span className="text-muted-foreground">
            {t('painel.configuracao.operadores.showing', { count: filtered.length })}
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
                ? t('painel.configuracao.operadores.editTitle')
                : t('painel.configuracao.operadores.addTitle')}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('painel.configuracao.operadores.nameLabel')}</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder={t('painel.configuracao.operadores.namePlaceholder')}
                autoFocus
              />
              {editing && (
                <p className="text-xs text-muted-foreground">
                  {t('painel.configuracao.operadores.renameHint')}
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
                    : t('painel.configuracao.operadores.add')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toggleTarget}
        onOpenChange={(v) => {
          if (!v) setToggleTarget(null);
        }}
        title={
          toggleTarget?.ativo === false
            ? t('painel.configuracao.operadores.activateTitle')
            : t('painel.configuracao.operadores.inactivateTitle')
        }
        message={
          toggleTarget?.ativo === false
            ? t('painel.configuracao.operadores.activateMessage', {
                name: toggleTarget?.nome,
              })
            : t('painel.configuracao.operadores.inactivateMessage', {
                name: toggleTarget?.nome,
              })
        }
        confirmLabel={
          toggleTarget?.ativo === false
            ? t('painel.configuracao.operadores.activate')
            : t('painel.configuracao.operadores.inactivate')
        }
        onConfirm={handleToggle}
      />
    </div>
  );
}
