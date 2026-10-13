import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { Switch } from '@shared/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/components/ui/select';
import {
  ORGAOS_REGULAMENTADORES,
  OrgaoRegulamentadorLogo,
} from '@transbordo/components/cadastro/OrgaoRegulamentadorBadge';

/**
 * Ícone por linha de MP que abre um popover para informar se a matéria prima
 * é controlada e por qual órgão regulamentador (Federal ou Exército).
 *
 * Estado controlado pelo pai: { controlado: boolean, orgao_regulamentador: string | null }.
 */
export default function MpControlePopover({ controlado, orgao, onChange, disabled = false }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const isControlled = Boolean(controlado);
  const missingOrgan = isControlled && !orgao;
  const triggerLabel = isControlled && orgao
    ? t('recipes.form.mpControl.triggerControlled', { organ: orgao })
    : t('recipes.form.mpControl.trigger');

  const handleToggle = (checked) => {
    onChange({ controlado: checked, orgao_regulamentador: checked ? orgao || null : null });
  };

  const handleOrgan = (value) => {
    onChange({ controlado: true, orgao_regulamentador: value });
  };

  const TriggerIcon = isControlled ? ShieldAlert : ShieldCheck;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={triggerLabel}
          title={triggerLabel}
          className={`inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            isControlled
              ? missingOrgan
                ? 'bg-red-50 text-red-600 hover:bg-red-100'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          {isControlled && orgao ? (
            <OrgaoRegulamentadorLogo orgao={orgao} className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <TriggerIcon className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{t('recipes.form.mpControl.label')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('recipes.form.mpControl.hint')}</p>
          </div>
          <Switch
            checked={isControlled}
            onCheckedChange={handleToggle}
            aria-label={t('recipes.form.mpControl.label')}
          />
        </div>
        {isControlled && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('recipes.form.mpControl.organ')} *
            </label>
            <Select value={orgao || undefined} onValueChange={handleOrgan}>
              <SelectTrigger className="h-9" aria-invalid={missingOrgan}>
                <SelectValue placeholder={t('recipes.form.mpControl.organPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {ORGAOS_REGULAMENTADORES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    <span className="inline-flex items-center gap-2">
                      <OrgaoRegulamentadorLogo orgao={item.value} className="h-4 w-4" />
                      {item.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
