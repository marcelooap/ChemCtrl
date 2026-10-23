import { useState, useEffect, useMemo, useRef } from "react";
import { entities } from '@transbordo/services/entities';
import { Search, Eye, Pencil, Trash2 } from "lucide-react";
import { Input } from "@shared/components/ui/input";
import { RowActionButton } from "@shared/components/ui/RowActionButton";
import { Switch } from "@shared/components/ui/switch";
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
import { formatVolume, formatCurrency, formatQuantidade } from "@transbordo/lib/format";
import {
  applyDeclaredVolumeDecimals,
  persistDeclaredVolumeDecimals,
} from "@transbordo/lib/declaredVolume";
import {
  computeEstoqueSaldo,
  computeEstoqueQuantidadesPorLocal,
  createEstoqueSaldoContext,
  getEstoqueQuantidade,
  getEstoqueUnidade,
  getEstoqueUnidadeEntrada,
  valorNaUnidadeEntrada,
  isUnidadeVolumeEntrada,
  hydrateEstoqueFiscal,
} from "@transbordo/lib/estoqueSaldo";
import {
  invalidateTransbordoWorkspaceCache,
  loadTransbordoWorkspaceLists,
  peekTransbordoWorkspaceLists,
} from "@transbordo/services/transbordoWorkspace";
import { isEstoqueEmbalagemUnitaria } from "@transbordo/lib/transbordoEmbalado";
import {
  entradaByIdMap,
  isMateriaPrimaIndustrializacao,
} from "@transbordo/lib/materiaPrimaIndustrializacao";
import { reconcileVasilhamesFromEntradas } from "@transbordo/lib/syncVasilhamesFromEntrada";
import { useSubmitGuard } from "@/shared/hooks/useSubmitGuard";
import { peekScrollAnchor, scheduleScrollRestore } from "@shared/lib/preserveScroll";

const STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "ok", label: "OK" },
  { value: "nok", label: "NOK" },
];

const nullIfEmpty = (v) => (v === "" || v === undefined ? null : v);

function formatValorNaUnidadeEntrada(estoqueItem, valorEntrada) {
  const valor = Number(valorEntrada) || 0;
  if (isUnidadeVolumeEntrada(getEstoqueUnidadeEntrada(estoqueItem))) {
    return formatVolume(valor, { empty: "-" });
  }
  return formatQuantidade(valor, { empty: "-" });
}

/**
 * Monta as linhas da tela a partir do workspace: reaplica casas decimais
 * declaradas, remove embalagens unitárias / MP da Industrialização e calcula
 * o saldo de cada registro uma única vez (contexto compartilhado).
 */
function buildEstoqueView(workspace, entradas = []) {
  const volumes = applyDeclaredVolumeDecimals({
    estoque: workspace.estoque,
    entradas,
    transbordos: workspace.transbordos,
    vasilhames: workspace.vasilhames,
  });
  const saidas = workspace.saidas || [];
  const entradasPorId = entradaByIdMap(entradas);
  const saldoCtx = createEstoqueSaldoContext(
    volumes.transbordos,
    saidas,
    volumes.vasilhames
  );

  // Saldo = quantidade − saídas de vasilhame (pátio/fiscal) − saídas embalado
  // Bombonas/tambores/IBC de OP ficam só em Vasilhames.
  // Matéria-prima da Industrialização fica só no módulo Industrialização.
  const estoque = volumes.estoque
    .filter((e) => !isEstoqueEmbalagemUnitaria(e))
    .filter(
      (e) =>
        !isMateriaPrimaIndustrializacao(
          e,
          entradasPorId.get(String(e?.entrada_id))
        )
    )
    .map((e) => {
      const hydrated = hydrateEstoqueFiscal(e);
      const quantidade = getEstoqueQuantidade(hydrated);
      const unidade_medida = getEstoqueUnidade(hydrated);
      const itemOp = { ...hydrated, quantidade, unidade_medida };
      const saldo_final = computeEstoqueSaldo(
        itemOp,
        volumes.transbordos,
        saidas,
        volumes.vasilhames,
        saldoCtx
      );
      return {
        ...itemOp,
        saldo_inicial: quantidade,
        saldo_final,
        saldo_atual: saldo_final,
        expedido: Math.max(0, quantidade - saldo_final),
      };
    });

  return {
    estoque,
    transbordos: volumes.transbordos,
    saidas,
    vasilhames: volumes.vasilhames,
    volumes,
  };
}

const SKELETON_ROWS = 6;

function LoadingRows({ columns }) {
  return Array.from({ length: SKELETON_ROWS }, (_, i) => (
    <tr key={`sk-${i}`} className="border-b border-border last:border-0" aria-hidden="true">
      {Array.from({ length: columns }, (__, j) => (
        <td key={j} className="px-5 py-3">
          <div className="h-4 w-full max-w-[9rem] rounded bg-muted animate-pulse" />
        </td>
      ))}
    </tr>
  ));
}

function SaldoBadge({ children, tone }) {
  const tones = {
    blue: "bg-sky-100 text-sky-800",
    red: "bg-red-100 text-red-700",
    green: "bg-green-100 text-green-700",
    muted: "bg-muted text-muted-foreground",
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

export default function Estoque() {
  const [estoque, setEstoque] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [entradas, setEntradas] = useState([]);
  const [transbordos, setTransbordos] = useState([]);
  const [saidas, setSaidas] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [clienteFilter, setClienteFilter] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewItem, setViewItem] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [loading, setLoading] = useState(true);
  const { busy: submitBusy, run: runSubmit } = useSubmitGuard();

  // Sequência de carga: descarta respostas de cargas antigas (ex.: reload silencioso
  // disparado por uma edição enquanto o auto-reparo ainda estava em andamento).
  const loadSeqRef = useRef(0);
  const entradasRef = useRef([]);
  entradasRef.current = entradas;

  const applyView = (view) => {
    setEstoque(view.estoque);
    setTransbordos(view.transbordos);
    setSaidas(view.saidas);
    setVasilhames(view.vasilhames);
  };

  /**
   * Fora do caminho crítico: códigos E00N / filtro MP (entradas) e auto-reparo
   * de vasilhames de entrada. A tela já está visível quando isto roda.
   */
  async function syncEntradasInBackground(workspace, seq) {
    const isCurrent = () => seq === loadSeqRef.current;
    try {
      const [ents, prods] = await Promise.all([
        entities.entradas.list(),
        entities.produtos.list(),
      ]);
      if (!isCurrent()) return;
      setEntradas(ents);

      // Safety net: espelhos de MP identificados só pela entrada-pai.
      const entradasPorId = entradaByIdMap(ents);
      setEstoque((prev) => {
        const next = prev.filter(
          (e) =>
            !isMateriaPrimaIndustrializacao(
              e,
              entradasPorId.get(String(e?.entrada_id))
            )
        );
        return next.length === prev.length ? prev : next;
      });

      const healed = await reconcileVasilhamesFromEntradas({
        entradas: ents,
        estoque: workspace.estoque,
        vasilhames: workspace.vasilhames,
        produtos: prods,
      });
      if (healed.changed && isCurrent()) {
        await loadData({ silent: true, reconcile: false });
      }
    } catch (err) {
      console.error("[Transbordo] Falha ao sincronizar entradas/vasilhames:", err);
    }
  }

  const loadData = async ({ silent = false, reconcile = true } = {}) => {
    const seq = ++loadSeqRef.current;
    const isCurrent = () => seq === loadSeqRef.current;

    // 1) Dispara a busca de dados frescos antes de qualquer cálculo. Gravações de
    //    outras telas não invalidam o cache do workspace, então a listagem
    //    sempre revalida ao abrir.
    const cached = silent ? null : peekTransbordoWorkspaceLists();
    invalidateTransbordoWorkspaceCache();
    const request = Promise.all([
      loadTransbordoWorkspaceLists({ force: true }),
      entities.clientes.list(),
    ]);

    // 2) Enquanto a rede responde, pinta com o último snapshot do módulo
    //    (stale-while-revalidate) em vez de deixar a tela vazia.
    if (cached) {
      applyView(buildEstoqueView(cached, entradasRef.current));
      setLoading(false);
    } else if (!silent) {
      setLoading(true);
    }

    try {
      const [workspace, cliens] = await request;
      if (!isCurrent()) return;

      const view = buildEstoqueView(workspace, entradasRef.current);
      void persistDeclaredVolumeDecimals(view.volumes);
      applyView(view);
      setClientes(cliens);
      setLoading(false);

      // 3) Entradas + auto-reparo sem bloquear a tela.
      if (reconcile) void syncEntradasInBackground(workspace, seq);
    } catch {
      if (!silent && isCurrent() && !cached) setEstoque([]);
    } finally {
      if (!silent && isCurrent()) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  /** Código da entrada (E001…), para rastrear a origem. */
  const entradaIdMap = useMemo(() => buildEntradaCodigoById(entradas), [entradas]);

  const getEstoqueEntradaLabel = (e) => {
    if (e?.entrada_id && entradaIdMap[e.entrada_id]) {
      return entradaIdMap[e.entrada_id];
    }
    return e?.entrada_codigo || "-";
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return estoque
      .filter((e) => {
        const entradaLabel = (
          e?.entrada_id && entradaIdMap[e.entrada_id]
            ? entradaIdMap[e.entrada_id]
            : e?.entrada_codigo || "-"
        ).toLowerCase();
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
  }, [estoque, search, statusFilter, clienteFilter, entradaIdMap]);

  const { totalSaldo, totalCusto } = useMemo(
    () =>
      filtered.reduce(
        (acc, e) => {
          const saldo = e.saldo_atual || 0;
          acc.totalSaldo += saldo;
          acc.totalCusto += saldo * (e.preco_unitario || 0);
          return acc;
        },
        { totalSaldo: 0, totalCusto: 0 }
      ),
    [filtered]
  );

  const saldoCtx = useMemo(
    () => createEstoqueSaldoContext(transbordos, saidas, vasilhames),
    [transbordos, saidas, vasilhames]
  );

  /**
   * Saldos por local (embalado/pátio, tanque/vasilhame, tanka) para todas as
   * linhas. Calculado por objeto de linha e reaproveitado enquanto
   * transbordos/vasilhames/saídas não mudarem — filtrar, buscar ou alternar o
   * WMS de uma linha não recalcula a lista inteira.
   */
  const locaisCacheRef = useRef({ deps: null, byRow: new WeakMap() });
  const locaisMap = useMemo(() => {
    const store = locaisCacheRef.current;
    const deps = [transbordos, vasilhames, saidas];
    if (!store.deps || store.deps.some((d, i) => d !== deps[i])) {
      store.deps = deps;
      store.byRow = new WeakMap();
    }
    const map = new Map();
    for (const e of estoque) {
      let locais = store.byRow.get(e);
      if (!locais) {
        locais = computeEstoqueQuantidadesPorLocal(e, {
          transbordos,
          vasilhames,
          saidas,
          saldo: e.saldo_atual,
          saldoCtx,
        });
        store.byRow.set(e, locais);
      }
      map.set(e.id, locais);
    }
    return map;
  }, [estoque, transbordos, vasilhames, saidas, saldoCtx]);

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
      saldo_inicial: quantidade,
      quantidade,
      unidade_medida: data.unidade_medida,
      lotes,
    };
    const saldo_final = computeEstoqueSaldo(
      provisional,
      transbordos,
      saidas,
      vasilhames,
      saldoCtx
    );

    const payload = {
      nota_fiscal: data.nota_fiscal,
      nota_fiscal_troca: nullIfEmpty(data.nota_fiscal_troca),
      lote: data.lote,
      saldo_inicial: quantidade,
      quantidade,
      unidade_medida: data.unidade_medida,
      data_fabricacao: nullIfEmpty(data.data_fabricacao),
      data_validade: nullIfEmpty(data.data_validade),
      preco_unitario: preco,
      custo_total: saldo_final * preco,
      saldo_final,
      saldo_atual: saldo_final,
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
          ? hydrateEstoqueFiscal({
              ...e,
              ...payload,
              saldo_inicial: quantidade,
              quantidade,
              saldo_final,
              saldo_atual: saldo_final,
            })
          : e
      )
    );

    await loadData({ silent: true });
  };

  const handleDelete = () => runSubmit(async () => {
    const id = deleteId;
    const snap = peekScrollAnchor();
    setDeleteId(null);
    setEstoque((prev) => prev.filter((e) => e.id !== id));
    try {
      await entities.estoque.delete(id);
      await loadData({ silent: true });
    } catch {
      await loadData({ silent: true });
    }
    scheduleScrollRestore(snap);
  });

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
            </p>
          </div>
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
                <th className="px-5 py-3 font-medium text-center align-middle">Saldo Embalado</th>
                <th className="px-5 py-3 font-medium text-center align-middle">Saldo Tanque</th>
                <th className="px-5 py-3 font-medium text-center align-middle">Saldo Tanka</th>
                <th className="px-5 py-3 font-medium text-center align-middle">Saldo Atual</th>
                <th className="px-5 py-3 font-medium">Unidade</th>
                <th className="px-5 py-3 font-medium">Status WMS</th>
                <th className="px-5 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRows columns={13} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum registro de estoque encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((e, i) => {
                  const saldoZerado = Number(e.saldo_atual) === 0;
                  // Saldo já calculado em buildEstoqueView (contexto compartilhado);
                  // recalcular aqui custava O(transbordos × vasilhames) por linha a cada render.
                  const qtdOp = getEstoqueQuantidade(e);
                  const saldoAtualOp = Number(e.saldo_atual) || 0;
                  const saldoInicialEntrada = valorNaUnidadeEntrada(e, qtdOp);
                  const saldoAtualEntrada = valorNaUnidadeEntrada(e, saldoAtualOp);
                  const unidadeEntrada = getEstoqueUnidadeEntrada(e);
                  // Usa locais pré-computados para as colunas de breakdown
                  const locais = locaisMap.get(e.id) ?? null;
                  const isEmbalado = isEstoqueEmbalagemUnitaria(e);
                  // Para itens granel, locais.patio é a parcela não rastreável via
                  // composicao (gap de litros sem kg/densidade). Soma ao tanque para
                  // não dividir incorretamente um item que está inteiro em vasilhame.
                  // Para embalado, locais.patio são embalagens soltas no pátio.
                  const saldoEmbaladoEntrada = isEmbalado ? (locais?.patio ?? 0) : 0;
                  const saldoTanqueEntrada = isEmbalado
                    ? (locais?.vasilhames ?? 0)
                    : ((locais?.vasilhames ?? 0) + (locais?.patio ?? 0));
                  const saldoTankaEntrada = locais?.tankas ?? 0;
                  return (
                  <tr key={e.id}
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
                    {/* Saldo Inicial */}
                    <td className="px-5 py-3 text-center align-middle">
                      <div className="flex items-center justify-center">
                        <SaldoBadge tone="blue">
                          {formatValorNaUnidadeEntrada(e, saldoInicialEntrada)}
                        </SaldoBadge>
                      </div>
                    </td>
                    {/* Saldo Embalado (pátio) */}
                    <td className="px-5 py-3 text-center align-middle">
                      <div className="flex items-center justify-center">
                        <SaldoBadge tone={saldoEmbaladoEntrada > 0 ? "blue" : "muted"}>
                          {saldoEmbaladoEntrada > 0
                            ? formatValorNaUnidadeEntrada(e, saldoEmbaladoEntrada)
                            : "—"}
                        </SaldoBadge>
                      </div>
                    </td>
                    {/* Saldo Tanque (vasilhames) */}
                    <td className="px-5 py-3 text-center align-middle">
                      <div className="flex items-center justify-center">
                        <SaldoBadge tone={saldoTanqueEntrada > 0 ? "blue" : "muted"}>
                          {saldoTanqueEntrada > 0
                            ? formatValorNaUnidadeEntrada(e, saldoTanqueEntrada)
                            : "—"}
                        </SaldoBadge>
                      </div>
                    </td>
                    {/* Saldo Tanka (isotanques) */}
                    <td className="px-5 py-3 text-center align-middle">
                      <div className="flex items-center justify-center">
                        <SaldoBadge tone={saldoTankaEntrada > 0 ? "blue" : "muted"}>
                          {saldoTankaEntrada > 0
                            ? formatValorNaUnidadeEntrada(e, saldoTankaEntrada)
                            : "—"}
                        </SaldoBadge>
                      </div>
                    </td>
                    {/* Saldo Atual */}
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
                      <div className="flex items-center gap-1">
                        <RowActionButton onClick={() => handleView(e)} title="Visualizar">
                          <Eye />
                        </RowActionButton>
                        <RowActionButton onClick={() => handleEdit(e)} title="Editar">
                          <Pencil />
                        </RowActionButton>
                        <RowActionButton tone="danger" onClick={() => setDeleteId(e.id)} title="Excluir">
                          <Trash2 />
                        </RowActionButton>
                      </div>
                    </td>
                  </tr>
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
              {formatQuantidade(totalSaldo)}
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
              disabled={submitBusy}
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