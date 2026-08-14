import { useState, useEffect, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { entities } from '@transbordo/services/entities';
import { Search, Eye, Pencil, Trash2, Droplets, Package, ChevronDown, MapPin, ExternalLink } from "lucide-react";
import { Input } from "@shared/components/ui/input";
import { Switch } from "@shared/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@shared/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@shared/components/ui/alert-dialog";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import EstoqueEditModal from "@transbordo/components/estoque/EstoqueEditModal";
import EstoqueViewDialog from "@transbordo/components/estoque/EstoqueViewDialog";
import { buildEntradaCodigoById } from "@transbordo/lib/entradaCodigo";
import { formatEstoqueCodigo } from "@transbordo/lib/estoqueCodigo";
import { formatMass, formatVolume, formatCurrency } from "@transbordo/lib/format";
import {
  computeEstoqueSaldo,
  computeEstoqueQuantidadesPorLocal,
  getEstoqueQuantidade,
  getEstoqueUnidade,
  getEstoqueUnidadeEntrada,
  valorNaUnidadeEntrada,
  isUnidadeVolumeEntrada,
  hydrateEstoqueFiscal,
} from "@transbordo/lib/estoqueSaldo";
import { migrateEstoqueEmbaladoParaVasilhames, isEstoqueEmbalagemUnitaria, normalizeBarrilEmbalagensUnitarias } from "@transbordo/lib/transbordoEmbalado";
import {
  resolveTipoRecebimentoEstoque,
} from "@transbordo/lib/tipoRecebimento";

const STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "ok", label: "OK" },
  { value: "nok", label: "NOK" },
];

const TIPO_TAB_TRIGGER_CLASS =
  "gap-2 px-5 py-2.5 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md";

const nullIfEmpty = (v) => (v === "" || v === undefined ? null : v);

function formatValorNaUnidadeEntrada(estoqueItem, valorEntrada) {
  const valor = Number(valorEntrada) || 0;
  if (isUnidadeVolumeEntrada(getEstoqueUnidadeEntrada(estoqueItem))) {
    return formatVolume(valor, { empty: "-" });
  }
  return formatMass(valor, { empty: "-" });
}

function SaldoBadge({ children, tone }) {
  const tones = {
    blue: "bg-sky-100 text-sky-800",
    red: "bg-red-100 text-red-700",
    green: "bg-green-100 text-green-700",
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

function LocalArmazenamentoCard({
  title,
  quantidade,
  unidade,
  estoqueItem,
  onNavigate,
  navigateLabel,
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {onNavigate && (
          <button
            type="button"
            onClick={onNavigate}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors shrink-0"
            title={navigateLabel || "Abrir tela filtrada"}
          >
            Ver
            <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>
      <p className="text-sm font-semibold tabular-nums text-foreground">
        {formatValorNaUnidadeEntrada(estoqueItem, quantidade)}{" "}
        <span className="text-xs font-medium text-muted-foreground">
          {unidade || ""}
        </span>
      </p>
    </div>
  );
}

export default function Estoque() {
  const navigate = useNavigate();
  const [estoque, setEstoque] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [entradas, setEntradas] = useState([]);
  const [transbordos, setTransbordos] = useState([]);
  const [saidas, setSaidas] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [clienteFilter, setClienteFilter] = useState("");
  const [tipoFilter, setTipoFilter] = useState("granel");
  const [editOpen, setEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewItem, setViewItem] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedLocais, setExpandedLocais] = useState({});

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      try {
        const mig = await migrateEstoqueEmbaladoParaVasilhames();
        if (mig.deletedEstoque > 0) {
          console.info(
            `[ChemFlow] Migrados ${mig.migrated} embalagem(ns) unitária(s) do Estoque → Vasilhames; removidos ${mig.deletedEstoque} do estoque.`
          );
        }
        await normalizeBarrilEmbalagensUnitarias();
      } catch (migErr) {
        console.warn("[ChemFlow] Migração embalado (estoque→vasilhame):", migErr);
      }

      const [ests, prods, cliens, trans, saics, ents, vascs] = await Promise.all([
        entities.estoque.list(),
        entities.produtos.list(),
        entities.clientes.list(),
        entities.transbordos.list(),
        entities.saidas.list(),
        entities.entradas.list(),
        entities.vasilhames.list(),
      ]);

      // Saldo = quantidade − saídas de vasilhame (pátio/fiscal) − saídas embalado
      // Bombonas/tambores/IBC de OP ficam só em Vasilhames
      const estoqueWithSaldo = ests
        .filter((e) => !isEstoqueEmbalagemUnitaria(e))
        .map((e) => {
        const hydrated = hydrateEstoqueFiscal(e);
        const quantidade = getEstoqueQuantidade(hydrated);
        const unidade_medida = getEstoqueUnidade(hydrated);
        const itemOp = { ...hydrated, quantidade, unidade_medida };
        return {
          ...itemOp,
          saldo_atual: computeEstoqueSaldo(
            itemOp,
            trans,
            saics,
            vascs
          ),
        };
      });

      const toUpdate = estoqueWithSaldo
        .filter((e) => {
          const original = ests.find((o) => o.id === e.id);
          const saldoChanged =
            Math.abs((original?.saldo_atual || 0) - e.saldo_atual) > 0.001;
          const qtdChanged =
            Math.abs((original?.quantidade || 0) - e.quantidade) > 0.001;
          const unidChanged = original?.unidade_medida !== e.unidade_medida;
          return saldoChanged || qtdChanged || unidChanged;
        })
        .map((e) => ({
          id: e.id,
          saldo_atual: e.saldo_atual,
          quantidade: e.quantidade,
          unidade_medida: e.unidade_medida,
        }));
      if (toUpdate.length > 0) {
        try {
          await entities.estoque.bulkUpdate(toUpdate);
        } catch {
          // Sync de saldo não deve derrubar a listagem
        }
      }

      setEstoque(estoqueWithSaldo);
      setProdutos(prods);
      setClientes(cliens);
      setTransbordos(trans);
      setSaidas(saics);
      setEntradas(ents);
      setVasilhames(vascs);
    } catch {
      if (!silent) setEstoque([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  /** Código da entrada (E001…), para rastrear a origem. */
  const entradaIdMap = buildEntradaCodigoById(entradas);

  const getEstoqueEntradaLabel = (e) => {
    if (e?.entrada_id && entradaIdMap[e.entrada_id]) {
      return entradaIdMap[e.entrada_id];
    }
    return e?.entrada_codigo || "-";
  };

  const filtered = estoque
    .filter((e) => {
      const tipo = resolveTipoRecebimentoEstoque(e);
      if (tipoFilter === "granel" && tipo !== "granel") return false;
      if (tipoFilter === "embalado" && tipo !== "embalado") return false;

      const q = search.toLowerCase().trim();
      const entradaLabel = getEstoqueEntradaLabel(e).toLowerCase();
      const codigoEstoque = formatEstoqueCodigo(e.codigo_estoque).toLowerCase();
      const matchSearch =
        !q ||
        codigoEstoque.includes(q) ||
        entradaLabel.includes(q) ||
        e.entrada_codigo?.toLowerCase().includes(q) ||
        e.produto_codigo?.toLowerCase().includes(q) ||
        e.produto_nome?.toLowerCase().includes(q) ||
        e.cliente_nome?.toLowerCase().includes(q) ||
        e.lote?.toLowerCase().includes(q) ||
        e.nota_fiscal?.toLowerCase().includes(q) ||
        e.nota_fiscal_troca?.toLowerCase().includes(q);

      const matchStatus =
        !statusFilter ||
        statusFilter === "Todos" ||
        (statusFilter === "OK" && e.status_wms) ||
        (statusFilter === "NOK" && !e.status_wms);

      const matchCliente =
        !clienteFilter ||
        clienteFilter === "Todos os clientes" ||
        e.cliente_nome === clienteFilter;

      return matchSearch && matchStatus && matchCliente;
    })
    .sort((a, b) => {
      const ca = Number(a.codigo_estoque) || 0;
      const cb = Number(b.codigo_estoque) || 0;
      if (ca !== cb) return cb - ca; // mais novo (maior ID) no topo
      return String(b.id || "").localeCompare(String(a.id || ""));
    });

  const totalSaldo = filtered.reduce((sum, e) => sum + (e.saldo_atual || 0), 0);
  const totalCusto = filtered.reduce(
    (sum, e) => sum + (e.saldo_atual || 0) * (e.preco_unitario || 0),
    0
  );

  const handleEdit = (item) => {
    setEditingItem(item);
    setEditOpen(true);
  };

  const handleView = (item) => {
    setViewItem(item);
    setViewOpen(true);
  };

  const handleEditSave = async (data) => {
    const item = editingItem;
    if (!item?.id) {
      throw new Error("Registro de estoque inválido para edição.");
    }

    const quantidade = Number(data.quantidade) || 0;
    const preco = Number(data.preco_unitario) || 0;

    const lotes =
      Array.isArray(item.lotes) && item.lotes.length > 0
        ? item.lotes.map((l, i) =>
            i === 0
              ? {
                  ...l,
                  nota_fiscal: data.nota_fiscal,
                  nota_fiscal_troca: data.nota_fiscal_troca,
                  lote: data.lote,
                  quantidade,
                  unidade_medida: data.unidade_medida,
                  data_fabricacao: data.data_fabricacao,
                  data_validade: data.data_validade,
                  preco_unitario: preco,
                  peso_liquido: data.peso_liquido,
                  quantidade_embalagens: data.quantidade_embalagens,
                }
              : l
          )
        : [
            {
              produto_id: item.produto_id,
              produto_nome: item.produto_nome,
              produto_codigo: item.produto_codigo,
              nota_fiscal: data.nota_fiscal,
              nota_fiscal_troca: data.nota_fiscal_troca,
              lote: data.lote,
              densidade: item.densidade,
              quantidade,
              unidade_medida: data.unidade_medida,
              data_fabricacao: data.data_fabricacao,
              data_validade: data.data_validade,
              preco_unitario: preco,
              embalado: item.embalado || false,
              peso_liquido: data.peso_liquido,
              quantidade_embalagens: data.quantidade_embalagens,
            },
          ];

    const provisional = {
      ...item,
      quantidade,
      unidade_medida: data.unidade_medida,
      lotes,
    };
    const saldo_atual = computeEstoqueSaldo(
      provisional,
      transbordos,
      saidas,
      vasilhames
    );

    const payload = {
      nota_fiscal: data.nota_fiscal,
      nota_fiscal_troca: nullIfEmpty(data.nota_fiscal_troca),
      lote: data.lote,
      quantidade,
      unidade_medida: data.unidade_medida,
      data_fabricacao: nullIfEmpty(data.data_fabricacao),
      data_validade: nullIfEmpty(data.data_validade),
      preco_unitario: preco,
      custo_total: saldo_atual * preco,
      saldo_atual,
      peso_liquido: item.embalado ? data.peso_liquido : null,
      quantidade_embalagens: item.embalado ? data.quantidade_embalagens : null,
      lotes,
    };

    try {
      await entities.estoque.update(item.id, payload);
    } catch (err) {
      const msg = String(err?.message || "").toLowerCase();
      // Coluna ausente / schema cache desatualizado: mantém troca no JSONB lotes
      const missingTrocaCol =
        msg.includes("nota_fiscal_troca") ||
        (msg.includes("schema cache") && "nota_fiscal_troca" in payload);
      if (missingTrocaCol) {
        const { nota_fiscal_troca: _ignored, ...payloadSemColuna } = payload;
        await entities.estoque.update(item.id, payloadSemColuna);
      } else {
        throw err;
      }
    }

    // Fecha o modal antes do refresh para evitar flash / estado preso em "Salvando..."
    setEditOpen(false);
    setEditingItem(null);

    setEstoque((prev) =>
      prev.map((e) =>
        e.id === item.id
          ? hydrateEstoqueFiscal({ ...e, ...payload, quantidade, saldo_atual })
          : e
      )
    );

    await loadData({ silent: true });
  };

  const handleDelete = async () => {
    try {
      await entities.estoque.delete(deleteId);
      await loadData();
    } catch {
      // ignore
    }
    setDeleteId(null);
  };

  const handleToggleWms = async (item, newValue) => {
    setEstoque((prev) =>
      prev.map((e) =>
        e.id === item.id ? { ...e, status_wms: newValue } : e
      )
    );
    try {
      await entities.estoque.update(item.id, { status_wms: newValue });
    } catch {
      setEstoque((prev) =>
        prev.map((e) =>
          e.id === item.id ? { ...e, status_wms: item.status_wms } : e
        )
      );
    }
  };

  const clienteFilterOptions = [
    { id: "all", nome: "Todos os clientes" },
    ...clientes,
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground leading-tight">Estoque</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {filtered.length} registro(s) em estoque
              {tipoFilter === "granel"
                ? " · Granel"
                : tipoFilter === "embalado"
                  ? " · Embalado"
                  : ""}
            </p>
          </div>
          <Tabs value={tipoFilter} onValueChange={setTipoFilter}>
            <TabsList className="h-auto p-1 gap-1 bg-muted/80 border border-border shadow-sm w-fit shrink-0">
              <TabsTrigger value="granel" className={TIPO_TAB_TRIGGER_CLASS}>
                <Droplets className="w-4 h-4" />
                Granel
              </TabsTrigger>
              <TabsTrigger value="embalado" className={TIPO_TAB_TRIGGER_CLASS}>
                <Package className="w-4 h-4" />
                Embalado
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por ID, entrada, código, produto, cliente ou lote..."
              className="pl-10 bg-card"
            />
          </div>
          <div className="w-44">
            <SearchableSelect
              value={statusFilter}
              onChange={(label) => setStatusFilter(label)}
              options={STATUS_OPTIONS}
              getOptionLabel={(o) => o.label}
              getOptionValue={(o) => o.value}
              placeholder="Status WMS"
            />
          </div>
          <div className="w-56">
            <SearchableSelect
              value={clienteFilter}
              onChange={(label) => setClienteFilter(label)}
              options={clienteFilterOptions}
              getOptionLabel={(c) => c.nome}
              getOptionValue={(c) => c.id}
              placeholder="Todos os clientes"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-5 py-3 font-medium">ID</th>
                <th className="px-5 py-3 font-medium">Entrada</th>
                <th className="px-5 py-3 font-medium">Produto</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Cliente</th>
                <th className="px-5 py-3 font-medium">Lote</th>
                <th className="px-5 py-3 font-medium text-center align-middle">Saldo Inicial</th>
                <th className="px-5 py-3 font-medium text-center align-middle">Saldo Expedido</th>
                <th className="px-5 py-3 font-medium text-center align-middle">Saldo Atual</th>
                <th className="px-5 py-3 font-medium">Unidade</th>
                <th className="px-5 py-3 font-medium">Status WMS</th>
                <th className="px-5 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando estoque...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum registro de estoque encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((e, i) => {
                  const saldoZerado = Number(e.saldo_atual) === 0;
                  // Recalcula na renderização (não depende de saldo_atual stale após HMR)
                  const qtdOp = getEstoqueQuantidade(e);
                  const saldoAtualOp = computeEstoqueSaldo(
                    e,
                    transbordos,
                    saidas,
                    vasilhames
                  );
                  const saldoExpedidoOp = Math.max(0, qtdOp - saldoAtualOp);
                  const saldoInicialEntrada = valorNaUnidadeEntrada(e, qtdOp);
                  const saldoExpedidoEntrada = valorNaUnidadeEntrada(
                    e,
                    saldoExpedidoOp
                  );
                  const saldoAtualEntrada = valorNaUnidadeEntrada(e, saldoAtualOp);
                  const unidadeEntrada = getEstoqueUnidadeEntrada(e);
                  const isExpanded = !!expandedLocais[e.id];
                  const locais = isExpanded
                    ? computeEstoqueQuantidadesPorLocal(e, {
                        transbordos,
                        vasilhames,
                        saidas,
                      })
                    : null;
                  return (
                  <Fragment key={e.id}>
                  <tr
                    className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                      i % 2 === 1 ? "bg-muted/40/30" : ""
                    } ${saldoZerado ? "opacity-50" : ""}`}
                  >
                    <td className="px-5 py-3 font-medium text-primary">
                      {formatEstoqueCodigo(e.codigo_estoque)}
                    </td>
                    <td className="px-5 py-3 font-medium text-foreground">
                      {getEstoqueEntradaLabel(e)}
                    </td>
                    <td className="px-5 py-3 text-foreground max-w-[28rem]" title={[e.produto_codigo, e.produto_nome].filter(Boolean).join(" - ") || undefined}>
                      {e.produto_codigo && e.produto_nome
                        ? `${e.produto_codigo} - ${e.produto_nome}`
                        : e.produto_codigo || e.produto_nome || "-"}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">{e.cliente_nome || "-"}</td>
                    <td className="px-5 py-3 text-muted-foreground">{e.lote || "-"}</td>
                    <td className="px-5 py-3 text-center align-middle">
                      <div className="flex items-center justify-center">
                        <SaldoBadge tone="blue">
                          {formatValorNaUnidadeEntrada(e, saldoInicialEntrada)}
                        </SaldoBadge>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center align-middle">
                      <div className="flex items-center justify-center">
                        <SaldoBadge tone="red">
                          {formatValorNaUnidadeEntrada(e, saldoExpedidoEntrada)}
                        </SaldoBadge>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center align-middle">
                      <div className="flex items-center justify-center">
                        <SaldoBadge tone="green">
                          {formatValorNaUnidadeEntrada(e, saldoAtualEntrada)}
                        </SaldoBadge>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {unidadeEntrada}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={!!e.status_wms}
                          onCheckedChange={(checked) => handleToggleWms(e, checked)}
                          className={
                            e.status_wms
                              ? "data-[state=checked]:bg-green-500"
                              : "data-[state=unchecked]:bg-orange-400"
                          }
                          title={e.status_wms ? "OK — clique para NOK" : "NOK — clique para OK"}
                        />
                        <span
                          className={`text-xs font-semibold ${
                            e.status_wms ? "text-green-600" : "text-orange-600"
                          }`}
                        >
                          {e.status_wms ? "OK" : "NOK"}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedLocais((prev) => ({
                              ...prev,
                              [e.id]: !prev[e.id],
                            }))
                          }
                          className={`transition-colors ${
                            isExpanded
                              ? "text-primary"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                          title={
                            isExpanded
                              ? "Ocultar locais de armazenamento"
                              : "Locais de armazenamento"
                          }
                          aria-expanded={isExpanded}
                        >
                          <MapPin className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleView(e)}
                          className="text-muted-foreground hover:text-muted-foreground transition-colors"
                          title="Visualizar"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEdit(e)}
                          className="text-muted-foreground hover:text-muted-foreground transition-colors"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(e.id)}
                          className="text-red-400 hover:text-red-600 transition-colors"
                          title="Excluir"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && locais && (
                    <tr className="border-b border-border bg-muted/20">
                      <td colSpan={11} className="px-5 py-3">
                        <div className="flex items-center gap-2 mb-2.5">
                          <ChevronDown className="w-3.5 h-3.5 text-primary rotate-180" />
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Locais de armazenamento
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <LocalArmazenamentoCard
                            title="Vasilhames"
                            quantidade={locais.vasilhames}
                            unidade={locais.unidade}
                            estoqueItem={e}
                            navigateLabel="Abrir Vasilhames filtrado por este estoque"
                            onNavigate={() =>
                              navigate("/chemflow/vasilhames", {
                                state: {
                                  estoqueId: e.id,
                                  estoqueCodigo:
                                    formatEstoqueCodigo(e.codigo_estoque) ||
                                    e.id,
                                },
                              })
                            }
                          />
                          <LocalArmazenamentoCard
                            title="Tankas"
                            quantidade={locais.tankas}
                            unidade={locais.unidade}
                            estoqueItem={e}
                            navigateLabel="Abrir Tankagem filtrada por este estoque"
                            onNavigate={() =>
                              navigate("/chemflow/tankagem", {
                                state: {
                                  estoqueId: e.id,
                                  estoqueCodigo:
                                    formatEstoqueCodigo(e.codigo_estoque) ||
                                    e.id,
                                },
                              })
                            }
                          />
                          <LocalArmazenamentoCard
                            title="Armazenagem pátio"
                            quantidade={locais.patio}
                            unidade={locais.unidade}
                            estoqueItem={e}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary */}
        <div className="flex items-center justify-between gap-6 px-5 py-3 border-t border-border text-sm flex-wrap shrink-0">
          <span className="text-muted-foreground">
            Itens exibidos:{" "}
            <span className="font-medium text-foreground">{filtered.length}</span>
          </span>
          <span className="text-muted-foreground">
            Qtd. total em estoque:{" "}
            <span className="font-medium text-foreground">
              {formatMass(totalSaldo)}
            </span>{" "}
            (unid. mistas)
          </span>
          <span className="text-muted-foreground">
            Custo total:{" "}
            <span className="font-medium text-green-600">
              {formatCurrency(totalCusto)}
            </span>
          </span>
        </div>
      </div>

      {/* Edição simplificada do estoque */}
      <EstoqueEditModal
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          setEditingItem(null);
        }}
        onSave={handleEditSave}
        item={editingItem}
      />

      {/* View Dialog */}
      <EstoqueViewDialog
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewItem(null);
        }}
        item={viewItem}
        displayId={getEstoqueEntradaLabel(viewItem)}
        estoqueCodigo={formatEstoqueCodigo(viewItem?.codigo_estoque)}
        transbordos={transbordos}
        saidas={saidas}
        vasilhames={vasilhames}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este registro de estoque? Esta ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}