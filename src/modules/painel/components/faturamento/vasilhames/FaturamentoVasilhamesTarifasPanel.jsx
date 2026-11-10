import { useEffect, useMemo, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Can } from '@industrializacao/lib/rbac/Can';
import {
  CAPACIDADES_NOMINAIS_PADRAO,
  formatTarifaRate,
  getTarifasVigentesPorCapacidade,
  parseRateInput,
  rateInputValue,
  todayISO,
} from '@painel/lib/faturamentoTarifasVasilhames';

function formatDateBR(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function formatCapacidade(litros) {
  const n = Number(litros);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('pt-BR')} L`;
}

export default function FaturamentoVasilhamesTarifasPanel({
  tarifas = [],
  saving = false,
  canManageHistory = false,
  onSave,
  onDelete,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [capacidade, setCapacidade] = useState(String(CAPACIDADES_NOMINAIS_PADRAO[0]));
  const [tarifa, setTarifa] = useState('');
  const [vigencia, setVigencia] = useState(todayISO());
  const [vigenciaFim, setVigenciaFim] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const vigentes = useMemo(
    () => getTarifasVigentesPorCapacidade(tarifas),
    [tarifas]
  );

  const vigenteSummary = useMemo(() => {
    const parts = CAPACIDADES_NOMINAIS_PADRAO.map((cap) => {
      const row = vigentes.get(cap);
      if (!row) return null;
      return `${formatCapacidade(cap)} ${formatTarifaRate(row.tarifa_diaria)}`;
    }).filter(Boolean);
    return parts.join(' · ');
  }, [vigentes]);

  useEffect(() => {
    if (editingId) return;
    const row = vigentes.get(Number(capacidade));
    setTarifa(row ? rateInputValue(row.tarifa_diaria) : '');
  }, [vigentes, capacidade, editingId]);

  const resetForm = () => {
    setEditingId(null);
    setVigencia(todayISO());
    setVigenciaFim('');
    setCapacidade(String(CAPACIDADES_NOMINAIS_PADRAO[0]));
    const row = vigentes.get(CAPACIDADES_NOMINAIS_PADRAO[0]);
    setTarifa(row ? rateInputValue(row.tarifa_diaria) : '');
  };

  const handleEdit = (row) => {
    if (!row) return;
    setOpen(true);
    setEditingId(row.id || null);
    setCapacidade(String(row.capacidade_litros));
    setVigencia(row.vigencia_inicio || todayISO());
    setVigenciaFim(row.vigencia_fim || '');
    setTarifa(rateInputValue(row.tarifa_diaria));
  };

  const handleSave = async () => {
    const ok = await onSave?.({
      id: editingId || undefined,
      capacidade_litros: Number(capacidade),
      tarifa_diaria: parseRateInput(tarifa),
      vigencia_inicio: vigencia || todayISO(),
      vigencia_fim: vigenciaFim || null,
    });
    if (ok !== false) resetForm();
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget?.id) return;
    const target = deleteTarget;
    const ok = await onDelete?.(target);
    if (ok === false) return;
    setDeleteTarget(null);
    if (editingId && target.id === editingId) resetForm();
  };

  const capacidadeOptions = useMemo(() => {
    const set = new Set(CAPACIDADES_NOMINAIS_PADRAO.map(Number));
    for (const row of tarifas || []) {
      const n = Number(row.capacidade_litros);
      if (Number.isFinite(n) && n > 0) set.add(n);
    }
    return [...set].sort((a, b) => a - b);
  }, [tarifas]);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {t('painel.faturamentoVasilhames.tarifas.title')}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {vigenteSummary
              ? t('painel.faturamentoVasilhames.tarifas.currentSummary', {
                  summary: vigenteSummary,
                })
              : t('painel.faturamentoVasilhames.tarifas.subtitle')}
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
              ? t('painel.faturamentoVasilhames.tarifas.editingHint')
              : t('painel.faturamentoVasilhames.tarifas.subtitle')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.faturamentoVasilhames.tarifas.capacidade')}
              </Label>
              <Select
                value={capacidade}
                onValueChange={setCapacidade}
                disabled={Boolean(editingId)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {capacidadeOptions.map((cap) => (
                    <SelectItem key={cap} value={String(cap)}>
                      {formatCapacidade(cap)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.faturamentoVasilhames.tarifas.tarifaDiaria')}
              </Label>
              <Input
                value={tarifa}
                onChange={(e) => setTarifa(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.faturamentoVasilhames.tarifas.vigenciaInicio')}
              </Label>
              <DateInputBr value={vigencia} onChange={setVigencia} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.faturamentoVasilhames.tarifas.vigenciaFim')}
              </Label>
              <DateInputBr value={vigenciaFim} onChange={setVigenciaFim} />
            </div>
          </div>

          <Can permission="painel_faturamento.edit">
            <div className="flex justify-end gap-2">
              {editingId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetForm}
                  disabled={saving}
                  className="gap-2"
                >
                  <X className="h-4 w-4" />
                  {t('painel.faturamentoVasilhames.tarifas.cancelEdit')}
                </Button>
              ) : null}
              <Button type="button" onClick={handleSave} disabled={saving} className="gap-2">
                <Save className="h-4 w-4" />
                {saving
                  ? t('painel.faturamentoVasilhames.tarifas.saving')
                  : editingId
                    ? t('painel.faturamentoVasilhames.tarifas.update')
                    : t('painel.faturamentoVasilhames.tarifas.save')}
              </Button>
            </div>
          </Can>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">
              {t('painel.faturamentoVasilhames.tarifas.history')}
            </p>
            {tarifas.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('painel.faturamentoVasilhames.tarifas.emptyHistory')}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">
                        {t('painel.faturamentoVasilhames.tarifas.capacidade')}
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        {t('painel.faturamentoVasilhames.tarifas.vigenciaInicio')}
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        {t('painel.faturamentoVasilhames.tarifas.vigenciaFim')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('painel.faturamentoVasilhames.tarifas.tarifaDiaria')}
                      </th>
                      {canManageHistory ? (
                        <th className="px-3 py-2 text-right font-medium w-[1%] whitespace-nowrap">
                          {t('painel.faturamentoVasilhames.tarifas.actions')}
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {tarifas.map((row) => (
                      <tr
                        key={row.id || `${row.capacidade_litros}-${row.vigencia_inicio}`}
                        className={`border-t border-border ${
                          editingId && row.id === editingId ? 'bg-primary/5' : ''
                        }`}
                      >
                        <td className="px-3 py-2">{formatCapacidade(row.capacidade_litros)}</td>
                        <td className="px-3 py-2">{formatDateBR(row.vigencia_inicio)}</td>
                        <td className="px-3 py-2">
                          {row.vigencia_fim ? formatDateBR(row.vigencia_fim) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatTarifaRate(row.tarifa_diaria)}
                        </td>
                        {canManageHistory ? (
                          <td className="px-2 py-1.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title={t('painel.faturamentoVasilhames.tarifas.edit')}
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
                                title={t('painel.faturamentoVasilhames.tarifas.delete')}
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
              {t('painel.faturamentoVasilhames.tarifas.deleteTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('painel.faturamentoVasilhames.tarifas.deleteDescription', {
                capacidade: formatCapacidade(deleteTarget?.capacidade_litros),
                date: formatDateBR(deleteTarget?.vigencia_inicio),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>
              {t('painel.faturamentoVasilhames.tarifas.cancelEdit')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('painel.faturamentoVasilhames.tarifas.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
