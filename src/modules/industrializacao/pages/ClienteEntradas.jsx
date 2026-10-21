import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Eye, Search } from 'lucide-react';
import { entities } from '@transbordo/services/entities';
import { listProdutos } from '@transbordo/lib/cadastroProdutosCentral';
import { getEntradaLotes } from '@transbordo/lib/entradaEtiqueta';
import { buildEntradaCodigoById, origemPertenceAEntrada } from '@transbordo/lib/entradaCodigo';
import { formatQuantidade } from '@transbordo/lib/format';
import { prepareEntradaView } from '@industrializacao/lib/syncMpEntradaTransbordo';
import { base44 } from '@industrializacao/api/base44Client';
import { getUserClient, sameClientName } from '@industrializacao/lib/permissions';
import { Input } from '@shared/components/ui/input';
import { RowActionButton } from '@shared/components/ui/RowActionButton';
import SearchableSelect from '@transbordo/components/cadastro/SearchableSelect';
import ComunicacaoRecebimentoDialog from '@transbordo/components/entrada/ComunicacaoRecebimentoDialog';
import RawMaterialViewDialog from '@industrializacao/components/estoque/RawMaterialViewDialog';

const ORIGEM_OPTIONS = [
  { value: 'all', label: 'Todas' },
  { value: 'ARMAZENAGEM', label: 'Armazenagem' },
  { value: 'MATERIA_PRIMA', label: 'Matéria-prima' },
];

const LINK_PREFIX = 'INDMP:';

function getSistemaOrigem(entrada) {
  return entrada?.origem === 'industrializacao' || entrada?.origem === 'MATERIA_PRIMA'
    ? 'Matéria-prima'
    : 'Armazenagem';
}

function formatEntradaData(entrada) {
  const raw = entrada?.data || entrada?.created_date || entrada?.created_at;
  if (!raw) return '-';
  const value = String(raw);
  const date = value.includes('T')
    ? new Date(value)
    : new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR');
}

function entradaTimestamp(entrada) {
  const raw = entrada?.data || entrada?.created_at || entrada?.created_date;
  const time = new Date(raw || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function matchesText(value, q) {
  if (value == null || value === '') return false;
  return String(value).toLowerCase().includes(q);
}

function collectLinkedMpIds(entradas) {
  const ids = new Set();
  for (const entrada of entradas || []) {
    const grupo = String(entrada?.grupo_entrada || '');
    if (grupo.startsWith(LINK_PREFIX) && !grupo.startsWith(`${LINK_PREFIX}G:`)) {
      ids.add(grupo.slice(LINK_PREFIX.length));
    }
    for (const lote of entrada?.lotes || []) {
      if (lote?.ind_mp_id) ids.add(String(lote.ind_mp_id));
    }
  }
  return ids;
}

function mpToPortalEntrada(mp) {
  const qty = Number(mp?.initial_stock) || Number(mp?.current_stock) || 0;
  const lote = {
    produto_codigo: mp?.mp_code || '',
    produto_nome: mp?.mp_name || '',
    lote: mp?.lot || '',
    quantidade: qty,
    unidade_medida: mp?.unit || 'kg',
    nota_fiscal: mp?.nota_fiscal || '',
  };
  return {
    id: `mp:${mp.id}`,
    orphanMp: mp,
    data: mp?.entry_date || null,
    created_at: mp?.created_date || mp?.created_at || mp?.entry_date || null,
    origem: 'industrializacao',
    cliente_nome: mp?.client || '',
    produto_codigo: lote.produto_codigo,
    produto_nome: lote.produto_nome,
    lote: lote.lote,
    quantidade: qty,
    unidade_medida: lote.unidade_medida,
    nota_fiscal: lote.nota_fiscal,
    lotes: [lote],
  };
}

function StackedCell({ items, mono = false }) {
  return (
    <div className="flex flex-col gap-1">
      {items.map((item, i) => (
        <div
          key={i}
          className={`leading-5 min-h-5 truncate ${mono ? 'font-medium' : ''}`}
          title={item && item !== '-' ? String(item) : undefined}
        >
          {item || '-'}
        </div>
      ))}
    </div>
  );
}

export default function ClienteEntradas() {
  const { user } = useOutletContext();
  const cliente = getUserClient(user);
  const [entradas, setEntradas] = useState([]);
  const [idMap, setIdMap] = useState({});
  const [produtos, setProdutos] = useState([]);
  const [transbordos, setTransbordos] = useState([]);
  const [estoque, setEstoque] = useState([]);
  const [search, setSearch] = useState('');
  const [origemFilter, setOrigemFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewEntrada, setViewEntrada] = useState(null);
  const [viewDestinos, setViewDestinos] = useState([]);
  const [viewControleLotes, setViewControleLotes] = useState([]);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewingMp, setViewingMp] = useState(null);

  useEffect(() => {
    if (!cliente) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [rows, stocks] = await Promise.all([
          entities.entradas.list('-created_date'),
          base44.entities.RawMaterialStock.list('-created_date', 2000).catch((err) => {
            console.error('[ClienteEntradas] matéria-prima:', err);
            return [];
          }),
        ]);
        if (cancelled) return;

        const codigos = buildEntradaCodigoById(rows);
        const linkedMp = collectLinkedMpIds(rows);
        const doCliente = (rows || []).filter((entrada) =>
          sameClientName(entrada?.cliente_nome, cliente)
        );
        const orfas = (stocks || [])
          .filter((mp) => mp?.id && sameClientName(mp.client, cliente) && !linkedMp.has(String(mp.id)))
          .map(mpToPortalEntrada);

        const merged = [...doCliente, ...orfas].sort(
          (a, b) => entradaTimestamp(b) - entradaTimestamp(a)
        );
        setIdMap(codigos);
        setEntradas(merged);
      } catch (err) {
        console.error('[ClienteEntradas] carga:', err);
        if (!cancelled) setEntradas([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [cliente]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return entradas.filter((entrada) => {
      const lotes = getEntradaLotes(entrada);
      const matchSearch =
        !q ||
        matchesText(idMap[entrada.id], q) ||
        matchesText(entrada.produto_codigo, q) ||
        matchesText(entrada.produto_nome, q) ||
        matchesText(entrada.cliente_nome, q) ||
        matchesText(entrada.lote, q) ||
        matchesText(entrada.nota_fiscal, q) ||
        lotes.some(
          (lote) =>
            matchesText(lote.produto_codigo, q) ||
            matchesText(lote.produto_nome, q) ||
            matchesText(lote.lote, q) ||
            matchesText(lote.nota_fiscal, q)
        );

      const sistema = getSistemaOrigem(entrada);
      const matchOrigem =
        !origemFilter || origemFilter === 'Todas' || origemFilter === sistema;

      return matchSearch && matchOrigem;
    });
  }, [entradas, search, origemFilter, idMap]);

  const totalQuantidade = filtered.reduce((sum, entrada) => {
    const lotes = getEntradaLotes(entrada);
    const fromLotes = lotes.reduce((acc, lote) => acc + (parseFloat(lote.quantidade) || 0), 0);
    return sum + (fromLotes > 0 ? fromLotes : entrada.quantidade || 0);
  }, 0);

  const handleView = async (entrada) => {
    if (entrada?.orphanMp) {
      setViewingMp(entrada.orphanMp);
      return;
    }

    let current = entrada;
    let destinos = [];
    let controleLotes = [];
    try {
      const prepared = await prepareEntradaView(entrada, { persist: false });
      current = prepared.entrada;
      destinos = prepared.destinosInformados || [];
      controleLotes = prepared.controleLotes || [];
    } catch (err) {
      console.error('[ClienteEntradas] visualização:', err);
    }

    const codigo = idMap[current.id] || '';
    let estoqueRows = [];
    let transbordoRows = [];
    let catalog = produtos;
    try {
      const [estoqueResult, transbordoResult, catalogResult] = await Promise.all([
        entities.estoque.filter({ entrada_id: current.id }),
        entities.transbordos.list(),
        produtos.length > 0 ? Promise.resolve(produtos) : listProdutos(),
      ]);
      estoqueRows = estoqueResult || [];
      catalog = catalogResult || [];
      const origemIds = new Set([current.id, ...estoqueRows.map((row) => row.id)]);
      transbordoRows = (transbordoResult || []).filter((row) =>
        (row.origens || []).some((origem) =>
          origemPertenceAEntrada(origem, origemIds, codigo)
        )
      );
    } catch (err) {
      console.error('[ClienteEntradas] detalhe:', err);
    }

    setProdutos(catalog);
    setEstoque(estoqueRows);
    setTransbordos(transbordoRows);
    setViewEntrada(current);
    setViewDestinos(destinos);
    setViewControleLotes(controleLotes);
    setViewOpen(true);
  };

  if (!cliente) {
    return (
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Entradas</h1>
        <p className="text-sm text-muted-foreground">
          Este usuário não está vinculado a um cliente.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Entradas</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Recebimentos de {cliente} — armazenagem e matéria-prima
          </p>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por produto, lote ou NF..."
              className="pl-10 bg-card"
            />
          </div>
          <div className="w-52">
            <SearchableSelect
              value={origemFilter}
              onChange={(label) => setOrigemFilter(label)}
              options={ORIGEM_OPTIONS}
              getOptionLabel={(option) => option.label}
              getOptionValue={(option) => option.value}
              placeholder="Origem"
              ariaLabel="Filtrar por origem"
              inputClassName="h-9 bg-card text-base font-normal text-foreground shadow-sm placeholder:text-muted-foreground md:text-sm"
            />
          </div>
          <span className="text-sm text-muted-foreground ml-auto">
            {filtered.length} registro(s)
          </span>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-5 py-3 font-medium">ID</th>
                <th className="px-5 py-3 font-medium">Data</th>
                <th className="px-5 py-3 font-medium">Origem</th>
                <th className="px-5 py-3 font-medium">Cód</th>
                <th className="px-5 py-3 font-medium">Produto</th>
                <th className="px-5 py-3 font-medium">Lote(s)</th>
                <th className="px-5 py-3 font-medium">Qtd. Total</th>
                <th className="px-5 py-3 font-medium">Unidade</th>
                <th className="px-5 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando recebimentos...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum recebimento encontrado para este cliente.
                  </td>
                </tr>
              ) : (
                filtered.map((entrada, index) => {
                  const lotes = getEntradaLotes(entrada);
                  const sistema = getSistemaOrigem(entrada);
                  const isIndustrializacao = sistema === 'Industrialização';
                  const unidades = lotes.map((lote) => lote.unidade_medida || '-');
                  const unidadesDistintas = [...new Set(unidades.filter((unidade) => unidade && unidade !== '-'))];
                  const showUnidadesStacked = unidadesDistintas.length > 1;

                  return (
                    <tr
                      key={entrada.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors align-middle ${
                        index % 2 === 1 ? 'bg-muted/40/30' : ''
                      }`}
                    >
                      <td className="px-5 py-3 font-medium text-primary">
                        {entrada.orphanMp ? '—' : idMap[entrada.id] || '-'}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">
                        {formatEntradaData(entrada)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                            isIndustrializacao
                              ? 'bg-orange-100 text-orange-800'
                              : 'bg-primary/10 text-primary'
                          }`}
                        >
                          {sistema}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-foreground">
                        <StackedCell mono items={lotes.map((lote) => lote.produto_codigo || '-')} />
                      </td>
                      <td className="px-5 py-3 text-foreground">
                        <StackedCell items={lotes.map((lote) => lote.produto_nome || '-')} />
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        <StackedCell items={lotes.map((lote) => lote.lote || '-')} />
                      </td>
                      <td className="px-5 py-3 font-medium text-foreground">
                        <StackedCell
                          items={lotes.map((lote) => formatQuantidade(lote.quantidade, { empty: '-' }))}
                        />
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {showUnidadesStacked ? (
                          <StackedCell items={unidades} />
                        ) : (
                          unidadesDistintas[0] || entrada.unidade_medida || '-'
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <RowActionButton onClick={() => handleView(entrada)} title="Visualizar">
                          <Eye />
                        </RowActionButton>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-3 border-t border-border text-sm flex-wrap shrink-0">
          <span className="text-muted-foreground">
            Itens exibidos: <span className="font-medium text-foreground">{filtered.length}</span>
          </span>
          <span className="text-muted-foreground">
            Quantidade total:{' '}
            <span className="font-medium text-foreground">{formatQuantidade(totalQuantidade)}</span>
          </span>
        </div>
      </div>

      <ComunicacaoRecebimentoDialog
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        entrada={viewEntrada}
        entradaId={viewEntrada ? idMap[viewEntrada.id] || '-' : '-'}
        destinosInformados={viewDestinos}
        controleLotes={viewControleLotes}
        produtos={produtos}
        transbordos={transbordos}
        estoque={estoque}
      />

      <RawMaterialViewDialog
        item={viewingMp}
        open={!!viewingMp}
        onOpenChange={(open) => {
          if (!open) setViewingMp(null);
        }}
        readOnly
      />
    </div>
  );
}
