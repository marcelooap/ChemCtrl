import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Plus, X } from 'lucide-react';
import ConfirmDialog from '@shared/components/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import NumberInputBr from '@transbordo/components/NumberInputBr';
import { brasiliaDateTime } from '@industrializacao/lib/brasilTime';
import { formatQty, listReservasForChave } from '@painel/lib/materialReservas';

export default function ReservaEditModal({
  open,
  onClose,
  onCreate,
  onUpdate,
  row,
  reservas = [],
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('list');
  const [editingId, setEditingId] = useState(null);
  const [quantidade, setQuantidade] = useState('');
  const [solicitante, setSolicitante] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setMode('list');
    setEditingId(null);
    setQuantidade('');
    setSolicitante('');
    setError('');
    setPendingDelete(null);
    savingRef.current = false;
    setSaving(false);
  }, [open, row?.chave]);

  const ativas = useMemo(() => {
    if (!row?.chave) return [];
    return listReservasForChave(reservas, row.chave).filter((r) => r.status === 'ativa');
  }, [reservas, row?.chave]);

  const editing = ativas.find((r) => r.id === editingId) || null;

  if (!row) return null;

  const saldoAtual = Math.round(Number(row.saldoAtual) || 0);
  const bloqueio = Math.round(Number(row.bloqueioPendente) || 0);
  const reservado = ativas.reduce((sum, r) => sum + (Number(r.quantidade) || 0), 0);
  const disponivel = Math.max(0, saldoAtual - reservado - bloqueio);
  const editingQty = Math.round(Number(editing?.quantidade) || 0);
  const maxEdit = Math.max(0, saldoAtual - (reservado - editingQty) - bloqueio);
  const qtd = Math.round(Number(quantidade) || 0);

  const title =
    mode === 'create'
      ? t('painel.comercial.reservarMaterial.newReservationTitle')
      : mode === 'edit'
        ? t('painel.comercial.reservarMaterial.editReservationTitle')
        : t('painel.comercial.reservarMaterial.manageTitle');

  const openCreate = () => {
    setSolicitante('');
    setQuantidade('');
    setEditingId(null);
    setError('');
    setMode('create');
  };

  const openEdit = (reserva) => {
    setEditingId(reserva.id);
    setSolicitante(reserva.solicitante || '');
    setQuantidade(Math.round(Number(reserva.quantidade) || 0));
    setError('');
    setMode('edit');
  };

  const backToList = () => {
    if (saving) return;
    setMode('list');
    setEditingId(null);
    setError('');
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;
    if (!solicitante.trim()) {
      setError(t('painel.comercial.reservarMaterial.errors.requesterRequired'));
      return;
    }
    if (qtd <= 0) {
      setError(t('painel.comercial.reservarMaterial.errors.qtyRequired'));
      return;
    }
    if (qtd > disponivel) {
      setError(
        t('painel.comercial.reservarMaterial.errors.exceedsBalance', {
          max: formatQty(disponivel, row.unidade),
          unidade: row.unidade,
        })
      );
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onCreate({ quantidade: qtd, solicitante: solicitante.trim() });
      setMode('list');
      setSolicitante('');
      setQuantidade('');
    } catch (err) {
      setError(err?.message || t('painel.comercial.reservarMaterial.errors.saveFailed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (savingRef.current || !editing) return;
    if (qtd < 0) {
      setError(t('painel.comercial.reservarMaterial.errors.negative'));
      return;
    }
    if (!solicitante.trim()) {
      setError(t('painel.comercial.reservarMaterial.errors.requesterRequired'));
      return;
    }
    const sameRequester = solicitante.trim() === String(editing.solicitante || '').trim();
    if (qtd === editingQty && sameRequester) {
      backToList();
      return;
    }
    if (qtd > maxEdit) {
      setError(
        t('painel.comercial.reservarMaterial.errors.exceedsBalance', {
          max: formatQty(maxEdit, row.unidade),
          unidade: row.unidade,
        })
      );
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onUpdate({
        reservaId: editing.id,
        quantidade: qtd,
        solicitante: solicitante.trim(),
      });
      setMode('list');
      setEditingId(null);
    } catch (err) {
      setError(err?.message || t('painel.comercial.reservarMaterial.errors.saveFailed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    await onUpdate({
      reservaId: pendingDelete.id,
      quantidade: 0,
      solicitante: pendingDelete.solicitante || '',
    });
  };

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && (saving || pendingDelete)) return;
        if (!v) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
        onPointerDownOutside={(e) => pendingDelete && e.preventDefault()}
        onInteractOutside={(e) => pendingDelete && e.preventDefault()}
        onFocusOutside={(e) => pendingDelete && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <ProductSummary row={row} />

          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat
              label={t('painel.comercial.reservarMaterial.columns.saldoAtual')}
              value={`${formatQty(saldoAtual, row.unidade)} ${row.unidade}`}
            />
            <Stat
              label={t('painel.comercial.reservarMaterial.columns.saldoReservado')}
              value={`${formatQty(reservado, row.unidade)} ${row.unidade}`}
            />
            <Stat
              label={t('painel.comercial.reservarMaterial.availableShort')}
              value={`${formatQty(disponivel, row.unidade)} ${row.unidade}`}
            />
          </div>

          {bloqueio > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('painel.comercial.reservarMaterial.pendingExitBlock', {
                qty: `${formatQty(bloqueio, row.unidade)} ${row.unidade}`,
              })}
            </p>
          ) : null}

          {mode === 'list' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {t('painel.comercial.reservarMaterial.activeReservations')}
                </h3>
                <Button type="button" size="sm" onClick={openCreate} disabled={disponivel <= 0}>
                  <Plus className="w-4 h-4" />
                  {t('painel.comercial.reservarMaterial.newReservation')}
                </Button>
              </div>

              {ativas.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  {t('painel.comercial.reservarMaterial.noActiveReservations')}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ativas.map((reserva) => (
                    <div key={reserva.id} className="relative">
                      <button
                        type="button"
                        onClick={() => openEdit(reserva)}
                        className="w-full rounded-lg border border-border bg-card p-3 pr-8 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={t('painel.comercial.reservarMaterial.cardEdit', {
                          name: reserva.solicitante || '—',
                        })}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs text-muted-foreground">
                              {t('painel.comercial.reservarMaterial.requester')}
                            </div>
                            <div className="font-medium text-foreground truncate">
                              {reserva.solicitante || '—'}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {brasiliaDateTime(reserva.created_at)}
                            </div>
                            <div className="text-xs font-medium text-primary mt-2">
                              {t('buttons.edit')}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs text-muted-foreground">
                              {t('painel.comercial.reservarMaterial.reservedQty')}
                            </div>
                            <div className="text-base font-semibold tabular-nums text-foreground">
                              {formatQty(reserva.quantidade, row.unidade)}
                              <span className="ml-1 text-xs font-medium text-muted-foreground">
                                {row.unidade}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="absolute right-1.5 bottom-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-red-500 transition-colors hover:bg-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:ring-offset-1"
                        aria-label={t('painel.comercial.reservarMaterial.deleteReservation', {
                          name: reserva.solicitante || '—',
                        })}
                        onClick={() => setPendingDelete(reserva)}
                      >
                        <X className="h-2.5 w-2.5" strokeWidth={2.5} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>
                  {t('buttons.close')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {mode === 'create' ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reserva-solicitante">
                  {t('painel.comercial.reservarMaterial.requester')}
                  <span className="text-destructive"> *</span>
                </Label>
                <Input
                  id="reserva-solicitante"
                  value={solicitante}
                  onChange={(e) => setSolicitante(e.target.value)}
                  maxLength={120}
                  autoComplete="off"
                  placeholder={t('painel.comercial.reservarMaterial.requesterPlaceholder')}
                  aria-required
                />
              </div>
              <QuantityField
                id="reserva-qtd-nova"
                unidade={row.unidade}
                value={quantidade}
                onChange={setQuantidade}
                max={disponivel}
                hint={t('painel.comercial.reservarMaterial.availableToReserve', {
                  value: formatQty(disponivel, row.unidade),
                  unidade: row.unidade,
                })}
              />
              {error ? <ErrorBanner message={error} /> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={backToList} disabled={saving}>
                  {t('buttons.back')}
                </Button>
                <Button type="submit" disabled={saving || disponivel <= 0}>
                  {saving
                    ? t('painel.comercial.reservarMaterial.saving')
                    : t('buttons.save')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {mode === 'edit' && editing ? (
            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reserva-solicitante-edit">
                  {t('painel.comercial.reservarMaterial.requester')}
                  <span className="text-destructive"> *</span>
                </Label>
                <Input
                  id="reserva-solicitante-edit"
                  value={solicitante}
                  onChange={(e) => setSolicitante(e.target.value)}
                  maxLength={120}
                  autoComplete="off"
                  placeholder={t('painel.comercial.reservarMaterial.requesterPlaceholder')}
                  aria-required
                />
              </div>
              <QuantityField
                id="reserva-qtd-edit"
                unidade={row.unidade}
                value={quantidade}
                onChange={setQuantidade}
                max={maxEdit}
                hint={t('painel.comercial.reservarMaterial.editQtyHint')}
              />
              {error ? <ErrorBanner message={error} /> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={backToList} disabled={saving}>
                  {t('buttons.back')}
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving
                    ? t('painel.comercial.reservarMaterial.saving')
                    : t('buttons.save')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {mode === 'edit' && !editing ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t('painel.comercial.reservarMaterial.errors.notFound')}
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={backToList}>
                  {t('buttons.back')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog
      open={!!pendingDelete}
      onOpenChange={(next) => {
        if (!next) setPendingDelete(null);
      }}
      title={t('painel.comercial.reservarMaterial.deleteTitle')}
      message={t('painel.comercial.reservarMaterial.deleteMessage', {
        name: pendingDelete?.solicitante || '—',
        qty: formatQty(pendingDelete?.quantidade, row.unidade),
        unidade: row.unidade,
      })}
      confirmLabel={t('painel.comercial.reservarMaterial.deleteAction')}
      confirmColor="#dc2626"
      onConfirm={handleConfirmDelete}
    />
    </>
  );
}

function ProductSummary({ row }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-1.5">
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">
          {t('painel.comercial.reservarMaterial.columns.cliente')}
        </span>
        <span className="font-medium text-right">{row.clienteNome}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">
          {t('painel.comercial.reservarMaterial.columns.produto')}
        </span>
        <span className="font-medium text-right">
          {row.codigo} — {row.produto}
        </span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">
          {t('painel.comercial.reservarMaterial.columns.lote')}
        </span>
        <span className="font-mono text-right">{row.lote}</span>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-border bg-card px-2 py-2">
      <div className="text-[11px] text-muted-foreground leading-tight">{label}</div>
      <div className="text-sm font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function QuantityField({ id, unidade, value, onChange, max, hint }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {t('painel.comercial.reservarMaterial.reservedQty')} ({unidade})
      </Label>
      <NumberInputBr
        id={id}
        value={value}
        onChange={onChange}
        decimals={0}
        min={0}
        max={max}
        aria-label={t('painel.comercial.reservarMaterial.reservedQty')}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
