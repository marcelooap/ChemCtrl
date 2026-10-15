import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, BookmarkMinus, BookmarkPlus, Eye } from 'lucide-react';
import ConfirmDialog from '@shared/components/ConfirmDialog';
import { Button } from '@shared/components/ui/button';
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
import { formatMass, formatVolume } from '@transbordo/lib/format';
import { useToast } from '@shared/components/ui/use-toast';
import ReservaViewModal from '@painel/components/comercial/ReservaViewModal';
import {
  ORIGEM_INDUSTRIALIZACAO,
  ORIGEM_TRANSBORDO,
  liberarVasilhame,
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
  const [viewRow, setViewRow] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [solicitante, setSolicitante] = useState('');
  const [reserveError, setReserveError] = useState('');
  const [reserving, setReserving] = useState(false);

  const isLiberar = pendingAction?.type === 'liberar';
  const reserveRow = pendingAction?.type === 'reservar' ? pendingAction.row : null;

  const openReserve = (row) => {
    setSolicitante('');
    setReserveError('');
    setPendingAction({ type: 'reservar', row });
  };

  const closeReserve = () => {
    if (reserving) return;
    setPendingAction(null);
    setSolicitante('');
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

    setReserving(true);
    setReserveError('');
    try {
      await reservarVasilhame({ row, user, solicitante: nome });
      toast({
        title: t('painel.comercial.reservarMaterial.vasilhames.reserveSuccess'),
      });
      setPendingAction(null);
      setSolicitante('');
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
          <h3 className="text-sm font-semibold text-foreground">
            {showDataSaida
              ? t('painel.comercial.reservarMaterial.vasilhames.tableTitleAll')
              : t('painel.comercial.reservarMaterial.vasilhames.tableTitle')}
          </h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {rows.length}
          </span>
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
                  <th className="px-4 py-3 font-medium bg-muted/40">
                    {t('painel.comercial.reservarMaterial.vasilhames.columns.id')}
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
                    {t('painel.comercial.reservarMaterial.columns.cliente')}
                  </th>
                  <th className="px-4 py-3 font-medium bg-muted/40">
                    {t('painel.comercial.reservarMaterial.columns.cod')}
                  </th>
                  <th className="px-4 py-3 font-medium bg-muted/40">
                    {t('painel.comercial.reservarMaterial.columns.produto')}
                  </th>
                  <th className="px-4 py-3 font-medium text-right bg-muted/40">
                    {t('painel.comercial.reservarMaterial.vasilhames.columns.volume')}
                  </th>
                  <th className="px-4 py-3 font-medium text-right bg-muted/40">
                    {t('painel.comercial.reservarMaterial.vasilhames.columns.massa')}
                  </th>
                  <th className="px-4 py-3 font-medium bg-muted/40">
                    {t('painel.comercial.reservarMaterial.columns.lote')}
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
                    } ${row.emPatio === false ? 'text-muted-foreground' : ''}`}
                  >
                    <td className="px-4 py-3 font-mono font-medium text-primary">
                      {row.displayId}
                    </td>
                    <td className="px-4 py-3">
                      <OrigemBadge origem={row.origem} />
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                      {row.placa}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {row.barril}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.clienteNome}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{row.codigo}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{row.produto}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className="inline-flex items-center justify-end whitespace-nowrap">
                        {row.fracionado ? <FracionadoBadge /> : null}
                        {formatVolume(row.volume, { empty: '—' })}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatMass(row.massa, { empty: '—' })}
                    </td>
                    <td className="px-4 py-3 font-mono">{row.lote}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge reservado={row.reservado} />
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
                                title={t('painel.comercial.reservarMaterial.vasilhames.actions.remover')}
                                onClick={() => setPendingAction({ type: 'liberar', row })}
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
                {t('painel.comercial.reservarMaterial.vasilhames.confirmTitle')}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleConfirmReserve} className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t('painel.comercial.reservarMaterial.vasilhames.confirmMessage', {
                  id: reserveRow?.displayId || '—',
                  produto: reserveRow?.produto || '—',
                  cliente: reserveRow?.clienteNome || '—',
                })}
              </p>
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
                  autoFocus
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
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeReserve} disabled={reserving}>
                  {t('buttons.cancel')}
                </Button>
                <Button type="submit" disabled={reserving}>
                  {reserving
                    ? t('painel.comercial.reservarMaterial.saving')
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

function StatusBadge({ reservado }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
        reservado ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'
      }`}
    >
      {reservado
        ? t('painel.comercial.reservarMaterial.vasilhames.status.reservado')
        : t('painel.comercial.reservarMaterial.vasilhames.status.livre')}
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
