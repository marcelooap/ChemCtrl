import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, BookmarkMinus, BookmarkPlus, Eye, FileText, Loader2 } from 'lucide-react';
import ConfirmDialog from '@shared/components/ConfirmDialog';
import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import { RowActionButton } from '@shared/components/ui/RowActionButton';
import { Can } from '@industrializacao/lib/rbac/Can';
import { formatVolume } from '@transbordo/lib/format';
import NumberInputBr from '@transbordo/components/NumberInputBr';
import { useToast } from '@shared/components/ui/use-toast';
import { useSubmitGuard } from '@shared/hooks/useSubmitGuard';
import ReservaViewModal from '@painel/components/comercial/ReservaViewModal';
import {
  ORIGEM_INDUSTRIALIZACAO,
  generateVasilhameBoletas,
  getVasilhameEmbalagensDisponiveis,
  getVasilhameReservaAtiva,
  isVasilhameReservaParcialSuportada,
  liberarVasilhame,
  resolveVasilhameQuantidadeReservada,
  reservarVasilhame,
} from '@painel/lib/vasilhameReservas';

function formatExitDate(value, language) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString(language || 'pt-BR');
}

export default function VasilhamesReservaTable({
  rows = [],
  reservas = [],
  user,
  onReload,
  readOnly = false,
  showDataSaida = false,
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const boletasGuard = useSubmitGuard();
  const [viewRow, setViewRow] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [solicitante, setSolicitante] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [reserveError, setReserveError] = useState('');
  const [reserving, setReserving] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  const isLiberar = pendingAction?.type === 'liberar';
  const reserveRow =
    pendingAction?.type === 'reservar' || pendingAction?.type === 'editar'
      ? pendingAction.row
      : null;
  const isEditingReserve = pendingAction?.type === 'editar';
  const reserveSupportsPartial = reserveRow
    ? isVasilhameReservaParcialSuportada(reserveRow)
    : false;
  const reserveMaxEmbalagens = reserveRow
    ? getVasilhameEmbalagensDisponiveis(reserveRow)
    : 1;
  const reserveQtd = Math.round(Number(quantidade) || 0);

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected]
  );
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        rows.forEach((row) => next.delete(row.id));
        return next;
      });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      rows.forEach((row) => next.add(row.id));
      return next;
    });
  };

  const handleGenerateBoletas = () =>
    boletasGuard.run(async () => {
      try {
        await generateVasilhameBoletas(selectedRows);
        toast({
          title: t('painel.comercial.reservarMaterial.vasilhames.boletasGenerated'),
          description: t('painel.comercial.reservarMaterial.vasilhames.boletasExported', {
            count: selectedRows.length,
          }),
        });
      } catch (err) {
        console.error('[VasilhamesReservaTable] boletas:', err);
        toast({
          variant: 'destructive',
          title: t('painel.comercial.reservarMaterial.vasilhames.boletaError'),
          description: err?.message,
        });
      }
    });

  const openReserve = (row) => {
    const max = getVasilhameEmbalagensDisponiveis(row);
    setSolicitante('');
    setQuantidade(isVasilhameReservaParcialSuportada(row) ? String(max) : '1');
    setReserveError('');
    setPendingAction({ type: 'reservar', row });
  };

  const openEditReserve = (row) => {
    if (!isVasilhameReservaParcialSuportada(row)) {
      setPendingAction({ type: 'liberar', row });
      return;
    }
    const reservaAtiva = getVasilhameReservaAtiva(reservas, row.chave);
    const reservedQty = resolveVasilhameQuantidadeReservada(reservaAtiva, row);
    const max = getVasilhameEmbalagensDisponiveis(row);
    setSolicitante(reservaAtiva?.solicitante || '');
    setQuantidade(String(reservedQty > 0 ? reservedQty : max));
    setReserveError('');
    setPendingAction({ type: 'editar', row });
  };

  const closeReserve = () => {
    if (reserving) return;
    setPendingAction(null);
    setSolicitante('');
    setQuantidade('');
    setReserveError('');
  };

  const handleConfirmRelease = async () => {
    const row = pendingAction?.row;
    if (!row) return;
    await liberarVasilhame({ row, user });
    toast({
      title: t('painel.comercial.reservarMaterial.vasilhames.releaseSuccess'),
    });
    await onReload?.({ silent: true });
  };

  const handleConfirmReserve = async (event) => {
    event.preventDefault();
    const row = reserveRow;
    if (!row || reserving) return;

    const nome = solicitante.replace(/\s+/g, ' ').trim();
    if (!nome) {
      setReserveError(t('painel.comercial.reservarMaterial.errors.requesterRequired'));
      return;
    }

    if (reserveSupportsPartial) {
      if (reserveQtd <= 0) {
        setReserveError(t('painel.comercial.reservarMaterial.errors.qtyRequired'));
        return;
      }
      if (reserveQtd > reserveMaxEmbalagens) {
        setReserveError(
          t('painel.comercial.reservarMaterial.vasilhames.errors.exceedsPackages', {
            max: reserveMaxEmbalagens,
          })
        );
        return;
      }
    }

    setReserving(true);
    setReserveError('');
    try {
      await reservarVasilhame({
        row,
        user,
        solicitante: nome,
        quantidade: reserveSupportsPartial ? reserveQtd : 1,
      });
      toast({
        title: isEditingReserve
          ? t('painel.comercial.reservarMaterial.vasilhames.updateSuccess')
          : t('painel.comercial.reservarMaterial.vasilhames.reserveSuccess'),
      });
      setPendingAction(null);
      setSolicitante('');
      setQuantidade('');
      await onReload?.({ silent: true });
    } catch (err) {
      setReserveError(err?.message || t('painel.comercial.reservarMaterial.errors.saveFailed'));
    } finally {
      setReserving(false);
    }
  };

  return (
    <>
      <div className="h-full bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col">
        <div className="shrink-0 px-5 py-4 border-b border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="text-sm font-semibold text-foreground">
              {showDataSaida
                ? t('painel.comercial.reservarMaterial.vasilhames.tableTitleAll')
                : t('painel.comercial.reservarMaterial.vasilhames.tableTitle')}
            </h3>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {rows.length}
            </span>
            {selectedRows.length > 0 ? (
              <span className="text-xs font-semibold text-primary">
                {t('painel.comercial.reservarMaterial.vasilhames.selected', {
                  count: selectedRows.length,
                })}
              </span>
            ) : null}
          </div>
          {selectedRows.length > 0 ? (
            <Button
              type="button"
              onClick={handleGenerateBoletas}
              disabled={boletasGuard.busy}
              className="shrink-0 gap-2"
            >
              {boletasGuard.busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('painel.comercial.reservarMaterial.vasilhames.generatingBoletas')}
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4" />
                  {t('painel.comercial.reservarMaterial.vasilhames.generateBoletas', {
                    count: selectedRows.length,
                  })}
                </>
              )}
            </Button>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
            {showDataSaida
              ? t('painel.comercial.reservarMaterial.vasilhames.emptyAll')
              : t('painel.comercial.reservarMaterial.vasilhames.empty')}
          </div>
        ) : (
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                  <th className="px-3 py-3 text-center w-10 bg-muted/40">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label={t('painel.comercial.reservarMaterial.vasilhames.selectAll')}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium bg-muted/40">
                    {t('painel.comercial.reservarMaterial.vasilhames.columns.id')}
                  </th>
                  <th className="px-4 py-3 font-medium bg-muted/40">
                    {t('painel.comercial.reservarMaterial.columns.cod')}
                  </th>
                  <th className="px-4 py-3 font-medium bg-muted/40">
                    {t('painel.comercial.reservarMaterial.columns.produto')}
                  </th>
                  <th className="px-4 py-3 font-medium bg-muted/40">
                    {t('painel.comercial.reservarMaterial.columns.cliente')}
                  </th>
                  <th className="px-4 py-3 font-medium bg-muted/40">
                    {t('painel.comercial.reservarMaterial.vasilhames.columns.origem')}
                  </th>
                  <th className="px-4 py-3 font-medium bg-muted/40">
                    {t('painel.comercial.reservarMaterial.vasilhames.columns.placa')}
                  </th>
                  <th className="px-4 py-3 font-medium bg-muted/40">
                    {t('painel.comercial.reservarMaterial.vasilhames.columns.barril')}
                  </th>
                  <th className="px-4 py-3 font-medium bg-muted/40">
                    {t('painel.comercial.reservarMaterial.columns.lote')}
                  </th>
                  <th className="px-4 py-3 font-medium text-right bg-muted/40">
                    {t('painel.comercial.reservarMaterial.vasilhames.columns.volume')}
                  </th>
                  <th className="px-4 py-3 font-medium bg-muted/40 min-w-[120px]">
                    {t('painel.comercial.reservarMaterial.vasilhames.columns.observacao')}
                  </th>
                  <th className="px-4 py-3 font-medium text-center bg-muted/40">
                    {t('painel.comercial.reservarMaterial.vasilhames.columns.status')}
                  </th>
                  {showDataSaida ? (
                    <th className="px-4 py-3 font-medium whitespace-nowrap bg-muted/40">
                      {t('painel.comercial.reservarMaterial.vasilhames.columns.dataSaida')}
                    </th>
                  ) : null}
                  <th className="px-4 py-3 font-medium text-center bg-muted/40">
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                      i % 2 === 1 ? 'bg-muted/20' : ''
                    } ${selected.has(row.id) ? 'bg-primary/5' : ''} ${
                      row.emPatio === false ? 'text-muted-foreground' : ''
                    }`}
                  >
                    <td className="px-3 py-3 text-center">
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggleSelect(row.id)}
                        aria-label={t('painel.comercial.reservarMaterial.vasilhames.selectItem', {
                          label: row.displayId || row.id,
                        })}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-primary">
                      {row.displayId}
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{row.codigo}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{row.produto}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.clienteNome}</td>
                    <td className="px-4 py-3">
                      <OrigemBadge origem={row.origem} />
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                      {row.placa}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {row.barril}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      <span className="inline-flex items-center gap-1.5">
                        <span>{row.lote}</span>
                        {row.lotesExtras > 0 ? (
                          <span
                            className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700"
                            title={t('painel.comercial.reservarMaterial.vasilhames.multiLotHint')}
                          >
                            +{row.lotesExtras}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className="inline-flex items-center justify-end whitespace-nowrap">
                        {row.fracionado ? <FracionadoBadge /> : null}
                        {formatVolume(row.volume, { empty: '—' })}
                      </span>
                    </td>
                    <td
                      className="px-4 py-3 text-muted-foreground max-w-[220px] truncate"
                      title={row.observacao !== '—' ? row.observacao : undefined}
                    >
                      {row.observacao}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge
                        reservado={row.reservado}
                        reservaParcial={row.reservaParcial}
                        quantidadeReservada={row.quantidadeReservada}
                        quantidadeEmbalagens={row.quantidadeEmbalagens}
                      />
                    </td>
                    {showDataSaida ? (
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums font-medium text-foreground">
                        {row.dataSaida
                          ? formatExitDate(row.dataSaida, i18n.language)
                          : '—'}
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <RowActionButton
                          title={t('painel.comercial.reservarMaterial.vasilhames.actions.view')}
                          onClick={() => setViewRow(row)}
                        >
                          <Eye />
                        </RowActionButton>
                        {!readOnly && (row.emPatio !== false || row.reservado) && (
                          <Can anyOf={['painel_comercial_reserva.edit', 'painel_comercial_reserva.create']}>
                            {row.reservado ? (
                              <RowActionButton
                                title={
                                  isVasilhameReservaParcialSuportada(row)
                                    ? t('painel.comercial.reservarMaterial.vasilhames.actions.editar')
                                    : t('painel.comercial.reservarMaterial.vasilhames.actions.remover')
                                }
                                onClick={() => openEditReserve(row)}
                              >
                                <BookmarkMinus />
                              </RowActionButton>
                            ) : (
                              <RowActionButton
                                title={t('painel.comercial.reservarMaterial.vasilhames.actions.reservar')}
                                onClick={() => openReserve(row)}
                              >
                                <BookmarkPlus />
                              </RowActionButton>
                            )}
                          </Can>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ReservaViewModal
        open={!!viewRow}
        row={viewRow}
        reservas={reservas}
        onClose={() => setViewRow(null)}
      />

      {!readOnly && (
      <ConfirmDialog
        open={isLiberar}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
        title={t('painel.comercial.reservarMaterial.vasilhames.releaseTitle')}
        message={t('painel.comercial.reservarMaterial.vasilhames.releaseMessage', {
          id: pendingAction?.row?.displayId || '—',
          produto: pendingAction?.row?.produto || '—',
          cliente: pendingAction?.row?.clienteNome || '—',
        })}
        confirmLabel={t('painel.comercial.reservarMaterial.vasilhames.releaseAction')}
        onConfirm={handleConfirmRelease}
      />
      )}

      {!readOnly && (
        <Dialog
          open={!!reserveRow}
          onOpenChange={(open) => {
            if (!open) closeReserve();
          }}
        >
          <DialogContent
            className="max-w-md"
            onInteractOutside={(event) => reserving && event.preventDefault()}
            onEscapeKeyDown={(event) => reserving && event.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>
                {isEditingReserve
                  ? t('painel.comercial.reservarMaterial.vasilhames.editTitle')
                  : t('painel.comercial.reservarMaterial.vasilhames.confirmTitle')}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleConfirmReserve} className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t(
                  isEditingReserve
                    ? 'painel.comercial.reservarMaterial.vasilhames.editMessage'
                    : 'painel.comercial.reservarMaterial.vasilhames.confirmMessage',
                  {
                    id: reserveRow?.displayId || '—',
                    produto: reserveRow?.produto || '—',
                    cliente: reserveRow?.clienteNome || '—',
                  }
                )}
              </p>
              {reserveSupportsPartial ? (
                <div className="space-y-2">
                  <Label htmlFor="vasilhame-reserva-quantidade">
                    {t('painel.comercial.reservarMaterial.vasilhames.quantityLabel')}
                    <span className="text-destructive"> *</span>
                  </Label>
                  <NumberInputBr
                    id="vasilhame-reserva-quantidade"
                    value={quantidade}
                    onChange={(value) => {
                      setQuantidade(value);
                      if (reserveError) setReserveError('');
                    }}
                    decimals={0}
                    min={0}
                    max={reserveMaxEmbalagens}
                    disabled={reserving}
                    aria-label={t(
                      'painel.comercial.reservarMaterial.vasilhames.quantityLabel'
                    )}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('painel.comercial.reservarMaterial.vasilhames.quantityHint', {
                      max: reserveMaxEmbalagens,
                      placa: reserveRow?.placa || '—',
                    })}
                  </p>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="vasilhame-reserva-solicitante">
                  {t('painel.comercial.reservarMaterial.requester')}
                  <span className="text-destructive"> *</span>
                </Label>
                <Input
                  id="vasilhame-reserva-solicitante"
                  value={solicitante}
                  onChange={(event) => {
                    setSolicitante(event.target.value);
                    if (reserveError) setReserveError('');
                  }}
                  maxLength={120}
                  autoComplete="off"
                  autoFocus={!reserveSupportsPartial}
                  disabled={reserving}
                  placeholder={t('painel.comercial.reservarMaterial.requesterPlaceholder')}
                  aria-required
                  aria-invalid={reserveError ? true : undefined}
                />
              </div>
              {reserveError ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{reserveError}</span>
                </div>
              ) : null}
              <DialogFooter className="gap-2 sm:gap-2">
                {isEditingReserve ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-destructive border-destructive/30 hover:bg-destructive/5"
                    disabled={reserving}
                    onClick={async () => {
                      if (reserving || !reserveRow) return;
                      setReserving(true);
                      setReserveError('');
                      try {
                        await liberarVasilhame({ row: reserveRow, user });
                        toast({
                          title: t(
                            'painel.comercial.reservarMaterial.vasilhames.releaseSuccess'
                          ),
                        });
                        setPendingAction(null);
                        setSolicitante('');
                        setQuantidade('');
                        await onReload?.({ silent: true });
                      } catch (err) {
                        setReserveError(
                          err?.message ||
                            t('painel.comercial.reservarMaterial.errors.saveFailed')
                        );
                      } finally {
                        setReserving(false);
                      }
                    }}
                  >
                    {t('painel.comercial.reservarMaterial.vasilhames.releaseAction')}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={closeReserve} disabled={reserving}>
                  {t('buttons.cancel')}
                </Button>
                <Button type="submit" disabled={reserving}>
                  {reserving
                    ? t('painel.comercial.reservarMaterial.saving')
                    : isEditingReserve
                      ? t('painel.comercial.reservarMaterial.vasilhames.updateAction')
                      : t('painel.comercial.reservarMaterial.vasilhames.confirmAction')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function OrigemBadge({ origem }) {
  const { t } = useTranslation();
  const isInd = origem === ORIGEM_INDUSTRIALIZACAO;
  return (
    <span
      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
        isInd ? 'bg-indigo-100 text-indigo-800' : 'bg-sky-100 text-sky-800'
      }`}
    >
      {isInd
        ? t('painel.comercial.reservarMaterial.vasilhames.origem.industrializacao')
        : t('painel.comercial.reservarMaterial.vasilhames.origem.transbordo')}
    </span>
  );
}

function StatusBadge({
  reservado,
  reservaParcial = false,
  quantidadeReservada = 0,
  quantidadeEmbalagens = 0,
}) {
  const { t } = useTranslation();
  const label = !reservado
    ? t('painel.comercial.reservarMaterial.vasilhames.status.livre')
    : reservaParcial
      ? t('painel.comercial.reservarMaterial.vasilhames.status.parcial', {
          reserved: quantidadeReservada,
          total: quantidadeEmbalagens,
        })
      : t('painel.comercial.reservarMaterial.vasilhames.status.reservado');

  return (
    <span
      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
        !reservado
          ? 'bg-green-100 text-green-800'
          : reservaParcial
            ? 'bg-amber-100 text-amber-800'
            : 'bg-purple-100 text-purple-800'
      }`}
    >
      {label}
    </span>
  );
}

function FracionadoBadge() {
  const { t } = useTranslation();
  return (
    <span className="mr-2 inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-blue-800">
      {t('painel.comercial.reservarMaterial.vasilhames.fracionado', {
        defaultValue: 'Fracionado',
      })}
    </span>
  );
}
