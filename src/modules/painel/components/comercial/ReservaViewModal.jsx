import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { brasiliaDateTime } from '@industrializacao/lib/brasilTime';
import {
  formatQty,
  listReservasForChave,
} from '@painel/lib/materialReservas';

export default function ReservaViewModal({ open, onClose, row, reservas = [] }) {
  const { t } = useTranslation();

  const historico = useMemo(() => {
    if (!row?.chave) return [];
    return listReservasForChave(reservas, row.chave);
  }, [row, reservas]);

  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('painel.comercial.reservarMaterial.viewTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              {t('painel.comercial.reservarMaterial.productSummary')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <SummaryItem
                label={t('painel.comercial.reservarMaterial.columns.cliente')}
                value={row.clienteNome}
              />
              <SummaryItem
                label={t('painel.comercial.reservarMaterial.columns.cod')}
                value={row.codigo}
                mono
              />
              <SummaryItem
                label={t('painel.comercial.reservarMaterial.columns.produto')}
                value={row.produto}
              />
              <SummaryItem
                label={t('painel.comercial.reservarMaterial.columns.lote')}
                value={row.lote}
                mono
              />
              <SummaryItem
                label={t('painel.comercial.reservarMaterial.columns.unidade')}
                value={row.unidade}
              />
              <SummaryItem
                label={t('painel.comercial.reservarMaterial.columns.saldoAtual')}
                value={`${formatQty(row.saldoAtual, row.unidade)} ${row.unidade}`}
              />
              <SummaryItem
                label={t('painel.comercial.reservarMaterial.columns.saldoReservado')}
                value={`${formatQty(row.saldoReservado, row.unidade)} ${row.unidade}`}
              />
              <SummaryItem
                label={t('painel.comercial.reservarMaterial.columns.saldoFinal')}
                value={`${formatQty(row.saldoFinal, row.unidade)} ${row.unidade}`}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold text-foreground">
                {t('painel.comercial.reservarMaterial.reservationsList')}
              </h3>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {historico.length}
              </span>
            </div>

            {historico.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {t('painel.comercial.reservarMaterial.noReservations')}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase">
                      <th className="px-3 py-2.5 font-medium">
                        {t('painel.comercial.reservarMaterial.history.date')}
                      </th>
                      <th className="px-3 py-2.5 font-medium">
                        {t('painel.comercial.reservarMaterial.history.user')}
                      </th>
                      <th className="px-3 py-2.5 font-medium text-right">
                        {t('painel.comercial.reservarMaterial.history.qty')}
                      </th>
                      <th className="px-3 py-2.5 font-medium text-center">
                        {t('painel.comercial.reservarMaterial.history.status')}
                      </th>
                      <th className="px-3 py-2.5 font-medium">
                        {t('painel.comercial.reservarMaterial.history.removedBy')}
                      </th>
                      <th className="px-3 py-2.5 font-medium">
                        {t('painel.comercial.reservarMaterial.history.notes')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {historico.map((r) => {
                      const removed = r.status === 'removida';
                      return (
                        <tr
                          key={r.id}
                          className="border-b border-border last:border-0 hover:bg-muted/30"
                        >
                          <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                            {brasiliaDateTime(r.created_at)}
                          </td>
                          <td className="px-3 py-2.5 font-medium">
                            {r.usuario_nome || '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                            {formatQty(r.quantidade, row.unidade)} {row.unidade}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                                removed
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-emerald-100 text-emerald-700'
                              }`}
                            >
                              {removed
                                ? t('painel.comercial.reservarMaterial.status.removed')
                                : t('painel.comercial.reservarMaterial.status.active')}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground">
                            {removed ? (
                              <div className="space-y-0.5">
                                <div>{r.removido_por_nome || '—'}</div>
                                <div className="text-xs">
                                  {brasiliaDateTime(r.removido_em)}
                                </div>
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground max-w-[220px]">
                            <span className="line-clamp-2">
                              {removed
                                ? r.motivo_remocao || r.observacao || '—'
                                : r.observacao || '—'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('buttons.close')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryItem({ label, value, mono = false }) {
  return (
    <div className="flex justify-between gap-3 sm:block sm:space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-sm font-medium text-foreground ${mono ? 'font-mono' : ''} sm:text-left text-right`}
      >
        {value || '—'}
      </div>
    </div>
  );
}
