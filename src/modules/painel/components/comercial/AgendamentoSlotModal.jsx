import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { formatMass } from '@transbordo/lib/format';
import { Can } from '@industrializacao/lib/rbac/Can';
import {
  ENCAIXE_HORARIO,
  formatDateBR,
  normalizeBookings,
  produtosLabel,
  summarizeSlotBookings,
} from '@painel/lib/agendamentosCarregamento';

export default function AgendamentoSlotModal({
  open,
  onClose,
  slot,
  bookings = [],
  saidas = [],
  scheduledSaidaIds = new Set(),
  permissionPrefix = 'painel_comercial_agendamentos',
  onBook,
  onRelease,
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const slotBookings = normalizeBookings(bookings);
  const summary = summarizeSlotBookings(slotBookings);
  const occupied = slotBookings.length > 0;
  const slotSaidaKey = slotBookings
    .map((b) => String(b.saida_id || ''))
    .filter(Boolean)
    .sort()
    .join(',');
  const slotSaidaIds = useMemo(
    () => new Set(slotSaidaKey ? slotSaidaKey.split(',') : []),
    [slotSaidaKey]
  );

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setError('');
    setSaving(false);
    savingRef.current = false;
    setSelectedIds(new Set(slotSaidaKey ? slotSaidaKey.split(',') : []));
  }, [open, slot?.key, slotSaidaKey]);

  const availableSaidas = useMemo(() => {
    return (saidas || []).filter((s) => {
      if (!s?.id) return false;
      if (slotSaidaIds.has(String(s.id))) return true;
      return !scheduledSaidaIds.has(String(s.id));
    });
  }, [saidas, scheduledSaidaIds, slotSaidaIds]);

  const filteredSaidas = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return availableSaidas;
    return availableSaidas.filter((s) => {
      const hay = `${s.codigo || ''} ${s.cliente_nome || ''} ${produtosLabel(s)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [availableSaidas, search]);

  if (!slot) return null;

  const horarioLabel =
    slot.horario === ENCAIXE_HORARIO
      ? t('painel.comercial.agendamentos.encaixe')
      : slot.horario;

  const toggleSaida = (saidaId) => {
    const key = String(saidaId);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleBook = async () => {
    if (savingRef.current) return;
    const selected = availableSaidas.filter((s) => selectedIds.has(String(s.id)));
    if (selected.length === 0) {
      setError(t('painel.comercial.agendamentos.errors.selectSaida'));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onBook(selected);
      onClose();
    } catch (err) {
      setError(err?.message || t('painel.comercial.agendamentos.errors.saveFailed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleRelease = async () => {
    if (savingRef.current || slotBookings.length === 0) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onRelease(slotBookings);
      onClose();
    } catch (err) {
      setError(err?.message || t('painel.comercial.agendamentos.errors.releaseFailed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {occupied
              ? t('painel.comercial.agendamentos.modal.editTitle')
              : t('painel.comercial.agendamentos.modal.title')}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('painel.comercial.agendamentos.modal.slotLabel', {
              date: formatDateBR(slot.dateIso),
              time: horarioLabel,
            })}
          </p>
        </DialogHeader>

        {occupied ? (
          <div className="rounded-lg border border-red-200 bg-red-50/70 px-3 py-2.5 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-red-700/80">
              {t('painel.comercial.agendamentos.occupied')}
              {' · '}
              {t('painel.comercial.agendamentos.saidasCount', { count: summary.count })}
            </p>
            <p className="mt-0.5 font-semibold text-red-900">{summary.codesLabel}</p>
            <p className="text-xs text-red-800/80">{summary.clientesLabel}</p>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {t('painel.comercial.agendamentos.modal.multiHint', { count: selectedIds.size })}
        </p>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('painel.comercial.agendamentos.modal.searchPlaceholder')}
            className="pl-10"
            autoFocus
          />
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          <div className="max-h-[320px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0">
                  <th className="w-10 px-3 py-2" />
                  <th className="px-3 py-2 font-medium">
                    {t('painel.comercial.agendamentos.columns.codigo')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('painel.comercial.agendamentos.columns.cliente')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('painel.comercial.agendamentos.columns.dataProgramada')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('painel.comercial.agendamentos.columns.produtos')}
                  </th>
                  <th className="px-3 py-2 font-medium text-right">
                    {t('painel.comercial.agendamentos.columns.quantidade')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredSaidas.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      {t('painel.comercial.agendamentos.modal.emptySaidas')}
                    </td>
                  </tr>
                ) : (
                  filteredSaidas.map((s) => {
                    const checked = selectedIds.has(String(s.id));
                    return (
                      <tr
                        key={s.id}
                        onClick={() => toggleSaida(s.id)}
                        className={`border-b border-border last:border-0 cursor-pointer transition-colors ${
                          checked ? 'bg-primary/5' : 'hover:bg-muted/40'
                        }`}
                      >
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSaida(s.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="accent-primary"
                            aria-label={s.codigo || s.id}
                          />
                        </td>
                        <td className="px-3 py-2.5 font-medium text-primary">{s.codigo || '—'}</td>
                        <td className="px-3 py-2.5 text-foreground">{s.cliente_nome || '—'}</td>
                        <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                          {formatDateBR(s.data_programada)}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{produtosLabel(s)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatMass(s.quantidade_total, { empty: '—' })}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {occupied ? (
              <Can
                anyOf={[
                  `${permissionPrefix}.delete`,
                  `${permissionPrefix}.view`,
                ]}
              >
                <Button
                  type="button"
                  variant="outline"
                  className="text-red-700 border-red-200 hover:bg-red-50"
                  onClick={handleRelease}
                  disabled={saving}
                >
                  {t('painel.comercial.agendamentos.modal.release')}
                </Button>
              </Can>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {t('buttons.cancel')}
            </Button>
            <Can
              anyOf={
                occupied
                  ? [`${permissionPrefix}.edit`, `${permissionPrefix}.view`]
                  : [`${permissionPrefix}.create`, `${permissionPrefix}.view`]
              }
            >
              <Button type="button" onClick={handleBook} disabled={saving || selectedIds.size === 0}>
                {saving
                  ? t('painel.comercial.agendamentos.saving')
                  : t('painel.comercial.agendamentos.modal.confirm')}
              </Button>
            </Can>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
