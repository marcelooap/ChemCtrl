import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@shared/components/ui/label';
import { Switch } from '@shared/components/ui/switch';
import ChecklistExpedicaoValidadeDestinosEditor from '@painel/components/configuracao/ChecklistExpedicaoValidadeDestinosEditor';

/**
 * Opção "Verificação da validade dos testes" do checklist de expedição de um cliente.
 * Os testes (nome, validade e prazo de verificação) são definidos por destino.
 *
 * @param {{
 *   value: {
 *     ativo: boolean,
 *     destinos: Array<{ key: string, destino: string, dias: string|number }>,
 *   },
 *   onChange: (next: object) => void,
 *   disabled?: boolean,
 *   showErrors?: boolean,
 * }} props
 */
export default function ChecklistExpedicaoValidadeTestesConfig({
  value,
  onChange,
  disabled = false,
  showErrors = false,
}) {
  const { t } = useTranslation();
  const switchId = useId();

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
        <ChecklistExpedicaoValidadeDestinosEditor
          rows={value.destinos || []}
          onChange={(next) => onChange({ ...value, destinos: next })}
          disabled={disabled}
          showErrors={showErrors}
        />
      ) : null}
    </div>
  );
}
