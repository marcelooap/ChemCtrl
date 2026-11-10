import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@shared/components/ui/use-toast';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { entities } from '@transbordo/services/entities';
import { listAgendamentosConcluidos } from '@painel/lib/agendamentosCarregamento';
import {
  apurarFaturamentoEmbalados,
} from '@painel/lib/faturamentoEmbalados';
import {
  canManageFaturamentoTarifaHistory,
  createFaturamentoTarifa,
  currentMonthRange,
  deleteFaturamentoTarifa,
  getTarifaVigente,
  listFaturamentoTarifas,
} from '@painel/lib/faturamentoTarifas';
import { uniqueClientesByNome } from '@painel/lib/recebimentoCatalog';
import FaturamentoTarifasPanel from '@painel/components/faturamento/FaturamentoTarifasPanel';
import FaturamentoFiltros from '@painel/components/faturamento/FaturamentoFiltros';
import FaturamentoKpis from '@painel/components/faturamento/FaturamentoKpis';
import FaturamentoTabela from '@painel/components/faturamento/FaturamentoTabela';
import FaturamentoDetalheModal from '@painel/components/faturamento/FaturamentoDetalheModal';

export default function Faturamento() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useInternalAuth();

  const month = useMemo(() => currentMonthRange(), []);
  const [loading, setLoading] = useState(true);
  const [savingTarifa, setSavingTarifa] = useState(false);

  const [estoque, setEstoque] = useState([]);
  const [saidas, setSaidas] = useState([]);
  const [agendamentos, setAgendamentos] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [tarifas, setTarifas] = useState([]);

  const [clienteId, setClienteId] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState(month.from);
  const [dateTo, setDateTo] = useState(month.to);

  const [viewRow, setViewRow] = useState(null);

  const loadData = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const [estoqueList, saidasList, agendamentosList, produtosList, clientesList, tarifasList] =
          await Promise.all([
            entities.estoque.list('-created_date'),
            entities.saidas.list('-created_date'),
            listAgendamentosConcluidos(),
            entities.produtos.list(),
            entities.clientes.list(),
            listFaturamentoTarifas().catch(() => []),
          ]);
        setEstoque(estoqueList || []);
        setSaidas(saidasList || []);
        setAgendamentos(agendamentosList || []);
        setProdutos(produtosList || []);
        setClientes(uniqueClientesByNome(clientesList || []));
        setTarifas(tarifasList || []);
      } catch (err) {
        console.error('[Faturamento] loadData:', err);
        toast({
          title: t('painel.faturamento.loadErrorTitle'),
          description:
            err?.message || t('painel.faturamento.loadErrorDescription'),
          variant: 'destructive',
        });
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [t, toast]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const clienteNomeSelecionado = useMemo(() => {
    if (!clienteId) return '';
    const found = clientes.find((c) => String(c.id) === String(clienteId));
    return found?.nome || found?.cliente_nome || '';
  }, [clienteId, clientes]);

  const apuracao = useMemo(
    () =>
      apurarFaturamentoEmbalados({
        estoqueItems: estoque,
        saidas,
        agendamentosConcluidos: agendamentos,
        produtos,
        tarifas,
        periodFrom: dateFrom,
        periodTo: dateTo,
        clienteId,
        clienteNome: clienteNomeSelecionado,
        search,
      }),
    [
      estoque,
      saidas,
      agendamentos,
      produtos,
      tarifas,
      dateFrom,
      dateTo,
      clienteId,
      clienteNomeSelecionado,
      search,
    ]
  );

  const vigente = useMemo(() => getTarifaVigente(tarifas), [tarifas]);
  const canManageHistory = useMemo(
    () => canManageFaturamentoTarifaHistory(user),
    [user]
  );

  const handleSaveTarifa = async (payload) => {
    setSavingTarifa(true);
    try {
      await createFaturamentoTarifa({
        ...payload,
        created_by: user?.nome || user?.full_name || user?.email || user?.id || null,
      });
      const next = await listFaturamentoTarifas();
      setTarifas(next || []);
      toast({ title: t('painel.faturamento.tarifas.saved') });
      return true;
    } catch (err) {
      console.error('[Faturamento] saveTarifa:', err);
      toast({
        title: t('painel.faturamento.tarifas.saveError'),
        description: err?.message,
        variant: 'destructive',
      });
      return false;
    } finally {
      setSavingTarifa(false);
    }
  };

  const handleDeleteTarifa = async (row) => {
    if (!canManageHistory || !row?.id) return false;
    setSavingTarifa(true);
    try {
      await deleteFaturamentoTarifa(row.id);
      const next = await listFaturamentoTarifas();
      setTarifas(next || []);
      toast({ title: t('painel.faturamento.tarifas.deleted') });
      return true;
    } catch (err) {
      console.error('[Faturamento] deleteTarifa:', err);
      toast({
        title: t('painel.faturamento.tarifas.deleteError'),
        description: err?.message,
        variant: 'destructive',
      });
      return false;
    } finally {
      setSavingTarifa(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="space-y-3 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t('painel.faturamento.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('painel.faturamento.subtitle')}
          </p>
        </div>

        <FaturamentoTarifasPanel
          tarifas={tarifas}
          vigente={vigente}
          saving={savingTarifa}
          canManageHistory={canManageHistory}
          onSave={handleSaveTarifa}
          onDelete={handleDeleteTarifa}
        />

        <FaturamentoKpis totals={apuracao.totals} />

        <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 border-b border-border/50">
          <FaturamentoFiltros
            clientes={clientes}
            clienteId={clienteId}
            search={search}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onClienteChange={setClienteId}
            onSearchChange={setSearch}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
          />
        </div>

        <FaturamentoTabela rows={apuracao.rows} onView={setViewRow} />
      </div>

      <FaturamentoDetalheModal
        row={viewRow}
        open={Boolean(viewRow)}
        onOpenChange={(open) => {
          if (!open) setViewRow(null);
        }}
      />
    </div>
  );
}
