import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { RowActionButton } from '@shared/components/ui/RowActionButton';
import { formatCurrency } from '@transbordo/lib/format';
import { STATUS_NO_PATIO } from '@painel/lib/faturamentoVasilhames';

const PAGE_SIZE = 25;

function formatDateBR(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function formatVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} L`;
}

export default function FaturamentoVasilhamesTabela({ rows = [], onView }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState('data');
  const [sortDir, setSortDir] = useState('desc');

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      let av;
      let bv;
      if (sortKey === 'total') {
        av = a.totalCents || 0;
        bv = b.totalCents || 0;
      } else if (sortKey === 'cliente') {
        av = String(a.cliente || '').toLowerCase();
        bv = String(b.cliente || '').toLowerCase();
      } else if (sortKey === 'produto') {
        av = String(a.produto || '').toLowerCase();
        bv = String(b.produto || '').toLowerCase();
      } else if (sortKey === 'dias') {
        av = a.diasPatio || 0;
        bv = b.diasPatio || 0;
      } else {
        av = String(a.dataEnvase || a.data || '');
        bv = String(b.dataEnvase || b.data || '');
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const dash = t('painel.faturamentoVasilhames.table.dash');

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'data' || key === 'total' || key === 'dias' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const SortHeader = ({ id, label }) => (
    <button
      type="button"
      onClick={() => toggleSort(id)}
      className="inline-flex items-center gap-1 hover:text-foreground"
    >
      {label}
      {sortKey === id ? (
        <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
      ) : null}
    </button>
  );

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col">
      <div className="shrink-0 px-5 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">
          {t('painel.faturamentoVasilhames.table.title')}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t('painel.faturamentoVasilhames.table.count', { count: rows.length })}
        </p>
      </div>

      <div className="overflow-x-auto">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <p className="text-sm text-muted-foreground">
              {t('painel.faturamentoVasilhames.table.empty')}
            </p>
          </div>
        ) : (
          <table className="w-max min-w-full text-sm">
            <thead className="bg-muted/80 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                  {t('painel.faturamentoVasilhames.table.id')}
                </th>
                <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                  <SortHeader
                    id="data"
                    label={t('painel.faturamentoVasilhames.table.dataEnvase')}
                  />
                </th>
                <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                  {t('painel.faturamentoVasilhames.table.placa')}
                </th>
                <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                  {t('painel.faturamentoVasilhames.table.barril')}
                </th>
                <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                  {t('painel.faturamentoVasilhames.table.cod')}
                </th>
                <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                  <SortHeader
                    id="produto"
                    label={t('painel.faturamentoVasilhames.table.produto')}
                  />
                </th>
                <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                  <SortHeader
                    id="cliente"
                    label={t('painel.faturamentoVasilhames.table.cliente')}
                  />
                </th>
                <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                  {t('painel.faturamentoVasilhames.table.loteVolume')}
                </th>
                <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                  {t('painel.faturamentoVasilhames.table.status')}
                </th>
                <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                  {t('painel.faturamentoVasilhames.table.dataSaida')}
                </th>
                <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                  <SortHeader
                    id="dias"
                    label={t('painel.faturamentoVasilhames.table.diasPatio')}
                  />
                </th>
                <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                  <SortHeader
                    id="total"
                    label={t('painel.faturamentoVasilhames.table.total')}
                  />
                </th>
                <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">
                  {t('painel.faturamentoVasilhames.table.acoes')}
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const pending = (row.pendencias || []).length > 0;
                const pendingTitle = pending
                  ? t('painel.faturamentoVasilhames.table.capacidadeNaoIdentificada')
                  : '';
                const noPatio = row.status === STATUS_NO_PATIO;
                return (
                  <tr
                    key={row.key}
                    className={`border-t border-border hover:bg-muted/30 ${
                      pending ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="font-semibold text-primary"
                          title={row.registroId || row.id}
                        >
                          {row.id || dash}
                        </span>
                        {pending ? (
                          <AlertTriangle
                            className="h-3.5 w-3.5 text-amber-600 shrink-0"
                            title={pendingTitle}
                            aria-label={pendingTitle}
                          />
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                      {formatDateBR(row.dataEnvase) || dash}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.placa || dash}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.barril || dash}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.codigo || dash}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.produto || dash}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.cliente || dash}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {formatVolume(row.loteVolume) || dash}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium ${
                          noPatio
                            ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200'
                            : 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200'
                        }`}
                      >
                        {noPatio
                          ? t('painel.faturamentoVasilhames.table.noPatio')
                          : t('painel.faturamentoVasilhames.table.expedido')}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                      {formatDateBR(row.dataSaida) || dash}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {row.diasPatio ?? dash}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {pending ? (
                        <span className="text-muted-foreground">{dash}</span>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                          {formatCurrency(row.total)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <RowActionButton
                        title={t('painel.faturamentoVasilhames.table.view')}
                        onClick={() => onView?.(row)}
                      >
                        <Eye />
                      </RowActionButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {sorted.length > PAGE_SIZE ? (
        <div className="shrink-0 border-t border-border px-4 py-2.5 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {t('painel.faturamentoVasilhames.pagination.page', {
              page: safePage,
              total: totalPages,
            })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="gap-1"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {t('painel.faturamentoVasilhames.pagination.prev')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="gap-1"
            >
              {t('painel.faturamentoVasilhames.pagination.next')}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
