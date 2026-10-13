import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import Combobox from '@shared/components/ui/combobox';
import { Can } from '@industrializacao/lib/rbac/Can';
import {
  ENCAIXE_HORARIO,
  formatDateBR,
  listTransporteSugestoes,
  normalizePlaca,
} from '@painel/lib/agendamentosCarregamento';

const SUGESTOES_QUERY_KEY = ['agendamentos-transporte-sugestoes'];
const SUGESTOES_STALE_MS = 5 * 60 * 1000;
const EMPTY_OPTIONS = [];

const toUpper = (value) => String(value || '').toLocaleUpperCase('pt-BR');
const toOptions = (names) => names.map((name) => ({ value: name, label: name }));

export default function AgendamentoTransporteModal({
  open,
  onClose,
  booking,
  permissionPrefix = 'painel_comercial_agendamentos',
  onSave,
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: sugestoes } = useQuery({
    queryKey: SUGESTOES_QUERY_KEY,
    queryFn: listTransporteSugestoes,
    enabled: open,
    staleTime: SUGESTOES_STALE_MS,
  });
  const transportadoraOptions = useMemo(
    () => (sugestoes ? toOptions(sugestoes.transportadoras) : EMPTY_OPTIONS),
    [sugestoes]
  );
  const motoristaOptions = useMemo(
    () => (sugestoes ? toOptions(sugestoes.motoristas) : EMPTY_OPTIONS),
    [sugestoes]
  );
  const [transportadora, setTransportadora] = useState('');
  const [motorista, setMotorista] = useState('');
  const [placa, setPlaca] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!open || !booking) return;
    setTransportadora(toUpper(booking.transportadora));
    setMotorista(toUpper(booking.motorista));
    setPlaca(booking.placa || '');
    setError('');
    setSaving(false);
    savingRef.current = false;
  }, [open, booking]);

  if (!booking) return null;

  const horarioLabel =
    booking.horario === ENCAIXE_HORARIO
      ? t('painel.comercial.agendamentos.encaixe')
      : booking.horario;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave({
        transportadora,
        motorista,
        placa,
      });
      queryClient.invalidateQueries({ queryKey: SUGESTOES_QUERY_KEY });
      onClose();
    } catch (err) {
      setError(err?.message || t('painel.comercial.agendamentos.errors.transporteFailed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('painel.comercial.agendamentos.transporte.title')}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('painel.comercial.agendamentos.modal.slotLabel', {
              date: formatDateBR(String(booking.data).slice(0, 10)),
              time: horarioLabel,
            })}
            {booking.saida_codigo ? ` · ${booking.saida_codigo}` : ''}
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <NameField
            id="ag-transportadora"
            label={t('painel.comercial.agendamentos.transporte.transportadora')}
            value={transportadora}
            onChange={(v) => setTransportadora(toUpper(v))}
            options={transportadoraOptions}
            emptyLabel={t('painel.comercial.agendamentos.transporte.noSuggestions')}
          />
          <NameField
            id="ag-motorista"
            label={t('painel.comercial.agendamentos.transporte.motorista')}
            value={motorista}
            onChange={(v) => setMotorista(toUpper(v))}
            options={motoristaOptions}
            emptyLabel={t('painel.comercial.agendamentos.transporte.noSuggestions')}
          />
          <Field
            id="ag-placa"
            label={t('painel.comercial.agendamentos.transporte.placa')}
            value={placa}
            onChange={(v) => setPlaca(normalizePlaca(v))}
            className="uppercase font-mono"
          />

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
              <Button type="submit" disabled={saving}>
                {saving
                  ? t('painel.comercial.agendamentos.saving')
                  : t('buttons.save')}
              </Button>
            </Can>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NameField({ id, label, value, onChange, options, emptyLabel }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Combobox
        id={id}
        value={value}
        onValueChange={onChange}
        options={options}
        emptyOptionsLabel={emptyLabel}
        inputClassName="uppercase"
      />
    </div>
  );
}

function Field({ id, label, value, onChange, required, className = '' }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className={className}
      />
    </div>
  );
}
