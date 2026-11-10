import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Save } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import DateInputBr from '@shared/components/ui/DateInputBr';
import { formatCurrency } from '@transbordo/lib/format';
import { Can } from '@industrializacao/lib/rbac/Can';
import { todayISO } from '@painel/lib/faturamentoTarifas';

function moneyInputValue(value) {
  if (value == null || value === '') return '';
  return String(value).replace('.', ',');
}

function parseMoneyInput(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Painel de tarifas vigentes + histórico curto.
 */
export default function FaturamentoTarifasPanel({
  tarifas = [],
  vigente,
  saving = false,
  onSave,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [mov, setMov] = useState('');
  const [tenda, setTenda] = useState('');
  const [patio, setPatio] = useState('');
  const [vigencia, setVigencia] = useState(todayISO());

  useEffect(() => {
    if (!vigente) return;
    setMov(moneyInputValue(vigente.movimentacao_palete));
    setTenda(moneyInputValue(vigente.armazenagem_tenda));
    setPatio(moneyInputValue(vigente.armazenagem_patio));
  }, [vigente]);

  const handleSave = () => {
    onSave?.({
      vigencia_inicio: vigencia || todayISO(),
      movimentacao_palete: parseMoneyInput(mov),
      armazenagem_tenda: parseMoneyInput(tenda),
      armazenagem_patio: parseMoneyInput(patio),
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {t('painel.faturamento.tarifas.title')}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {vigente?.vigencia_inicio
              ? t('painel.faturamento.tarifas.current', {
                  date: formatDateBR(vigente.vigencia_inicio),
                })
              : t('painel.faturamento.tarifas.subtitle')}
            {vigente
              ? ` · ${formatCurrency(vigente.movimentacao_palete)} / ${formatCurrency(vigente.armazenagem_tenda)} / ${formatCurrency(vigente.armazenagem_patio)}`
              : ''}
          </p>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {open ? (
        <div className="border-t border-border px-5 py-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            {t('painel.faturamento.tarifas.subtitle')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.faturamento.tarifas.movimentacao')}
              </Label>
              <Input value={mov} onChange={(e) => setMov(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.faturamento.tarifas.tenda')}
              </Label>
              <Input value={tenda} onChange={(e) => setTenda(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.faturamento.tarifas.patio')}
              </Label>
              <Input value={patio} onChange={(e) => setPatio(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.faturamento.tarifas.vigencia')}
              </Label>
              <DateInputBr value={vigencia} onChange={setVigencia} />
            </div>
          </div>

          <Can permission="painel_faturamento.edit">
            <div className="flex justify-end">
              <Button type="button" onClick={handleSave} disabled={saving} className="gap-2">
                <Save className="h-4 w-4" />
                {saving
                  ? t('painel.faturamento.tarifas.saving')
                  : t('painel.faturamento.tarifas.save')}
              </Button>
            </div>
          </Can>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">
              {t('painel.faturamento.tarifas.history')}
            </p>
            {tarifas.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('painel.faturamento.tarifas.emptyHistory')}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">
                        {t('painel.faturamento.tarifas.vigencia')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('painel.faturamento.tarifas.movimentacao')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('painel.faturamento.tarifas.tenda')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('painel.faturamento.tarifas.patio')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tarifas.slice(0, 8).map((row) => (
                      <tr key={row.id || row.vigencia_inicio} className="border-t border-border">
                        <td className="px-3 py-2">{formatDateBR(row.vigencia_inicio)}</td>
                        <td className="px-3 py-2 text-right">
                          {formatCurrency(row.movimentacao_palete)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatCurrency(row.armazenagem_tenda)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatCurrency(row.armazenagem_patio)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatDateBR(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
