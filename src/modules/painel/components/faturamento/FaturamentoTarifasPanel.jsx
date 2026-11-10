import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Pencil, Save, Trash2, X } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import DateInputBr from '@shared/components/ui/DateInputBr';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/components/ui/alert-dialog';
import { Can } from '@industrializacao/lib/rbac/Can';
import {
  formatTarifaRate,
  parseRateInput,
  rateInputValue,
  todayISO,
} from '@painel/lib/faturamentoTarifas';

/**
 * Painel de tarifas vigentes + histórico (editar/excluir só para admin autorizado).
 */
export default function FaturamentoTarifasPanel({
  tarifas = [],
  vigente,
  saving = false,
  canManageHistory = false,
  onSave,
  onDelete,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [mov, setMov] = useState('');
  const [tenda, setTenda] = useState('');
  const [patio, setPatio] = useState('');
  const [vigencia, setVigencia] = useState(todayISO());
  const [editingId, setEditingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    if (editingId) return;
    if (!vigente) return;
    setMov(rateInputValue(vigente.movimentacao_palete));
    setTenda(rateInputValue(vigente.armazenagem_tenda));
    setPatio(rateInputValue(vigente.armazenagem_patio));
  }, [vigente, editingId]);

  const resetFormFromVigente = () => {
    setEditingId(null);
    setVigencia(todayISO());
    if (!vigente) {
      setMov('');
      setTenda('');
      setPatio('');
      return;
    }
    setMov(rateInputValue(vigente.movimentacao_palete));
    setTenda(rateInputValue(vigente.armazenagem_tenda));
    setPatio(rateInputValue(vigente.armazenagem_patio));
  };

  const handleEdit = (row) => {
    if (!row) return;
    setOpen(true);
    setEditingId(row.id || null);
    setVigencia(row.vigencia_inicio || todayISO());
    setMov(rateInputValue(row.movimentacao_palete));
    setTenda(rateInputValue(row.armazenagem_tenda));
    setPatio(rateInputValue(row.armazenagem_patio));
  };

  const handleSave = async () => {
    const ok = await onSave?.({
      id: editingId || undefined,
      vigencia_inicio: vigencia || todayISO(),
      movimentacao_palete: parseRateInput(mov),
      armazenagem_tenda: parseRateInput(tenda),
      armazenagem_patio: parseRateInput(patio),
    });
    if (ok !== false) {
      setEditingId(null);
      setVigencia(todayISO());
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget?.id) return;
    const target = deleteTarget;
    const ok = await onDelete?.(target);
    if (ok === false) return;
    setDeleteTarget(null);
    if (editingId && target.id === editingId) {
      resetFormFromVigente();
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {t('painel.faturamento.tarifas.title')}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {vigente?.vigencia_inicio
              ? t('painel.faturamento.tarifas.current', {
                  date: formatDateBR(vigente.vigencia_inicio),
                })
              : t('painel.faturamento.tarifas.subtitle')}
            {vigente
              ? ` · ${formatTarifaRate(vigente.movimentacao_palete)} / ${formatTarifaRate(vigente.armazenagem_tenda)} / ${formatTarifaRate(vigente.armazenagem_patio)}`
              : ''}
          </p>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {open ? (
        <div className="border-t border-border px-5 py-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            {editingId
              ? t('painel.faturamento.tarifas.editingHint')
              : t('painel.faturamento.tarifas.subtitle')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.faturamento.tarifas.movimentacao')}
              </Label>
              <Input value={mov} onChange={(e) => setMov(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.faturamento.tarifas.tenda')}
              </Label>
              <Input value={tenda} onChange={(e) => setTenda(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.faturamento.tarifas.patio')}
              </Label>
              <Input value={patio} onChange={(e) => setPatio(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.faturamento.tarifas.vigencia')}
              </Label>
              <DateInputBr value={vigencia} onChange={setVigencia} />
            </div>
          </div>

          <Can permission="painel_faturamento.edit">
            <div className="flex justify-end gap-2">
              {editingId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetFormFromVigente}
                  disabled={saving}
                  className="gap-2"
                >
                  <X className="h-4 w-4" />
                  {t('painel.faturamento.tarifas.cancelEdit')}
                </Button>
              ) : null}
              <Button type="button" onClick={handleSave} disabled={saving} className="gap-2">
                <Save className="h-4 w-4" />
                {saving
                  ? t('painel.faturamento.tarifas.saving')
                  : editingId
                    ? t('painel.faturamento.tarifas.update')
                    : t('painel.faturamento.tarifas.save')}
              </Button>
            </div>
          </Can>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">
              {t('painel.faturamento.tarifas.history')}
            </p>
            {tarifas.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('painel.faturamento.tarifas.emptyHistory')}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">
                        {t('painel.faturamento.tarifas.vigencia')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('painel.faturamento.tarifas.movimentacao')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('painel.faturamento.tarifas.tenda')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('painel.faturamento.tarifas.patio')}
                      </th>
                      {canManageHistory ? (
                        <th className="px-3 py-2 text-right font-medium w-[1%] whitespace-nowrap">
                          {t('painel.faturamento.tarifas.actions')}
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {tarifas.map((row) => (
                      <tr
                        key={row.id || row.vigencia_inicio}
                        className={`border-t border-border ${
                          editingId && row.id === editingId ? 'bg-primary/5' : ''
                        }`}
                      >
                        <td className="px-3 py-2">{formatDateBR(row.vigencia_inicio)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatTarifaRate(row.movimentacao_palete)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatTarifaRate(row.armazenagem_tenda)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatTarifaRate(row.armazenagem_patio)}
                        </td>
                        {canManageHistory ? (
                          <td className="px-2 py-1.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title={t('painel.faturamento.tarifas.edit')}
                                onClick={() => handleEdit(row)}
                                disabled={saving}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                title={t('painel.faturamento.tarifas.delete')}
                                onClick={() => setDeleteTarget(row)}
                                disabled={saving || tarifas.length <= 1}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('painel.faturamento.tarifas.deleteTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('painel.faturamento.tarifas.deleteDescription', {
                date: formatDateBR(deleteTarget?.vigencia_inicio),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>
              {t('painel.faturamento.tarifas.cancelEdit')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('painel.faturamento.tarifas.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatDateBR(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
