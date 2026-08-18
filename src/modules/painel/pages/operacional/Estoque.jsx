import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cylinder, Eye, Package, Search, Warehouse } from 'lucide-react';
import { base44 } from '@industrializacao/api/base44Client';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { useToast } from '@shared/components/ui/use-toast';
import SearchableSelect from '@transbordo/components/cadastro/SearchableSelect';
import TankagemViewDialog from '@transbordo/components/tankagem/TankagemViewDialog';
import { entities } from '@transbordo/services/entities';
import {
  computeEstoqueSaldo,
  getEstoqueQuantidade,
  getEstoqueUnidade,
  hydrateEstoqueFiscal,
} from '@transbordo/lib/estoqueSaldo';
import { isEstoqueEmbalagemUnitaria } from '@transbordo/lib/transbordoEmbalado';
import { resolveTipoRecebimentoEstoque } from '@transbordo/lib/tipoRecebimento';
import { buildTankaDetalhe } from '@transbordo/lib/tankaVolume';
import {
  buildIndTankaDetalhe,
  mergeTankasUnificadas,
} from '@transbordo/lib/tankaUnificada';
import ReservaViewModal from '@painel/components/comercial/ReservaViewModal';
import VasilhamesReservaTable from '@painel/components/comercial/VasilhamesReservaTable';
import OperacionalTankagemBoard from '@painel/components/operacional/OperacionalTankagemBoard';
import {
  aggregateEstoqueByLote,
  formatQty,
} from '@painel/lib/materialReservas';
import {
  buildVasilhameReservaRows,
  loadIndustrializacaoVasilhames,
} from '@painel/lib/vasilhameReservas';

const TAB_TRIGGER_CLASS =
  'gap-2 px-5 py-2.5 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md';

const PRODUCT_COLORS = [
  '#90EE90', '#87CEEB', '#DDA0DD', '#F0E68C', '#FFB6C1',
  '#E6E6FA', '#98FB98', '#FABD74', '#B0E0E6', '#DEB887',
  '#BC8F8F', '#AED581', '#4FC3F7', '#FFD54F', '#FF8A65',
  '#BA68C8', '#7986CB', '#4DB6AC', '#F06292', '#81C784',
];

export default function Estoque() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [tab, setTab] = useState('vasilhames');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [vasilhameRows, setVasilhameRows] = useState([]);
  const [indProductions, setIndProductions] = useState([]);
  const [indRecipes, setIndRecipes] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [transbordos, setTransbordos] = useState([]);
  const [unifiedTankas, setUnifiedTankas] = useState([]);
  const [search, setSearch] = useState('');
  const [clienteFilter, setClienteFilter] = useState('');
  const [viewRow, setViewRow] = useState(null);
  const [viewDetalhe, setViewDetalhe] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [ests, trans, saics, vascs, cliens, isot, indPack, indTanks, indStock] =
        await Promise.all([
          entities.estoque.list(),
          entities.transbordos.list(),
          entities.saidas.list(),
          entities.vasilhames.list(),
          entities.clientes.list(),
          entities.isotanques.list(),
          loadIndustrializacaoVasilhames(),
          base44.entities.Tank.list('-created_date', 500).catch(() => []),
          base44.entities.RawMaterialStock.list('-created_date', 500).catch(() => []),
        ]);

      let reservasList = [];
      try {
        reservasList = await entities.materialReservas.list('-created_at');
      } catch (reservaErr) {
        console.warn('[OperacionalEstoque] reservas:', reservaErr);
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

      setRows(aggregateEstoqueByLote(estoqueWithSaldo, reservasList || []));
      setVasilhameRows(
        buildVasilhameReservaRows({
          vasilhames: vascs || [],
          containers: indPack.containers,
          reservas: reservasList || [],
          recipes: indPack.recipes,
          productions: indPack.productions,
          transfers: indPack.transfers,
        })
      );
      setIndProductions(indPack.productions);
      setIndRecipes(indPack.recipes);
      setReservas(reservasList || []);
      setClientes(cliens || []);
      setTransbordos(trans || []);
      setUnifiedTankas(
        mergeTankasUnificadas({
          isotanques: isot || [],
          transbordos: trans || [],
          indTanks: indTanks || [],
          indContainers: indPack.containers || [],
          indStock: indStock || [],
        })
      );
    } catch (err) {
      console.error('[OperacionalEstoque] loadData:', err);
      toast({
        title: t('painel.operacional.estoque.loadErrorTitle'),
        description:
          err?.message || t('painel.operacional.estoque.loadErrorDescription'),
        variant: 'destructive',
      });
      setRows([]);
      setVasilhameRows([]);
      setUnifiedTankas([]);
      setReservas([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const allClientsLabel = t('painel.operacional.estoque.allClients');
  const noClientLabel = t('painel.operacional.estoque.tankas.noClient');

  const matchesCliente = useCallback(
    (clienteNome) =>
      !clienteFilter ||
      clienteFilter === allClientsLabel ||
      clienteNome === clienteFilter,
    [clienteFilter, allClientsLabel]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!matchesCliente(row.clienteNome)) return false;
      if (!q) return true;
      const hay = `${row.clienteNome} ${row.codigo} ${row.produto} ${row.lote} ${row.unidade}`
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, matchesCliente]);

  const filteredVasilhames = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vasilhameRows.filter((row) => {
      if (!matchesCliente(row.clienteNome)) return false;
      if (!q) return true;
      const hay = `${row.displayId} ${row.placa} ${row.barril} ${row.clienteNome} ${row.codigo} ${row.produto} ${row.lote}`
        .toLowerCase();
      return hay.includes(q);
    });
  }, [vasilhameRows, search, matchesCliente]);

  const filteredTankas = useMemo(() => {
    const q = search.trim().toLowerCase();
    return unifiedTankas.filter((tank) => {
      const clienteNome = tank.cliente_nome || noClientLabel;
      if (!matchesCliente(clienteNome)) return false;
      if (!q) return true;
      const hay = `${tank.tankaCodigo || ''} ${tank.tanka || ''} ${tank.produto || ''} ${tank.cliente_nome || ''}`
        .toLowerCase();
      return hay.includes(q);
    });
  }, [unifiedTankas, search, matchesCliente, noClientLabel]);

  const productColorMap = useMemo(() => {
    const map = {};
    let colorIndex = 0;
    for (const tank of filteredTankas) {
      const prod = tank.produto || '';
      if (prod && !(prod in map)) {
        map[prod] = PRODUCT_COLORS[colorIndex % PRODUCT_COLORS.length];
        colorIndex += 1;
      }
    }
    return map;
  }, [filteredTankas]);

  const groupedByClient = useMemo(() => {
    return filteredTankas.reduce((acc, tank) => {
      const cliente = tank.cliente_nome || noClientLabel;
      if (!acc[cliente]) acc[cliente] = [];
      acc[cliente].push(tank);
      return acc;
    }, {});
  }, [filteredTankas, noClientLabel]);

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
    for (const tank of unifiedTankas) {
      const nome = String(tank.cliente_nome || '').trim();
      if (nome && !byName.has(nome)) {
        byName.set(nome, { id: `tank-client:${nome}`, nome });
      }
    }
    const hasTankaSemCliente = unifiedTankas.some(
      (tank) => !String(tank.cliente_nome || '').trim()
    );
    if (hasTankaSemCliente && !byName.has(noClientLabel)) {
      byName.set(noClientLabel, { id: 'no-client', nome: noClientLabel });
    }
    return [
      { id: 'all', nome: allClientsLabel },
      ...[...byName.values()].sort((a, b) =>
        String(a.nome).localeCompare(String(b.nome), 'pt-BR')
      ),
    ];
  }, [clientes, vasilhameRows, unifiedTankas, allClientsLabel, noClientLabel]);

  const handleViewTanka = (tank) => {
    if (
      tank.volumeSource === 'ind_container' ||
      tank.volumeSource === 'ind_stock' ||
      tank.volumeSource === 'ind_cadastro' ||
      !tank.hasTransbordo
    ) {
      setViewDetalhe(buildIndTankaDetalhe(tank));
    } else if (tank.hasTransbordo && tank.isotanque) {
      setViewDetalhe(
        buildTankaDetalhe({
          isotanque: {
            ...tank.isotanque,
            produto_nome: tank.produto || tank.isotanque.produto_nome,
            cliente_nome: tank.cliente_nome || tank.isotanque.cliente_nome,
            capacidade: tank.capacidade || tank.isotanque.capacidade,
          },
          transbordos,
        })
      );
    } else {
      setViewDetalhe(buildIndTankaDetalhe(tank));
    }
    setViewOpen(true);
  };

  const searchPlaceholder =
    tab === 'vasilhames'
      ? t('painel.operacional.estoque.searchVasilhames')
      : tab === 'tankas'
        ? t('painel.operacional.estoque.searchTankas')
        : t('painel.operacional.estoque.searchEmbalados');

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
          {t('painel.operacional.sections.estoque.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t('painel.operacional.estoque.subtitle')}
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex flex-1 min-h-0 flex-col"
      >
        <div className="shrink-0 space-y-4">
          <TabsList className="h-auto p-1.5 gap-1 bg-muted/80 border border-border shadow-sm">
            <TabsTrigger value="vasilhames" className={TAB_TRIGGER_CLASS}>
              <Cylinder className="w-4 h-4" />
              {t('painel.operacional.estoque.tabs.vasilhames')}
            </TabsTrigger>
            <TabsTrigger value="tankas" className={TAB_TRIGGER_CLASS}>
              <Warehouse className="w-4 h-4" />
              {t('painel.operacional.estoque.tabs.tankas')}
            </TabsTrigger>
            <TabsTrigger value="embalados" className={TAB_TRIGGER_CLASS}>
              <Package className="w-4 h-4" />
              {t('painel.operacional.estoque.tabs.embalados')}
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
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
                placeholder={t('painel.operacional.estoque.filterClient')}
              />
            </div>
          </div>
        </div>

        <TabsContent
          value="vasilhames"
          className="flex-1 min-h-0 mt-4 overflow-hidden data-[state=inactive]:hidden"
        >
          <VasilhamesReservaTable
            rows={filteredVasilhames}
            productions={indProductions}
            recipes={indRecipes}
            readOnly
          />
        </TabsContent>

        <TabsContent
          value="tankas"
          className="flex-1 min-h-0 mt-4 overflow-hidden data-[state=inactive]:hidden"
        >
          <OperacionalTankagemBoard
            groupedByClient={groupedByClient}
            productColorMap={productColorMap}
            onView={handleViewTanka}
          />
        </TabsContent>

        <TabsContent
          value="embalados"
          className="flex-1 min-h-0 mt-4 overflow-hidden data-[state=inactive]:hidden"
        >
          <div className="h-full bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col">
            <div className="shrink-0 px-5 py-4 border-b border-border flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t('painel.operacional.estoque.embalados.tableTitle')}
              </h3>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {filteredRows.length}
              </span>
            </div>

            {filteredRows.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
                {t('painel.operacional.estoque.embalados.empty')}
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
                          <SaldoBadge>
                            {formatQty(row.saldoAtual, row.unidade)}
                          </SaldoBadge>
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-primary">
                          {row.unidade}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center">
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
      </Tabs>

      <ReservaViewModal
        open={!!viewRow}
        row={viewRow}
        reservas={reservas}
        onClose={() => setViewRow(null)}
      />

      <TankagemViewDialog
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewDetalhe(null);
        }}
        detalhe={viewDetalhe}
      />
    </div>
  );
}

function SaldoBadge({ children }) {
  return (
    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold tabular-nums bg-sky-100 text-sky-800">
      {children}
    </span>
  );
}
