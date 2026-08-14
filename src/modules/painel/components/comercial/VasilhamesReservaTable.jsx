import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookmarkMinus, BookmarkPlus, Eye } from 'lucide-react';
import ConfirmDialog from '@shared/components/ConfirmDialog';
import { Button } from '@shared/components/ui/button';
import { Can } from '@industrializacao/lib/rbac/Can';
import ContainerViewDialog from '@industrializacao/components/vasilhames/ContainerViewDialog';
import { formatMass, formatVolume } from '@transbordo/lib/format';
import VasilhameViewDialog from '@transbordo/components/vasilhame/VasilhameViewDialog';
import { useToast } from '@shared/components/ui/use-toast';
import {
  ORIGEM_INDUSTRIALIZACAO,
  ORIGEM_TRANSBORDO,
  liberarVasilhame,
  reservarVasilhame,
} from '@painel/lib/vasilhameReservas';

export default function VasilhamesReservaTable({
  rows = [],
  productions = [],
  recipes = [],
  user,
  onReload,
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [viewRow, setViewRow] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);

  const isLiberar = pendingAction?.type === 'liberar';

  const handleConfirmAction = async () => {
    const row = pendingAction?.row;
    if (!row) return;

    if (isLiberar) {
      await liberarVasilhame({ row, user });
      toast({
        title: t('painel.comercial.reservarMaterial.vasilhames.releaseSuccess'),
      });
    } else {
      await reservarVasilhame({ row, user });
      toast({
        title: t('painel.comercial.reservarMaterial.vasilhames.reserveSuccess'),
      });
    }

    await onReload?.({ silent: true });
  };

  return (
    <>
      <div className="h-full bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col">
        <div className="shrink-0 px-5 py-4 border-b border-border flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {t('painel.comercial.reservarMaterial.vasilhames.tableTitle')}
          </h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {rows.length}
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
            {t('painel.comercial.reservarMaterial.vasilhames.empty')}
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
                    }`}
                  >
                    <td className="px-4 py-3 font-mono font-medium text-primary">
                      {row.displayId}
                    </td>
                    <td className="px-4 py-3">
                      <OrigemBadge origem={row.origem} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.clienteNome}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{row.codigo}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{row.produto}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatVolume(row.volume, { empty: '—' })}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatMass(row.massa, { empty: '—' })}
                    </td>
                    <td className="px-4 py-3 font-mono">{row.lote}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge reservado={row.reservado} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={t('painel.comercial.reservarMaterial.vasilhames.actions.view')}
                          onClick={() => setViewRow(row)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Can anyOf={['painel_comercial_reserva.edit', 'painel_comercial_reserva.create']}>
                          {row.reservado ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={t('painel.comercial.reservarMaterial.vasilhames.actions.remover')}
                              onClick={() => setPendingAction({ type: 'liberar', row })}
                            >
                              <BookmarkMinus className="w-4 h-4" />
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={t('painel.comercial.reservarMaterial.vasilhames.actions.reservar')}
                              onClick={() => setPendingAction({ type: 'reservar', row })}
                            >
                              <BookmarkPlus className="w-4 h-4" />
                            </Button>
                          )}
                        </Can>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <VasilhameViewDialog
        open={viewRow?.origem === ORIGEM_TRANSBORDO}
        vasilhame={viewRow?.origem === ORIGEM_TRANSBORDO ? viewRow.source : null}
        onClose={() => setViewRow(null)}
      />

      <ContainerViewDialog
        open={viewRow?.origem === ORIGEM_INDUSTRIALIZACAO}
        container={viewRow?.origem === ORIGEM_INDUSTRIALIZACAO ? viewRow.source : null}
        productions={productions}
        recipes={recipes}
        onOpenChange={(open) => {
          if (!open) setViewRow(null);
        }}
      />

      <ConfirmDialog
        open={!!pendingAction}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
        title={
          isLiberar
            ? t('painel.comercial.reservarMaterial.vasilhames.releaseTitle')
            : t('painel.comercial.reservarMaterial.vasilhames.confirmTitle')
        }
        message={t(
          isLiberar
            ? 'painel.comercial.reservarMaterial.vasilhames.releaseMessage'
            : 'painel.comercial.reservarMaterial.vasilhames.confirmMessage',
          {
            id: pendingAction?.row?.displayId || '—',
            produto: pendingAction?.row?.produto || '—',
            cliente: pendingAction?.row?.clienteNome || '—',
          }
        )}
        confirmLabel={
          isLiberar
            ? t('painel.comercial.reservarMaterial.vasilhames.releaseAction')
            : t('painel.comercial.reservarMaterial.vasilhames.confirmAction')
        }
        onConfirm={handleConfirmAction}
      />
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
