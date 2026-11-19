import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Eye, Search, X } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { RowActionButton } from '@shared/components/ui/RowActionButton';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import DateInputBr from '@shared/components/ui/DateInputBr';
import { useToast } from '@shared/components/ui/use-toast';
import { ServerPaginationBar } from '@shared/components/ServerPaginationBar';
import { DEFAULT_PAGE_SIZE } from '@shared/lib/pagination';
import { useDebouncedValue } from '@shared/hooks/useDebouncedValue';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import TransbordoViewDialog from '@transbordo/components/transbordo/TransbordoViewDialog';
import ProductionViewDialog from '@industrializacao/components/production/ProductionViewDialog';
import TransferViewDialog from '@industrializacao/components/transbordo/TransferViewDialog';
import { listProdutos } from '@transbordo/lib/cadastroProdutosCentral';
import { listTankas } from '@transbordo/lib/cadastroTankaCentral';
import { entities } from '@transbordo/services/entities';
import { base44 } from '@industrializacao/api/base44Client';
import { getLatestRecipeForProduct } from '@industrializacao/lib/recipeRevisions';
import { fmtDate } from '@/i18n/formatters';
import {
  OPERACAO,
  OPERACAO_BADGE_CLASS,
  OPERACAO_LABEL_KEY,
  ORIGEM_FLUXO,
  emptyQuitacaoOtTotals,
  formatVolumeQuitacao,
  getQuitacaoOtDetail,
  listQuitacaoOt,
  listQuitacaoOtClientes,
} from '@painel/lib/quitacaoOt';

const CLIENT_ALL = 'todos';

function QuitacaoOtTotalsCards({ totals }) {
  const { t } = useTranslation();
  const items = [
    {
      key: OPERACAO.INDUSTRIALIZACAO,
      value: totals?.[OPERACAO.INDUSTRIALIZACAO] || 0,
      valueClass: 'text-sky-700',
      cardClass: OPERACAO_BADGE_CLASS[OPERACAO.INDUSTRIALIZACAO],
      dotClass: 'bg-sky-500',
    },
    {
      key: OPERACAO.FILTRACAO,
      value: totals?.[OPERACAO.FILTRACAO] || 0,
      valueClass: 'text-violet-700',
      cardClass: OPERACAO_BADGE_CLASS[OPERACAO.FILTRACAO],
      dotClass: 'bg-violet-500',
    },
    {
      key: OPERACAO.CONVENCIONAL,
      value: totals?.[OPERACAO.CONVENCIONAL] || 0,
      valueClass: 'text-orange-700',
      cardClass: OPERACAO_BADGE_CLASS[OPERACAO.CONVENCIONAL],
      dotClass: 'bg-orange-500',
    },
  ];

  return (
    <div className="flex flex-wrap items-stretch justify-end gap-2.5">
      {items.map((item) => (
        <div
          key={item.key}
          className={`rounded-xl border px-4 py-2.5 shadow-sm min-w-[148px] ${item.cardClass}`}
        >
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-80 mb-0.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.dotClass}`} aria-hidden />
            {t(OPERACAO_LABEL_KEY[item.key])}
          </p>
          <p className={`text-lg font-semibold tabular-nums leading-tight ${item.valueClass}`}>
            {formatVolumeQuitacao(item.value)}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function QuitacaoOT() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState(() => emptyQuitacaoOtTotals());
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [cliente, setCliente] = useState(CLIENT_ALL);
  const [clientOptions, setClientOptions] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [viewLoading, setViewLoading] = useState(false);
  const [viewTransbordo, setViewTransbordo] = useState(null);
  const [viewTransbordoCtx, setViewTransbordoCtx] = useState({
    produtos: [],
    entradas: [],
    isotanques: [],
    vasilhames: [],
  });
  const [viewProduction, setViewProduction] = useState(null);
  const [viewProductionContainers, setViewProductionContainers] = useState([]);
  const [viewTransfer, setViewTransfer] = useState(null);
  const [viewTransferCtx, setViewTransferCtx] = useState({
    density: 0,
    recipeCode: '',
    containers: [],
  });

  useEffect(() => {
    let cancelled = false;
    listQuitacaoOtClientes()
      .then((names) => {
        if (!cancelled) setClientOptions(names || []);
      })
      .catch(() => {
        if (!cancelled) setClientOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listQuitacaoOt({
        search: debouncedSearch,
        cliente: cliente === CLIENT_ALL ? '' : cliente,
        dateFrom,
        dateTo,
        page,
        pageSize: DEFAULT_PAGE_SIZE,
        sortDir: 'desc',
      });
      setRows(result.rows || []);
      setTotal(result.total || 0);
      setTotals(result.totals || emptyQuitacaoOtTotals());
    } catch (err) {
      console.error('[QuitacaoOT] loadRows:', err);
      toast({
        title: t('painel.operacional.quitacaoOt.loadErrorTitle'),
        description: err?.message || t('painel.operacional.quitacaoOt.loadErrorDescription'),
        variant: 'destructive',
      });
      setRows([]);
      setTotal(0);
      setTotals(emptyQuitacaoOtTotals());
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, cliente, dateFrom, dateTo, page, t, toast]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, cliente, dateFrom, dateTo]);

  const clearFilters = () => {
    setSearch('');
    setCliente(CLIENT_ALL);
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const hasFilters =
    Boolean(search.trim()) ||
    cliente !== CLIENT_ALL ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const closeAllViews = () => {
    setViewTransbordo(null);
    setViewProduction(null);
    setViewTransfer(null);
  };

  const handleView = async (row) => {
    if (!row?.record_id || viewLoading) return;
    setViewLoading(true);
    closeAllViews();
    try {
      const detail = await getQuitacaoOtDetail(row.origem_fluxo, row.record_id);
      if (!detail) {
        toast({
          title: t('painel.operacional.quitacaoOt.detailNotFound'),
          variant: 'destructive',
        });
        return;
      }

      if (row.origem_fluxo === ORIGEM_FLUXO.TRANSBORDO) {
        const [produtos, entradas, isotanques, vasilhames] = await Promise.all([
          listProdutos().catch(() => []),
          entities.estoque.list().catch(() => []),
          listTankas().catch(() => []),
          entities.vasilhames.list().catch(() => []),
        ]);
        setViewTransbordoCtx({
          produtos: produtos || [],
          entradas: entradas || [],
          isotanques: isotanques || [],
          vasilhames: vasilhames || [],
        });
        setViewTransbordo(detail);
        return;
      }

      if (row.origem_fluxo === ORIGEM_FLUXO.PRODUCAO) {
        let containers = [];
        try {
          if (detail.op_number) {
            containers = await base44.entities.Container.filter({
              op_number: detail.op_number,
            });
          }
        } catch {
          containers = [];
        }
        setViewProductionContainers(Array.isArray(containers) ? containers : []);
        setViewProduction(detail);
        return;
      }

      if (row.origem_fluxo === ORIGEM_FLUXO.TRANSBORDO_IND) {
        const [recipes, containers] = await Promise.all([
          base44.entities.Recipe.list('-created_date', 500).catch(() => []),
          base44.entities.Container.list('-created_date', 500).catch(() => []),
        ]);
        const recipe = getLatestRecipeForProduct(recipes || [], detail.product);
        setViewTransferCtx({
          density: Number(recipe?.density) || 0,
          recipeCode: String(recipe?.code || '').trim(),
          containers: Array.isArray(containers) ? containers : [],
        });
        setViewTransfer(detail);
      }
    } catch (err) {
      console.error('[QuitacaoOT] handleView:', err);
      toast({
        title: t('painel.operacional.quitacaoOt.detailErrorTitle'),
        description: err?.message || t('painel.operacional.quitacaoOt.detailErrorDescription'),
        variant: 'destructive',
      });
    } finally {
      setViewLoading(false);
    }
  };

  const formatRowDate = (value) => {
    if (!value) return '—';
    try {
      return fmtDate(value, undefined, i18n.language) || '—';
    } catch {
      return String(value).slice(0, 10);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">
            {t('painel.operacional.sections.quitacaoOt.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('painel.operacional.sections.quitacaoOt.subtitle')}
          </p>
        </div>
        <QuitacaoOtTotalsCards totals={totals} />
      </div>

      <div className="flex-1 min-h-0 bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col">
        <div className="shrink-0 px-5 py-3 border-b border-border flex flex-col gap-3">
          <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="text-sm font-semibold text-foreground">
              {t('painel.operacional.quitacaoOt.tableTitle')}
            </h2>
            <span className="text-xs text-muted-foreground">
              {t('painel.operacional.quitacaoOt.tableCount', { count: total })}
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-2 w-full">
            <div className="relative w-full sm:w-[22rem] min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('painel.operacional.quitacaoOt.filters.searchPlaceholder')}
                className="pl-9 h-9"
              />
            </div>

            <div className="space-y-1 min-w-[14rem]">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.operacional.quitacaoOt.filters.client')}
              </Label>
              <Select value={cliente} onValueChange={setCliente}>
                <SelectTrigger className="h-9 w-full min-w-[14rem]">
                  <SelectValue
                    placeholder={t('painel.operacional.quitacaoOt.filters.clientPlaceholder')}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CLIENT_ALL}>
                    {t('painel.operacional.quitacaoOt.filters.allClients')}
                  </SelectItem>
                  {clientOptions.map((nome) => (
                    <SelectItem key={nome} value={nome}>
                      {nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.operacional.quitacaoOt.filters.dateFrom')}
              </Label>
              <DateInputBr value={dateFrom} onChange={setDateFrom} className="w-[160px]" />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t('painel.operacional.quitacaoOt.filters.dateTo')}
              </Label>
              <DateInputBr value={dateTo} onChange={setDateTo} className="w-[160px]" />
            </div>

            {hasFilters ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-muted-foreground"
                onClick={clearFilters}
                title={t('painel.operacional.quitacaoOt.filters.clear')}
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="overflow-auto flex-1 min-h-0">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
            </div>
          ) : (
            <table className="w-full text-sm table-auto">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground sticky top-0 z-10">
                  <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                    {t('painel.operacional.quitacaoOt.columns.id')}
                  </th>
                  <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                    {t('painel.operacional.quitacaoOt.columns.operacao')}
                  </th>
                  <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                    {t('painel.operacional.quitacaoOt.columns.date')}
                  </th>
                  <th className="px-3 py-2.5 font-semibold">
                    {t('painel.operacional.quitacaoOt.columns.product')}
                  </th>
                  <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                    {t('painel.operacional.quitacaoOt.columns.client')}
                  </th>
                  <th className="px-3 py-2.5 font-semibold whitespace-nowrap text-right">
                    {t('painel.operacional.quitacaoOt.columns.volume')}
                  </th>
                  <th className="px-3 py-2.5 font-semibold">
                    {t('painel.operacional.quitacaoOt.columns.operators')}
                  </th>
                  <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                    {t('painel.operacional.quitacaoOt.columns.dePara')}
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-center whitespace-nowrap">
                    {t('painel.operacional.quitacaoOt.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">
                      {t('painel.operacional.quitacaoOt.empty')}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    return (
                      <tr
                        key={row.row_key}
                        className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                      >
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap">
                          <span className="font-semibold text-primary text-sm">
                            {row.id_exibido}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${row.operacao_badge_class}`}
                          >
                            {t(row.operacao_label_key)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 align-middle text-muted-foreground whitespace-nowrap">
                          {formatRowDate(row.operation_at)}
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <span className="block truncate max-w-[18rem]" title={row.produto_label}>
                            {row.produto_label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 align-middle text-muted-foreground whitespace-nowrap">
                          {row.cliente}
                        </td>
                        <td className="px-3 py-2.5 align-middle text-right font-medium whitespace-nowrap">
                          {row.volume_label}
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          {Array.isArray(row.operadores) && row.operadores.length > 0 ? (
                            <div
                              className="flex flex-nowrap items-center gap-1 overflow-hidden max-w-[14rem]"
                              title={row.operadores_label}
                            >
                              {row.operadores.slice(0, 2).map((op) => {
                                const full = typeof op === 'string' ? op : op?.nome || op?.name || '';
                                const first = String(full).trim().split(/\s+/)[0] || full;
                                return (
                                  <span
                                    key={`${row.row_key}-${full}`}
                                    className="inline-flex shrink-0 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium whitespace-nowrap"
                                  >
                                    {first}
                                  </span>
                                );
                              })}
                              {row.operadores.length > 2 ? (
                                <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                                  +{row.operadores.length - 2}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap">
                          {row.de_para?.label === '—' ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-sm">
                              <span>{row.de_para?.de}</span>
                              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <span>{row.de_para?.para}</span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-middle text-center">
                          <RowActionButton
                            onClick={() => handleView(row)}
                            title={t('painel.operacional.quitacaoOt.view')}
                            disabled={viewLoading}
                          >
                            <Eye />
                          </RowActionButton>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        <ServerPaginationBar
          page={page}
          pageSize={DEFAULT_PAGE_SIZE}
          total={total}
          onPageChange={setPage}
        />
      </div>

      <TransbordoViewDialog
        open={Boolean(viewTransbordo)}
        onClose={() => setViewTransbordo(null)}
        transbordo={viewTransbordo}
        produtos={viewTransbordoCtx.produtos}
        entradas={viewTransbordoCtx.entradas}
        isotanques={viewTransbordoCtx.isotanques}
        vasilhames={viewTransbordoCtx.vasilhames}
      />

      <ProductionViewDialog
        production={viewProduction}
        containers={viewProductionContainers}
        open={Boolean(viewProduction)}
        onOpenChange={(open) => {
          if (!open) setViewProduction(null);
        }}
        simplified
      />

      {viewTransfer ? (
        <TransferViewDialog
          transfer={viewTransfer}
          density={viewTransferCtx.density}
          recipeCode={viewTransferCtx.recipeCode}
          containers={viewTransferCtx.containers}
          onClose={() => setViewTransfer(null)}
        />
      ) : null}
    </div>
  );
}
