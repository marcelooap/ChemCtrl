import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
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
import DateInputBr from '@shared/components/ui/DateInputBr';
import { Can } from '@industrializacao/lib/rbac/Can';
import { cn } from '@shared/lib/utils';
import {
  ENCAIXE_HORARIO,
  formatDateBR,
  isCarregamentoAtrasado,
  normalizeBookings,
  nowBrasiliaHHMM,
  summarizeSlotBookings,
  todayISO,
} from '@painel/lib/agendamentosCarregamento';
import { listOperadoresAtivos } from '@transbordo/lib/operadoresCadastro';

export default function AgendamentoConcluirCarregamentoModal({
  open,
  onClose,
  bookings,
  permissionPrefix = 'painel_logistica_agendamentos',
  onConfirm,
  onNeedsJustificativa,
}) {
  const { t } = useTranslation();
  const [horaCarregamento, setHoraCarregamento] = useState('');
  const [dataCarregamento, setDataCarregamento] = useState('');
  const [operadores, setOperadores] = useState([]);
  const [operadorId, setOperadorId] = useState('');
  const [loadingOperadores, setLoadingOperadores] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const list = normalizeBookings(bookings);
  const summary = summarizeSlotBookings(list);
  const booking = summary.first;
  const cargaKey = list.map((row) => row.saida_id).filter(Boolean).join('|');
  const selectedOperador = operadores.find((op) => op.id === operadorId) || null;

  useEffect(() => {
    if (!open) return;
    setHoraCarregamento(nowBrasiliaHHMM());
    setDataCarregamento(todayISO());
    setOperadorId('');
    setError('');
    setSaving(false);
    savingRef.current = false;

    let cancelled = false;
    setLoadingOperadores(true);
    listOperadoresAtivos({ setor: 'Logística' })
      .then((rows) => {
        if (!cancelled) setOperadores(rows || []);
      })
      .catch(() => {
        if (!cancelled) setOperadores([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingOperadores(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, cargaKey]);

  if (!booking) return null;

  const horarioLabel =
    booking.horario === ENCAIXE_HORARIO
      ? t('painel.comercial.agendamentos.encaixe')
      : booking.horario;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;
    if (!selectedOperador?.nome) {
      setError(t('painel.comercial.agendamentos.concluir.operadorRequired'));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const dataIso = String(dataCarregamento || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) {
        throw new Error(t('painel.comercial.agendamentos.errors.dataCarregamento'));
      }

      const atrasado = isCarregamentoAtrasado({
        horarioAgendado: booking.horario,
        horaCarregamento,
        dataAgendada: String(booking.data).slice(0, 10),
        dataCarregamento: dataIso,
      });

      if (atrasado) {
        onNeedsJustificativa?.({
          horaCarregamento,
          dataCarregamento: dataIso,
          operador: selectedOperador,
        });
        onClose();
        return;
      }

      await onConfirm({
        horaCarregamento,
        dataCarregamento: dataIso,
        justificativa: null,
        operador: selectedOperador,
      });
      onClose();
    } catch (err) {
      setError(
        err?.message || t('painel.comercial.agendamentos.errors.concluirFailed')
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const canLiberar = Boolean(selectedOperador?.nome) && !saving;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('painel.comercial.agendamentos.concluir.title')}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('painel.comercial.agendamentos.modal.slotLabel', {
              date: formatDateBR(String(booking.data).slice(0, 10)),
              time: horarioLabel,
            })}
            {summary.codesLabel && summary.codesLabel !== '—'
              ? ` · ${summary.codesLabel}`
              : ''}
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ag-data-carregamento">
                {t('painel.comercial.agendamentos.concluir.dataLabel')}
                <span className="text-destructive"> *</span>
              </Label>
              <DateInputBr
                value={dataCarregamento}
                onChange={setDataCarregamento}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ag-hora-carregamento">
                {t('painel.comercial.agendamentos.concluir.horaLabel')}
                <span className="text-destructive"> *</span>
              </Label>
              <Input
                id="ag-hora-carregamento"
                type="time"
                step={60}
                value={horaCarregamento}
                onChange={(e) => setHoraCarregamento(e.target.value)}
                required
                className="tabular-nums"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('painel.comercial.agendamentos.concluir.dataHoraHint')}
          </p>

          <div className="space-y-2">
            <Label>
              {t('painel.comercial.agendamentos.concluir.operadorLabel')}
              <span className="text-destructive"> *</span>
            </Label>
            {loadingOperadores ? (
              <p className="text-sm text-muted-foreground">
                {t('painel.comercial.agendamentos.concluir.operadorLoading')}
              </p>
            ) : operadores.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('painel.comercial.agendamentos.concluir.operadorEmpty')}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {operadores.map((op) => {
                  const selected = op.id === operadorId;
                  return (
                    <button
                      key={op.id}
                      type="button"
                      onClick={() => setOperadorId(op.id)}
                      disabled={saving}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                          : 'border-border bg-card text-foreground hover:bg-muted/60'
                      )}
                    >
                      {op.nome}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {t('buttons.cancel')}
            </Button>
            <Can anyOf={[`${permissionPrefix}.edit`, `${permissionPrefix}.view`]}>
              <Button type="submit" disabled={!canLiberar}>
                {saving
                  ? t('painel.comercial.agendamentos.saving')
                  : t('painel.comercial.agendamentos.concluir.confirm')}
              </Button>
            </Can>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
