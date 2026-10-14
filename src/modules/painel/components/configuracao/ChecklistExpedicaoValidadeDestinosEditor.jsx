import { useId, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { cn } from '@shared/lib/utils';
import SaidaDestinoSelect from '@transbordo/components/saida/SaidaDestinoSelect';
import { createTempItemId } from '@painel/lib/checklistExpedicaoConfig';
import {
  COLOR_COD_TEXT_CLASS,
  COLOR_COD_VALUES,
  PRAZO_DESTINO_ERROR,
  VALIDADE_TESTES_PRAZO_MAX_DIAS,
  VALIDADE_TESTES_PRAZO_MIN_DIAS,
  validarPrazosPorDestino,
} from '@painel/lib/validadeTestesTanque';

const COLOR_NONE = '__none__';

/**
 * Linhas "Destino + Prazo de validade + Color Cod" do item de validade dos testes.
 * O destino usa o mesmo seletor (lista e comportamento) da Solicitação de Saída.
 *
 * @param {{
 *   rows: Array<{ key: string, destino: string, dias: string|number, color_cod?: string }>,
 *   onChange: (next: Array<{ key: string, destino: string, dias: string|number, color_cod?: string }>) => void,
 *   disabled?: boolean,
 *   showErrors?: boolean,
 * }} props `showErrors` exibe também campos obrigatórios ainda vazios (após tentar salvar).
 */
export default function ChecklistExpedicaoValidadeDestinosEditor({
  rows,
  onChange,
  disabled = false,
  showErrors = false,
}) {
  const { t } = useTranslation();
  const baseId = useId();
  const prefix = 'painel.configuracao.checklistExpedicao.validadeTestes.destinos';

  // Duplicidade é sempre sinalizada; campo vazio/inválido só após tentar salvar ou ao digitar.
  const errorsByRow = useMemo(() => {
    const map = new Map();
    for (const err of validarPrazosPorDestino(rows).errors) {
      const row = rows[err.index];
      const typedPrazo = String(row?.dias ?? '').trim() !== '';
      const visible =
        err.code === PRAZO_DESTINO_ERROR.DUPLICATE_DESTINO ||
        showErrors ||
        (err.code === PRAZO_DESTINO_ERROR.PRAZO_INVALID && typedPrazo);
      if (visible) map.set(`${err.index}:${err.field}`, err.code);
    }
    return map;
  }, [rows, showErrors]);

  const updateRow = (key, patch) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const removeRow = (key) => onChange(rows.filter((row) => row.key !== key));

  const addRow = () =>
    onChange([...rows, { key: createTempItemId(), destino: '', dias: '', color_cod: '' }]);

  const destinoErrorText = (code) =>
    code === PRAZO_DESTINO_ERROR.DUPLICATE_DESTINO
      ? t(`${prefix}.duplicateDestino`)
      : t(`${prefix}.destinoRequired`);

  const colorLabel = (value) =>
    t(`${prefix}.colorOptions.${value}`, {
      defaultValue: value,
    });

  return (
    <div className="mt-5 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-foreground">{t(`${prefix}.title`)}</h3>
      <p className="text-xs text-muted-foreground mt-0.5">{t(`${prefix}.hint`)}</p>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          {t(`${prefix}.empty`)}
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((row, index) => {
            const destinoError = errorsByRow.get(`${index}:destino`);
            const prazoError = errorsByRow.get(`${index}:dias`);
            const prazoId = `${baseId}-prazo-${row.key}`;
            const colorId = `${baseId}-color-${row.key}`;
            const labelClass = index === 0 ? 'text-xs font-medium' : 'text-xs font-medium sm:sr-only';
            const colorValue = row.color_cod || '';
            const colorClass = COLOR_COD_TEXT_CLASS[colorValue] || '';
            return (
              <li
                key={row.key}
                className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.2fr)_9rem_9.5rem_auto] sm:items-start"
              >
                <div className="min-w-0">
                  <Label className={labelClass}>{t(`${prefix}.destinoLabel`)}</Label>
                  <div className={index === 0 ? 'mt-1.5' : 'mt-1.5 sm:mt-0'}>
                    <SaidaDestinoSelect
                      allowBlank={false}
                      value={row.destino}
                      onChange={(destino) => updateRow(row.key, { destino })}
                      disabled={disabled}
                      placeholder={t(`${prefix}.destinoPlaceholder`)}
                      ariaLabel={t(`${prefix}.destinoLabel`)}
                      inputClassName={destinoError ? 'border-destructive' : ''}
                    />
                  </div>
                  {destinoError ? (
                    <p role="alert" className="mt-1 text-xs text-destructive">
                      {destinoErrorText(destinoError)}
                    </p>
                  ) : null}
                </div>

                <div>
                  <Label htmlFor={prazoId} className={labelClass}>
                    {t(`${prefix}.prazoLabel`)}
                  </Label>
                  <Input
                    id={prazoId}
                    type="number"
                    inputMode="numeric"
                    min={VALIDADE_TESTES_PRAZO_MIN_DIAS}
                    max={VALIDADE_TESTES_PRAZO_MAX_DIAS}
                    step={1}
                    value={row.dias}
                    disabled={disabled}
                    onChange={(e) => updateRow(row.key, { dias: e.target.value })}
                    aria-invalid={Boolean(prazoError)}
                    className={`${index === 0 ? 'mt-1.5' : 'mt-1.5 sm:mt-0'} h-9 ${
                      prazoError ? 'border-destructive' : ''
                    }`}
                  />
                  {prazoError ? (
                    <p role="alert" className="mt-1 text-xs text-destructive">
                      {t('painel.configuracao.checklistExpedicao.validadeTestes.prazoInvalid', {
                        min: VALIDADE_TESTES_PRAZO_MIN_DIAS,
                        max: VALIDADE_TESTES_PRAZO_MAX_DIAS,
                      })}
                    </p>
                  ) : null}
                </div>

                <div>
                  <Label htmlFor={colorId} className={labelClass}>
                    {t(`${prefix}.colorCodLabel`)}
                  </Label>
                  <Select
                    value={colorValue || COLOR_NONE}
                    disabled={disabled}
                    onValueChange={(v) =>
                      updateRow(row.key, { color_cod: v === COLOR_NONE ? '' : v })
                    }
                  >
                    <SelectTrigger
                      id={colorId}
                      className={cn(
                        index === 0 ? 'mt-1.5' : 'mt-1.5 sm:mt-0',
                        'h-9 font-semibold',
                        colorClass
                      )}
                    >
                      <SelectValue placeholder={t(`${prefix}.colorCodPlaceholder`)} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={COLOR_NONE} className="text-muted-foreground">
                        {t(`${prefix}.colorCodPlaceholder`)}
                      </SelectItem>
                      {COLOR_COD_VALUES.map((value) => (
                        <SelectItem
                          key={value}
                          value={value}
                          className={cn('font-semibold', COLOR_COD_TEXT_CLASS[value])}
                        >
                          {colorLabel(value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={`shrink-0 justify-self-end text-muted-foreground hover:text-destructive ${
                    index === 0 ? 'sm:mt-[1.625rem]' : ''
                  }`}
                  disabled={disabled}
                  onClick={() => removeRow(row.key)}
                  aria-label={t(`${prefix}.remove`)}
                  title={t(`${prefix}.remove`)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 gap-2"
        onClick={addRow}
        disabled={disabled}
      >
        <Plus className="w-4 h-4" />
        {t(`${prefix}.add`)}
      </Button>
    </div>
  );
}
