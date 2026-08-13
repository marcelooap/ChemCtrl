import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cylinder, Eye, Package, Pencil, Search } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { useToast } from '@shared/components/ui/use-toast';
import SearchableSelect from '@transbordo/components/cadastro/SearchableSelect';
import { entities } from '@transbordo/services/entities';
import {
  computeEstoqueSaldo,
  getEstoqueQuantidade,
  getEstoqueUnidade,
  hydrateEstoqueFiscal,
} from '@transbordo/lib/estoqueSaldo';
import { isEstoqueEmbalagemUnitaria } from '@transbordo/lib/transbordoEmbalado';
import { resolveTipoRecebimentoEstoque } from '@transbordo/lib/tipoRecebimento';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { Can } from '@industrializacao/lib/rbac/Can';
import ReservaEditModal from '@painel/components/comercial/ReservaEditModal';
import ReservaViewModal from '@painel/components/comercial/ReservaViewModal';
import VasilhamesReservaTable from '@painel/components/comercial/VasilhamesReservaTable';
import {
  aggregateEstoqueByLote,
  formatQty,
  setSaldoReservado,
} from '@painel/lib/materialReservas';
import {
  buildVasilhameReservaRows,
  loadIndustrializacaoVasilhames,
} from '@painel/lib/vasilhameReservas';

const TAB_TRIGGER_CLASS =
  'gap-2 px-5 py-2.5 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md';

export default function ReservarMaterial() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useInternalAuth();

  const [tab, setTab] = useState('embalados');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [vasilhameRows, setVasilhameRows] = useState([]);
  const [indProductions, setIndProductions] = useState([]);
  const [indRecipes, setIndRecipes] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [search, setSearch] = useState('');
  const [clienteFilter, setClienteFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editRow, setEditRow] = useState(null);
  const [viewRow, setViewRow] = useState(null);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [ests, trans, saics, vascs, cliens, indPack] = await Promise.all([
        entities.estoque.list(),
        entities.transbordos.list(),
        entities.saidas.list(),
        entities.vasilhames.list(),
        entities.clientes.list(),
        loadIndustrializacaoVasilhames(),
      ]);

      let reservasList = [];
      try {
        reservasList = await entities.materialReservas.list('-created_at');
      } catch (reservaErr) {
        console.warn('[ReservarMaterial] reservas:', reservaErr);
        toast({
          title: t('painel.comercial.reservarMaterial.loadErrorTitle'),
          description: t('painel.comercial.reservarMaterial.loadErrorDescription'),
          variant: 'destructive',
        });
      }

      const estoqueWithSaldo = (ests || [])
        .filter(
          (e) =>
            !isEstoqueEmbalagemUnitaria(e) &&
            resolveTipoRecebimentoEstoque(e) === 'embalado'
        )
        .map((e) => {
          const hydrated = hydrateEstoqueFiscal(e);
          const quantidade = getEstoqueQuantidade(hydrated);
          const unidade_medida = getEstoqueUnidade(hydrated);
          return {
            ...hydrated,
            quantidade,
            unidade_medida,
            saldo_atual: computeEstoqueSaldo(
              { ...hydrated, quantidade },
              trans,
              saics,
              vascs
            ),
          };
        });

      const aggregated = aggregateEstoqueByLote(estoqueWithSaldo, reservasList || []);
      setRows(aggregated);
      setVasilhameRows(
        buildVasilhameReservaRows({
          vasilhames: vascs || [],
          containers: indPack.containers,
          reservas: reservasList || [],
          recipes: indPack.recipes,
          productions: indPack.productions,
        })
      );
      setIndProductions(indPack.productions);
      setIndRecipes(indPack.recipes);
      setReservas(reservasList || []);
      setClientes(cliens || []);
    } catch (err) {
      console.error('[ReservarMaterial] loadData:', err);
      toast({
        title: t('painel.comercial.reservarMaterial.loadErrorTitle'),
        description:
          err?.message || t('painel.comercial.reservarMaterial.loadErrorDescription'),
        variant: 'destructive',
      });
      setRows([]);
      setVasilhameRows([]);
      setReservas([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const allClientsLabel = t('painel.comercial.reservarMaterial.allClients');
  const allStatusLabel = t('painel.comercial.reservarMaterial.statusFilter.all');
  const reservadoLabel = t('painel.comercial.reservarMaterial.statusFilter.reservado');
  const livreLabel = t('painel.comercial.reservarMaterial.statusFilter.livre');

  const matchesCliente = useCallback(
    (clienteNome) =>
      !clienteFilter ||
      clienteFilter === allClientsLabel ||
      clienteNome === clienteFilter,
    [clienteFilter, allClientsLabel]
  );

  const matchesStatus = useCallback(
    (isReserved) =>
      !statusFilter ||
      statusFilter === allStatusLabel ||
      (statusFilter === reservadoLabel && isReserved) ||
      (statusFilter === livreLabel && !isReserved),
    [statusFilter, allStatusLabel, reservadoLabel, livreLabel]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!matchesCliente(row.clienteNome)) return false;
      if (!matchesStatus((Number(row.saldoReservado) || 0) > 0)) return false;
      if (!q) return true;
      const hay = `${row.clienteNome} ${row.codigo} ${row.produto} ${row.lote} ${row.unidade}`
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, matchesCliente, matchesStatus]);

  const filteredVasilhames = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vasilhameRows.filter((row) => {
      if (!matchesCliente(row.clienteNome)) return false;
      if (!matchesStatus(Boolean(row.reservado))) return false;
      if (!q) return true;
      const hay = `${row.displayId} ${row.clienteNome} ${row.codigo} ${row.produto} ${row.lote}`
        .toLowerCase();
      return hay.includes(q);
    });
  }, [vasilhameRows, search, matchesCliente, matchesStatus]);

  const clienteOptions = useMemo(() => {
    const byName = new Map();
    for (const c of clientes || []) {
      if (c?.nome) byName.set(c.nome, c);
    }
    for (const row of vasilhameRows) {
      if (row.clienteNome && row.clienteNome !== '—' && !byName.has(row.clienteNome)) {
        byName.set(row.clienteNome, { id: row.clienteNome, nome: row.clienteNome });
      }
    }
    return [
      { id: 'all', nome: allClientsLabel },
      ...[...byName.values()].sort((a, b) =>
        String(a.nome).localeCompare(String(b.nome), 'pt-BR')
      ),
    ];
  }, [clientes, vasilhameRows, allClientsLabel]);

  const statusOptions = useMemo(
    () => [
      { id: 'all', nome: t('painel.comercial.reservarMaterial.statusFilter.all') },
      {
        id: 'reservado',
        nome: t('painel.comercial.reservarMaterial.statusFilter.reservado'),
      },
      { id: 'livre', nome: t('painel.comercial.reservarMaterial.statusFilter.livre') },
    ],
    [t]
  );

  const handleSaveReserva = async ({ quantidade, observacao }) => {
    if (!editRow) return;
    await setSaldoReservado({
      row: editRow,
      novaQuantidade: quantidade,
      user,
      observacao,
      motivoRemocao: observacao,
    });
    toast({
      title: t('painel.comercial.reservarMaterial.saveSuccess'),
    });
    setEditRow(null);
    await loadData({ silent: true });
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold text-foreground">
          {t('painel.comercial.sections.reservarMaterial.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t('painel.comercial.reservarMaterial.subtitle')}
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex flex-1 min-h-0 flex-col"
      >
        <div className="shrink-0 space-y-4">
          <TabsList className="h-auto p-1.5 gap-1 bg-muted/80 border border-border shadow-sm">
            <TabsTrigger value="embalados" className={TAB_TRIGGER_CLASS}>
              <Package className="w-4 h-4" />
              {t('painel.comercial.reservarMaterial.tabs.embalados')}
            </TabsTrigger>
            <TabsTrigger value="vasilhames" className={TAB_TRIGGER_CLASS}>
              <Cylinder className="w-4 h-4" />
              {t('painel.comercial.reservarMaterial.tabs.vasilhames')}
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  tab === 'vasilhames'
                    ? t('painel.comercial.reservarMaterial.vasilhames.searchPlaceholder')
                    : t('painel.comercial.reservarMaterial.searchPlaceholder')
                }
                className="pl-10 bg-card"
              />
            </div>
            <div className="w-full sm:w-64">
              <SearchableSelect
                value={clienteFilter}
                onChange={(label) => setClienteFilter(label)}
                options={clienteOptions}
                getOptionLabel={(c) => c.nome}
                getOptionValue={(c) => c.id}
                placeholder={t('painel.comercial.reservarMaterial.filterClient')}
              />
            </div>
            <div className="w-full sm:w-48">
              <SearchableSelect
                value={statusFilter}
                onChange={(label) => setStatusFilter(label)}
                options={statusOptions}
                getOptionLabel={(o) => o.nome}
                getOptionValue={(o) => o.id}
                placeholder={t('painel.comercial.reservarMaterial.filterStatus')}
              />
            </div>
          </div>
        </div>

        <TabsContent
          value="embalados"
          className="flex-1 min-h-0 mt-4 overflow-hidden data-[state=inactive]:hidden"
        >
          <div className="h-full bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col">
            <div className="shrink-0 px-5 py-4 border-b border-border flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t('painel.comercial.reservarMaterial.tableTitle')}
              </h3>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {filteredRows.length}
              </span>
            </div>

            {filteredRows.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
                {t('painel.comercial.reservarMaterial.empty')}
              </div>
            ) : (
              <div className="overflow-auto flex-1 min-h-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                      <th className="px-4 py-3 font-medium">
                        {t('painel.comercial.reservarMaterial.columns.cliente')}
                      </th>
                      <th className="px-4 py-3 font-medium">
                        {t('painel.comercial.reservarMaterial.columns.cod')}
                      </th>
                      <th className="px-4 py-3 font-medium">
                        {t('painel.comercial.reservarMaterial.columns.produto')}
                      </th>
                      <th className="px-4 py-3 font-medium">
                        {t('painel.comercial.reservarMaterial.columns.lote')}
                      </th>
                      <th className="px-4 py-3 font-medium text-right">
                        {t('painel.comercial.reservarMaterial.columns.saldoAtual')}
                      </th>
                      <th className="px-4 py-3 font-medium text-right">
                        {t('painel.comercial.reservarMaterial.columns.saldoReservado')}
                      </th>
                      <th className="px-4 py-3 font-medium text-right">
                        {t('painel.comercial.reservarMaterial.columns.saldoFinal')}
                      </th>
                      <th className="px-4 py-3 font-medium text-center">
                        {t('painel.comercial.reservarMaterial.columns.unidade')}
                      </th>
                      <th className="px-4 py-3 font-medium text-center">
                        {t('common.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, i) => (
                      <tr
                        key={row.id}
                        className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                          i % 2 === 1 ? 'bg-muted/20' : ''
                        }`}
                      >
                        <td className="px-4 py-3 text-muted-foreground">{row.clienteNome}</td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">{row.codigo}</td>
                        <td className="px-4 py-3 font-medium text-foreground">{row.produto}</td>
                        <td className="px-4 py-3 font-mono">{row.lote}</td>
                        <td className="px-4 py-3 text-right">
                          <SaldoBadge tone="blue">
                            {formatQty(row.saldoAtual, row.unidade)}
                          </SaldoBadge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <SaldoBadge tone={row.saldoReservado > 0 ? 'amber' : 'muted'}>
                            {formatQty(row.saldoReservado, row.unidade)}
                          </SaldoBadge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <SaldoBadge tone="green">
                            {formatQty(row.saldoFinal, row.unidade)}
                          </SaldoBadge>
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-primary">
                          {row.unidade}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <Can anyOf={['painel_comercial_reserva.edit', 'painel_comercial_reserva.create']}>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title={t('buttons.edit')}
                                onClick={() => setEditRow(row)}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                            </Can>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={t('common.view')}
                              onClick={() => setViewRow(row)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent
          value="vasilhames"
          className="flex-1 min-h-0 mt-4 overflow-auto data-[state=inactive]:hidden"
        >
          <VasilhamesReservaTable
            rows={filteredVasilhames}
            productions={indProductions}
            recipes={indRecipes}
            user={user}
            onReload={loadData}
          />
        </TabsContent>
      </Tabs>

      <ReservaEditModal
        open={!!editRow}
        row={editRow}
        onClose={() => setEditRow(null)}
        onSave={handleSaveReserva}
      />

      <ReservaViewModal
        open={!!viewRow}
        row={viewRow}
        reservas={reservas}
        onClose={() => setViewRow(null)}
      />
    </div>
  );
}

function SaldoBadge({ children, tone }) {
  const tones = {
    blue: 'bg-sky-100 text-sky-800',
    amber: 'bg-amber-100 text-amber-800',
    green: 'bg-emerald-100 text-emerald-700',
    muted: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold tabular-nums ${
        tones[tone] || tones.blue
      }`}
    >
      {children}
    </span>
  );
}
