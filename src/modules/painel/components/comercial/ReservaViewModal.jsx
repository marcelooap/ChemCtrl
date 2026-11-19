import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  FileDown,
  History,
  Package,
  Scale,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { brasiliaDateTime } from '@industrializacao/lib/brasilTime';
import { fmtDate } from '@/i18n/formatters';
import { formatMass, formatVolume } from '@transbordo/lib/format';
import {
  formatQty,
  listReservasForChave,
} from '@painel/lib/materialReservas';
import {
  ORIGEM_INDUSTRIALIZACAO,
  generateVasilhameBoleta,
  isVasilhameReservaChave,
} from '@painel/lib/vasilhameReservas';
import { useSubmitGuard } from '@shared/hooks/useSubmitGuard';
import { useToast } from '@shared/components/ui/use-toast';

const thClass =
  'px-3 py-1.5 text-center text-[11px] font-medium text-muted-foreground uppercase bg-muted/40';
const tdClass =
  'px-3 py-2 text-center align-middle text-sm border-t border-border';

function SectionCard({ icon: Icon, title, children, action = null }) {
  return (
    <section className="rounded-xl border border-border/80 bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/40 px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {Icon ? (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <Icon className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>
        </div>
        {action ? (
          <div className="flex items-center gap-1.5 shrink-0">{action}</div>
        ) : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function InfoField({ label, value, mono = false }) {
  const display =
    value === null || value === undefined || value === '' ? '—' : value;
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`text-sm text-foreground break-words ${
          mono ? 'font-semibold tabular-nums font-mono' : 'font-medium'
        }`}
      >
        {display}
      </div>
    </div>
  );
}

function StatusBadge({ active, activeLabel, removedLabel }) {
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
        active
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-red-50 text-red-700 border-red-200'
      }`}
    >
      {active ? activeLabel : removedLabel}
    </span>
  );
}

export default function ReservaViewModal({ open, onClose, row, reservas = [] }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const boletaGuard = useSubmitGuard();

  const handleGenerateBoleta = () =>
    boletaGuard.run(async () => {
      try {
        await generateVasilhameBoleta(row);
      } catch (err) {
        console.error('[ReservaViewModal] boleta:', err);
        toast({
          variant: 'destructive',
          title: t('painel.comercial.reservarMaterial.vasilhames.boletaError'),
        });
      }
    });

  const historico = useMemo(() => {
    if (!row?.chave) return [];
    return listReservasForChave(reservas, row.chave, {
      clienteId: row.clienteId,
      clienteNome: row.clienteNome,
      produtoId: row.produtoId,
      produtoCodigo: row.codigo,
      produtoNome: row.produto,
      lote: row.lote,
      unidade: row.unidade,
    });
  }, [row, reservas]);

  if (!row) return null;

  const isVasilhame = isVasilhameReservaChave(row.chave);
  const produto = row.produto || '—';
  const cliente = row.clienteNome || '—';
  const subtitle = [produto, cliente].filter((v) => v && v !== '—').join(' · ') || '—';
  const headerBadge = isVasilhame
    ? row.displayId || null
    : row.lote && row.lote !== '—'
      ? row.lote
      : null;

  const statusReservado = Boolean(row.reservado || row.saldoReservado > 0);
  const statusLabel = isVasilhame
    ? statusReservado
      ? t('painel.comercial.reservarMaterial.vasilhames.status.reservado')
      : t('painel.comercial.reservarMaterial.vasilhames.status.livre')
    : statusReservado
      ? t('painel.comercial.reservarMaterial.statusFilter.reservado')
      : t('painel.comercial.reservarMaterial.statusFilter.livre');

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left space-y-1">
          <DialogTitle className="flex items-center gap-3 flex-wrap text-base">
            <span>{t('painel.comercial.reservarMaterial.viewTitle')}</span>
            {headerBadge ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-slate-50 text-slate-700 border-slate-200 font-mono">
                {headerBadge}
              </span>
            ) : null}
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                statusReservado
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}
            >
              {statusLabel}
            </span>
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <SectionCard
            icon={isVasilhame ? Scale : Package}
            title={t('painel.comercial.reservarMaterial.productSummary')}
          >
            {isVasilhame ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.vasilhames.columns.id')}
                    value={row.displayId}
                    mono
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.vasilhames.columns.origem')}
                    value={
                      row.origem === ORIGEM_INDUSTRIALIZACAO
                        ? t('painel.comercial.reservarMaterial.vasilhames.origem.industrializacao')
                        : t('painel.comercial.reservarMaterial.vasilhames.origem.transbordo')
                    }
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.vasilhames.columns.placa')}
                    value={row.placa}
                    mono
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.vasilhames.columns.barril')}
                    value={row.barril}
                    mono
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.vasilhames.columns.status')}
                    value={statusLabel}
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.columns.produto')}
                    value={produto}
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.columns.cliente')}
                    value={cliente}
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.vasilhames.columns.volume')}
                    value={`${formatVolume(row.volume, { empty: '—' })} L`}
                    mono
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.vasilhames.columns.massa')}
                    value={`${formatMass(row.massa, { empty: '—' })} kg`}
                    mono
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.vasilhames.columns.tara')}
                    value={`${formatMass(row.tara, { empty: '—' })} kg`}
                    mono
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.columns.fabricacao')}
                    value={fmtDate(row.dataFabricacao, undefined, i18n.language)}
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.columns.validade')}
                    value={fmtDate(row.dataValidade, undefined, i18n.language)}
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.columns.lote')}
                    value={row.lote}
                    mono
                  />
                  {row.lacres ? (
                    <div className="col-span-2 sm:col-span-3 lg:col-span-4">
                      <InfoField
                        label={t('painel.comercial.reservarMaterial.columns.lacres')}
                        value={row.lacres}
                        mono
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.columns.produto')}
                    value={produto}
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.columns.cliente')}
                    value={cliente}
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.columns.lote')}
                    value={row.lote}
                    mono
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.columns.unidade')}
                    value={row.unidade}
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.columns.saldoAtual')}
                    value={`${formatQty(row.saldoAtual, row.unidade)} ${row.unidade}`}
                    mono
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.columns.saldoReservado')}
                    value={`${formatQty(row.saldoReservado, row.unidade)} ${row.unidade}`}
                    mono
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.columns.fabricacao')}
                    value={fmtDate(row.dataFabricacao, undefined, i18n.language)}
                  />
                  <InfoField
                    label={t('painel.comercial.reservarMaterial.columns.validade')}
                    value={fmtDate(row.dataValidade, undefined, i18n.language)}
                  />
                  {row.lacres ? (
                    <div className="col-span-2 sm:col-span-3 lg:col-span-4">
                      <InfoField
                        label={t('painel.comercial.reservarMaterial.columns.lacres')}
                        value={row.lacres}
                        mono
                      />
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 flex flex-wrap justify-between gap-3 text-sm">
                  <div className="space-y-0.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('painel.comercial.reservarMaterial.columns.saldoAtual')}
                    </div>
                    <div className="font-bold tabular-nums text-foreground">
                      {formatQty(row.saldoAtual, row.unidade)} {row.unidade}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('painel.comercial.reservarMaterial.columns.reservado')}
                    </div>
                    <div className="font-bold tabular-nums text-primary">
                      {formatQty(row.saldoReservado, row.unidade)} {row.unidade}
                    </div>
                  </div>
                  <div className="space-y-0.5 text-right">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('painel.comercial.reservarMaterial.columns.saldoFinal')}
                    </div>
                    <div className="font-bold tabular-nums text-foreground">
                      {formatQty(row.saldoFinal, row.unidade)} {row.unidade}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard
            icon={History}
            title={t('painel.comercial.reservarMaterial.reservationsList')}
            action={
              historico.length > 0 ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-foreground/70">
                  {historico.length}
                </span>
              ) : null
            }
          >
            {historico.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {t('painel.comercial.reservarMaterial.noReservations')}
              </div>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full border border-border rounded-lg overflow-hidden">
                  <thead>
                    <tr>
                      <th className={thClass}>
                        {t('painel.comercial.reservarMaterial.history.date')}
                      </th>
                      <th className={thClass}>
                        {t('painel.comercial.reservarMaterial.history.requester')}
                      </th>
                      <th className={thClass}>
                        {t('painel.comercial.reservarMaterial.history.user')}
                      </th>
                      <th className={thClass}>
                        {t('painel.comercial.reservarMaterial.history.qty')}
                      </th>
                      <th className={thClass}>
                        {t('painel.comercial.reservarMaterial.history.status')}
                      </th>
                      <th className={thClass}>
                        {t('painel.comercial.reservarMaterial.history.removedBy')}
                      </th>
                      <th className={thClass}>
                        {t('painel.comercial.reservarMaterial.history.notes')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {historico.map((r) => {
                      const removed = r.status === 'removida';
                      const unidade = r.unidade_medida || row.unidade;
                      return (
                        <tr key={r.id} className="hover:bg-muted/20">
                          <td className={`${tdClass} text-muted-foreground whitespace-nowrap`}>
                            <span className="inline-flex items-center justify-center gap-1">
                              <Calendar className="h-3 w-3 opacity-60" />
                              {brasiliaDateTime(r.created_at)}
                            </span>
                          </td>
                          <td className={`${tdClass} font-medium text-foreground`}>
                            {r.solicitante || '—'}
                          </td>
                          <td className={`${tdClass} text-foreground`}>
                            {r.usuario_nome || '—'}
                          </td>
                          <td className={`${tdClass} font-semibold tabular-nums text-foreground`}>
                            {formatQty(r.quantidade, unidade)} {unidade}
                          </td>
                          <td className={tdClass}>
                            <StatusBadge
                              active={!removed}
                              activeLabel={t(
                                'painel.comercial.reservarMaterial.status.active'
                              )}
                              removedLabel={t(
                                'painel.comercial.reservarMaterial.status.removed'
                              )}
                            />
                          </td>
                          <td className={`${tdClass} text-muted-foreground`}>
                            {removed ? (
                              <div className="space-y-0.5">
                                <div>{r.removido_por_nome || '—'}</div>
                                <div className="text-[11px]">
                                  {brasiliaDateTime(r.removido_em)}
                                </div>
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={`${tdClass} text-muted-foreground max-w-[220px]`}>
                            <span className="line-clamp-2 text-left inline-block w-full">
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
          </SectionCard>
        </div>

        <div className="shrink-0 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t border-border px-5 py-3 bg-muted/20">
          {isVasilhame ? (
            <Button
              type="button"
              className="gap-2"
              onClick={handleGenerateBoleta}
              disabled={boletaGuard.busy}
            >
              <FileDown className="h-4 w-4" />
              {t('painel.comercial.reservarMaterial.vasilhames.actions.generateBoleta')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>
            {t('buttons.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
