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
  TESTE_NOME_MAX,
  VALIDADE_TESTES_PRAZO_MAX_DIAS,
  VALIDADE_TESTES_PRAZO_MIN_DIAS,
  validarPrazosPorDestino,
} from '@painel/lib/validadeTestesTanque';

const COLOR_NONE = '__none__';

function emptyTeste() {
  return { key: createTempItemId(), nome: '', dias: '' };
}

/**
 * Destinos da verificação, cada um com Color Cod e a lista de testes
 * (nome + prazo em dias) que o checklist deve conferir.
 *
 * @param {{
 *   rows: Array<{
 *     key: string,
 *     destino: string,
 *     color_cod?: string,
 *     testes: Array<{ key: string, nome: string, dias: string|number }>,
 *   }>,
 *   onChange: (next: Array<object>) => void,
 *   disabled?: boolean,
 *   showErrors?: boolean,
 * }} props
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

  const errorsByRow = useMemo(() => {
    const map = new Map();
    for (const err of validarPrazosPorDestino(rows).errors) {
      const teste = err.testeIndex == null ? null : rows[err.index]?.testes?.[err.testeIndex];
      const typedNome = String(teste?.nome ?? '').trim() !== '';
      const typedPrazo = String(teste?.dias ?? '').trim() !== '';
      const visible =
        err.code === PRAZO_DESTINO_ERROR.DUPLICATE_DESTINO ||
        err.code === PRAZO_DESTINO_ERROR.DUPLICATE_TESTE ||
        showErrors ||
        (err.code === PRAZO_DESTINO_ERROR.TESTE_PRAZO_INVALID && typedPrazo) ||
        (err.code === PRAZO_DESTINO_ERROR.TESTE_NOME_LONG && typedNome);
      if (!visible) continue;
      const mapKey =
        err.testeIndex == null
          ? `${err.index}:${err.field}`
          : `${err.index}:${err.testeIndex}:${err.field}`;
      map.set(mapKey, err.code);
    }
    return map;
  }, [rows, showErrors]);

  const updateRow = (key, patch) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const updateTeste = (rowKey, testeKey, patch) =>
    onChange(
      rows.map((row) =>
        row.key === rowKey
          ? {
              ...row,
              testes: (row.testes || []).map((teste) =>
                teste.key === testeKey ? { ...teste, ...patch } : teste
              ),
            }
          : row
      )
    );

  const removeRow = (key) => onChange(rows.filter((row) => row.key !== key));

  const addRow = () =>
    onChange([
      ...rows,
      { key: createTempItemId(), destino: '', color_cod: '', testes: [emptyTeste()] },
    ]);

  const addTeste = (rowKey) =>
    onChange(
      rows.map((row) =>
        row.key === rowKey ? { ...row, testes: [...(row.testes || []), emptyTeste()] } : row
      )
    );

  const removeTeste = (rowKey, testeKey) =>
    onChange(
      rows.map((row) =>
        row.key === rowKey
          ? { ...row, testes: (row.testes || []).filter((teste) => teste.key !== testeKey) }
          : row
      )
    );

  const destinoErrorText = (code) =>
    code === PRAZO_DESTINO_ERROR.DUPLICATE_DESTINO
      ? t(`${prefix}.duplicateDestino`)
      : t(`${prefix}.destinoRequired`);

  const testeNomeErrorText = (code) => {
    if (code === PRAZO_DESTINO_ERROR.DUPLICATE_TESTE) return t(`${prefix}.duplicateTeste`);
    if (code === PRAZO_DESTINO_ERROR.TESTE_NOME_LONG) {
      return t(`${prefix}.testeNomeLong`, { max: TESTE_NOME_MAX });
    }
    return t(`${prefix}.testeNomeRequired`);
  };

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
            const testesError = errorsByRow.get(`${index}:testes`);
            const colorId = `${baseId}-color-${row.key}`;
            const colorValue = row.color_cod || '';
            const colorClass = COLOR_COD_TEXT_CLASS[colorValue] || '';
            const testes = row.testes || [];
            return (
              <li key={row.key} className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-start">
                  <div className="min-w-0">
                    <Label className="text-xs font-medium">{t(`${prefix}.destinoLabel`)}</Label>
                    <div className="mt-1.5">
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
                    <Label htmlFor={colorId} className="text-xs font-medium">
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
                        className={cn('mt-1.5 h-9 font-semibold', colorClass)}
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
                    className="shrink-0 justify-self-end text-muted-foreground hover:text-destructive sm:mt-[1.625rem]"
                    disabled={disabled}
                    onClick={() => removeRow(row.key)}
                    aria-label={t(`${prefix}.remove`)}
                    title={t(`${prefix}.remove`)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <p className="text-xs font-semibold text-foreground">{t(`${prefix}.testesTitle`)}</p>
                  {testes.length === 0 ? (
                    <p
                      role={testesError ? 'alert' : undefined}
                      className={cn(
                        'rounded-md border border-dashed px-3 py-2 text-xs',
                        testesError
                          ? 'border-destructive/40 text-destructive'
                          : 'border-border text-muted-foreground'
                      )}
                    >
                      {t(`${prefix}.testesRequired`)}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {testes.map((teste, testeIndex) => {
                        const nomeError = errorsByRow.get(`${index}:${testeIndex}:nome`);
                        const prazoError = errorsByRow.get(`${index}:${testeIndex}:dias`);
                        const nomeId = `${baseId}-nome-${teste.key}`;
                        const prazoId = `${baseId}-prazo-${teste.key}`;
                        const labelClass =
                          testeIndex === 0 ? 'text-xs font-medium' : 'text-xs font-medium sm:sr-only';
                        return (
                          <li
                            key={teste.key}
                            className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-start"
                          >
                            <div className="min-w-0">
                              <Label htmlFor={nomeId} className={labelClass}>
                                {t(`${prefix}.testeNomeLabel`)}
                              </Label>
                              <Input
                                id={nomeId}
                                value={teste.nome}
                                maxLength={TESTE_NOME_MAX}
                                disabled={disabled}
                                placeholder={t(`${prefix}.testeNomePlaceholder`)}
                                onChange={(e) =>
                                  updateTeste(row.key, teste.key, { nome: e.target.value })
                                }
                                aria-invalid={Boolean(nomeError)}
                                className={cn(
                                  'h-9',
                                  testeIndex === 0 ? 'mt-1.5' : 'mt-1.5 sm:mt-0',
                                  nomeError && 'border-destructive'
                                )}
                              />
                              {nomeError ? (
                                <p role="alert" className="mt-1 text-xs text-destructive">
                                  {testeNomeErrorText(nomeError)}
                                </p>
                              ) : null}
                            </div>

                            <div>
                              <Label htmlFor={prazoId} className={labelClass}>
                                {t(`${prefix}.testePrazoLabel`)}
                              </Label>
                              <Input
                                id={prazoId}
                                type="number"
                                inputMode="numeric"
                                min={VALIDADE_TESTES_PRAZO_MIN_DIAS}
                                max={VALIDADE_TESTES_PRAZO_MAX_DIAS}
                                step={1}
                                value={teste.dias}
                                disabled={disabled}
                                onChange={(e) =>
                                  updateTeste(row.key, teste.key, { dias: e.target.value })
                                }
                                aria-invalid={Boolean(prazoError)}
                                className={cn(
                                  'h-9',
                                  testeIndex === 0 ? 'mt-1.5' : 'mt-1.5 sm:mt-0',
                                  prazoError && 'border-destructive'
                                )}
                              />
                              {prazoError ? (
                                <p role="alert" className="mt-1 text-xs text-destructive">
                                  {t(
                                    'painel.configuracao.checklistExpedicao.validadeTestes.prazoInvalid',
                                    {
                                      min: VALIDADE_TESTES_PRAZO_MIN_DIAS,
                                      max: VALIDADE_TESTES_PRAZO_MAX_DIAS,
                                    }
                                  )}
                                </p>
                              ) : null}
                            </div>

                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className={cn(
                                'shrink-0 justify-self-end text-muted-foreground hover:text-destructive',
                                testeIndex === 0 && 'sm:mt-[1.625rem]'
                              )}
                              disabled={disabled}
                              onClick={() => removeTeste(row.key, teste.key)}
                              aria-label={t(`${prefix}.removeTeste`)}
                              title={t(`${prefix}.removeTeste`)}
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
                    className="gap-2"
                    onClick={() => addTeste(row.key)}
                    disabled={disabled}
                  >
                    <Plus className="w-4 h-4" />
                    {t(`${prefix}.addTeste`)}
                  </Button>
                </div>
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
