import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import { Switch } from '@shared/components/ui/switch';
import {
  VALIDADE_TESTES_PRAZO_MAX_DIAS,
  VALIDADE_TESTES_PRAZO_MIN_DIAS,
  calcularDataLimiteTestes,
  formatDataLimiteTestes,
  parsePrazoDias,
} from '@painel/lib/validadeTestesTanque';

/**
 * Opção "Verificação da validade dos testes" do checklist de expedição de um cliente.
 *
 * @param {{
 *   value: { ativo: boolean, dias: string|number },
 *   onChange: (next: { ativo: boolean, dias: string|number }) => void,
 *   disabled?: boolean,
 * }} props
 */
export default function ChecklistExpedicaoValidadeTestesConfig({
  value,
  onChange,
  disabled = false,
}) {
  const { t, i18n } = useTranslation();
  const switchId = useId();
  const prazoId = useId();
  const prazoErrorId = useId();

  const prazo = parsePrazoDias(value.dias);
  const prazoInvalid = value.ativo && prazo == null;

  const exemplo = useMemo(
    () => (prazo == null ? null : formatDataLimiteTestes(calcularDataLimiteTestes(prazo), i18n.language)),
    [prazo, i18n.language]
  );

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor={switchId} className="text-sm font-semibold text-foreground">
            {t('painel.configuracao.checklistExpedicao.validadeTestes.title')}
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('painel.configuracao.checklistExpedicao.validadeTestes.hint')}
          </p>
        </div>
        <Switch
          id={switchId}
          checked={value.ativo}
          disabled={disabled}
          onCheckedChange={(ativo) => onChange({ ...value, ativo })}
          aria-label={t('painel.configuracao.checklistExpedicao.validadeTestes.enable')}
        />
      </div>

      {value.ativo ? (
        <div className="mt-4 flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="w-40">
            <Label htmlFor={prazoId} className="text-xs font-medium">
              {t('painel.configuracao.checklistExpedicao.validadeTestes.prazoLabel')}
            </Label>
            <Input
              id={prazoId}
              type="number"
              inputMode="numeric"
              min={VALIDADE_TESTES_PRAZO_MIN_DIAS}
              max={VALIDADE_TESTES_PRAZO_MAX_DIAS}
              step={1}
              value={value.dias}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, dias: e.target.value })}
              aria-invalid={prazoInvalid}
              aria-describedby={prazoInvalid ? prazoErrorId : undefined}
              className={`mt-1.5 h-9 ${prazoInvalid ? 'border-destructive' : ''}`}
            />
          </div>
          <div className="min-w-0 flex-1 pt-5 text-xs text-muted-foreground">
            {prazoInvalid ? (
              <p id={prazoErrorId} role="alert" className="text-destructive">
                {t('painel.configuracao.checklistExpedicao.validadeTestes.prazoInvalid', {
                  min: VALIDADE_TESTES_PRAZO_MIN_DIAS,
                  max: VALIDADE_TESTES_PRAZO_MAX_DIAS,
                })}
              </p>
            ) : (
              <p>
                {t('painel.configuracao.checklistExpedicao.validadeTestes.example', {
                  dias: prazo,
                  date: exemplo,
                })}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
