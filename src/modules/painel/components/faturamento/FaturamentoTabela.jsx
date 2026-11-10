import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { RowActionButton } from '@shared/components/ui/RowActionButton';
import { formatCurrency } from '@transbordo/lib/format';
import { ORIGEM_ENTRADA, ORIGEM_ESTOQUE } from '@painel/lib/faturamentoEmbalados';

const PAGE_SIZE = 25;

function MoneyBadge({ value, dash, tone }) {
  if (value == null) {
    return <span className="text-muted-foreground">{dash}</span>;
  }
  const tones = {
    orange:
      'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200',
    blue: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
    green:
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${tones[tone] || tones.orange}`}
    >
      {formatCurrency(value)}
    </span>
  );
}

function origemBadgeClass(origem) {
  if (origem === ORIGEM_ENTRADA) {
    return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200';
  }
  if (origem === ORIGEM_ESTOQUE) {
    return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200';
  }
  return 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200';
}

function origemLabelKey(origem) {
  if (origem === ORIGEM_ENTRADA) return 'entrada';
  if (origem === ORIGEM_ESTOQUE) return 'estoque';
  return 'saida';
}

function formatDateBR(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export default function FaturamentoTabela({ rows = [], onView }) {
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
      } else {
        av = String(a.data || '');
        bv = String(b.data || '');
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
  const dash = t('painel.faturamento.table.dash');

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'data' ? 'desc' : 'asc');
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
          {t('painel.faturamento.table.title')}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t('painel.faturamento.table.count', { count: rows.length })}
        </p>
      </div>

      <div className="overflow-x-auto">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <p className="text-sm text-muted-foreground">
              {t('painel.faturamento.table.empty')}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/80 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">
                  {t('painel.faturamento.table.id')}
                </th>
                <th className="px-3 py-2.5 text-left font-medium">
                  <SortHeader id="data" label={t('painel.faturamento.table.data')} />
                </th>
                <th className="px-3 py-2.5 text-left font-medium">
                  {t('painel.faturamento.table.origem')}
                </th>
                <th className="px-3 py-2.5 text-left font-medium">
                  {t('painel.faturamento.table.cod')}
                </th>
                <th className="px-3 py-2.5 text-left font-medium">
                  <SortHeader id="produto" label={t('painel.faturamento.table.produto')} />
                </th>
                <th className="px-3 py-2.5 text-left font-medium">
                  {t('painel.faturamento.table.lote')}
                </th>
                <th className="px-3 py-2.5 text-left font-medium">
                  <SortHeader id="cliente" label={t('painel.faturamento.table.cliente')} />
                </th>
                <th className="px-3 py-2.5 text-left font-medium">
                  {t('painel.faturamento.table.local')}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {t('painel.faturamento.table.movimentacao')}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {t('painel.faturamento.table.armazenagem')}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  <SortHeader id="total" label={t('painel.faturamento.table.total')} />
                </th>
                <th className="px-3 py-2.5 text-center font-medium">
                  {t('painel.faturamento.table.acoes')}
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const pendingList = row.pendencias || [];
                const pending = pendingList.length > 0;
                const pendingTitle = pending
                  ? pendingList
                      .map((p) =>
                        t(`painel.faturamento.modal.pendencia.${p}`, {
                          defaultValue: t('painel.faturamento.table.pending'),
                        })
                      )
                      .join(' · ')
                  : '';
                return (
                  <tr
                    key={row.key}
                    className={`border-t border-border hover:bg-muted/30 ${
                      pending ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        {row.id}
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
                      {formatDateBR(row.data) || dash}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium ${origemBadgeClass(
                          row.origem
                        )}`}
                      >
                        {t(`painel.faturamento.table.${origemLabelKey(row.origem)}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.codigo || dash}</td>
                    <td className="px-3 py-2.5 max-w-[200px] truncate" title={row.produto}>
                      {row.produto || dash}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.lote || dash}</td>
                    <td className="px-3 py-2.5 max-w-[160px] truncate" title={row.cliente}>
                      {row.cliente || dash}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.local || dash}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <MoneyBadge value={row.movimentacao} dash={dash} tone="orange" />
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <MoneyBadge value={row.armazenagem} dash={dash} tone="blue" />
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <MoneyBadge value={row.total} dash={dash} tone="green" />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <RowActionButton
                        title={t('painel.faturamento.table.view')}
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
            {t('painel.faturamento.pagination.page', {
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
              {t('painel.faturamento.pagination.prev')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="gap-1"
            >
              {t('painel.faturamento.pagination.next')}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
