import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { entities } from '@transbordo/services/entities';
import { listProdutos } from '@transbordo/lib/cadastroProdutosCentral';
import { listTankas } from '@transbordo/lib/cadastroTankaCentral';
import { isUnidadeMassaEntrada, isUnidadeVolumeEntrada, normalizeUnidadeEntrada } from "@transbordo/lib/estoqueSaldo";
import { findLinkedTransbordo, findAllLinkedTransbordos } from "@transbordo/lib/findLinkedTransbordo";
import { Plus, Search, Eye, Pencil, Trash2 } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import { RowActionButton } from "@shared/components/ui/RowActionButton";
import { Input } from "@shared/components/ui/input";
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
import TransbordoModal from "@transbordo/components/transbordo/TransbordoModal";
import TransbordoViewDialog from "@transbordo/components/transbordo/TransbordoViewDialog";
import {
  formatVolume,
  formatMass,
  parseDensidade,
  roundMass,
  resolveVolumeMassaOperacional,
} from "@transbordo/lib/format";
import {
  healTransbordoDensidadeMassaPatch,
  resolveDensidadeOperacional,
} from "@transbordo/lib/densidadeOperacional";
import { healLinkedLotes } from "@transbordo/lib/cascadeEntradaUpdate";
import {
  migrateEstoqueEmbaladoParaVasilhames,
  normalizeBarrilEmbalagensUnitarias,
  consolidateUnitarioVasilhamesDuplicados,
} from "@transbordo/lib/transbordoEmbalado";
import { persistTransbordo } from "@transbordo/lib/persistTransbordo";
import { excluirTransbordo } from "@transbordo/lib/excluirTransbordo";
import {
  applyDeclaredVolumeDecimals,
  persistDeclaredVolumeDecimals,
} from "@transbordo/lib/declaredVolume";
import { loadTransbordoWorkspaceLists } from "@transbordo/services/transbordoWorkspace";
import { withScreenLoadPerf } from "@shared/lib/perfMarks";
import { useDebouncedValue } from "@shared/hooks/useDebouncedValue";
import { ServerPaginationBar } from "@shared/components/ServerPaginationBar";
import { DEFAULT_PAGE_SIZE } from "@shared/lib/pagination";


function labelUnidadeEntrada(unidade) {
  const u = normalizeUnidadeEntrada(unidade);
  if (u === "l") return "L";
  if (u === "gal") return "gal";
  if (u === "kg") return "kg";
  if (u === "lb") return "lb";
  return String(unidade || "").trim() || "";
}

function resolveOrigemBadge(transbordo) {
  const parseOrigemItem = (raw) => {
    const key = String(raw || "").trim().toLowerCase();
    if (!key) return null;
    if (key === "granel" || key === "entrada") {
      return {
        key: "granel",
        label: "GRANEL",
        badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
      };
    }
    if (key === "tanka") {
      return {
        key: "tanka",
        label: "TANKA",
        badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
      };
    }
    if (key === "vasilhame") {
      return {
        key: "vasilhame",
        label: "VASILHAME",
        badgeClass: "bg-orange-50 text-orange-700 border-orange-200",
      };
    }
    if (
      key === "embalado" ||
      key === "ibc" ||
      key === "bombona" ||
      key === "tambor"
    ) {
      return {
        key: "embalado",
        label: "IBC / BOMBONA / TAMBOR",
        badgeClass: "bg-purple-50 text-purple-700 border-purple-200",
      };
    }
    return {
      key,
      label: String(raw).toUpperCase(),
      badgeClass: "bg-slate-50 text-slate-700 border-slate-200",
    };
  };

  if (transbordo?.origem_tipo) {
    const item = parseOrigemItem(transbordo.origem_tipo);
    if (item) return [item];
  }
  const origens = Array.isArray(transbordo?.origens) ? transbordo.origens : [];
  if (origens.length > 0) {
    const uniqueMap = new Map();
    origens.forEach((o) => {
      const raw = o?.tipo_origem || (o?.embalado ? "embalado" : "");
      const item = parseOrigemItem(raw);
      if (item && !uniqueMap.has(item.key)) {
        uniqueMap.set(item.key, item);
      }
    });
    if (uniqueMap.size > 0) return Array.from(uniqueMap.values());
  }
  return [];
}

/** Embalado vs granel a partir das origens do OP. */
function resolveTransbordoMedida(transbordo) {
  const origens = Array.isArray(transbordo?.origens) ? transbordo.origens : [];
  for (const o of origens) {
    if (o?.tipo_origem === "embalado" || o?.embalado) {
      return {
        embalado: true,
        unidade: o.unidade_medida || "kg",
      };
    }
  }
  const first = origens[0];
  if (
    first?.unidade_medida &&
    isUnidadeMassaEntrada(first.unidade_medida) &&
    (first.embalado || first.tipo_origem === "embalado")
  ) {
    return { embalado: true, unidade: first.unidade_medida };
  }
  return { embalado: false, unidade: first?.unidade_medida || "L" };
}

/** Volume (L) e massa (kg) canônicos do OP para listagem/totais. */
function resolveTransbordoVolumeMassaNumeros(
  transbordo,
  { produtos = [], entradas = [] } = {}
) {
  const medida = resolveTransbordoMedida(transbordo);
  const isEmbalado = Boolean(medida.embalado);
  const umIsVolume = isUnidadeVolumeEntrada(medida.unidade);
  const vol = Number(transbordo?.volume_total) || 0;
  const mass = Number(transbordo?.massa_total) || 0;
  const densidade = resolveDensidadeOperacional({
    densidade: transbordo?.densidade,
    produtos,
    produto: (produtos || []).find(
      (p) => String(p.id) === String(transbordo?.produto_id)
    ),
    entradas,
    origens: transbordo?.origens,
  });

  if (isEmbalado && !umIsVolume) {
    // volume_total persistido em kg/lb. Se massa_total foi corrompida
    // (kg × dens), usa o volume como massa canônica.
    const densN = parseDensidade(densidade);
    let massKg = mass > 0 ? mass : vol;
    if (
      vol > 0 &&
      mass > 0 &&
      densN > 0 &&
      Math.abs(densN - 1) > 1e-6 &&
      Math.abs(mass - roundMass(vol * densN)) <= Math.max(1, Math.abs(vol) * 0.02) &&
      Math.abs(mass - vol) > Math.max(1, Math.abs(vol) * 0.02)
    ) {
      massKg = vol;
    }
    const { volume: volL } = resolveVolumeMassaOperacional({
      massa: massKg,
      densidade,
    });
    return { volumeL: volL, massaKg: massKg };
  }

  if (isEmbalado && umIsVolume) {
    const qtdVol = vol > 0 ? vol : mass;
    const resolved = resolveVolumeMassaOperacional({
      volume: qtdVol,
      densidade,
    });
    return {
      volumeL: qtdVol,
      massaKg: parseDensidade(densidade) > 0 ? resolved.massa : 0,
    };
  }

  const densOk = parseDensidade(densidade) > 0;
  const resolved = resolveVolumeMassaOperacional({
    volume: vol,
    // Recalcula pela dens da entrada quando o OP ficou sem massa ou dens errada.
    massa: densOk ? 0 : mass,
    densidade,
  });
  return { volumeL: resolved.volume, massaKg: resolved.massa };
}

function renderTransbordoVolumeQuantidade(
  transbordo,
  { produtos = [], entradas = [] } = {}
) {
  const medida = resolveTransbordoMedida(transbordo);
  const umLabel = labelUnidadeEntrada(medida.unidade);
  const isEmbalado = Boolean(medida.embalado);
  const umIsVolume = isUnidadeVolumeEntrada(medida.unidade);
  const { volumeL, massaKg } = resolveTransbordoVolumeMassaNumeros(transbordo, {
    produtos,
    entradas,
  });

  if (isEmbalado && !umIsVolume) {
    return {
      volume:
        volumeL > 0 ? `${formatVolume(volumeL, { empty: "-" })} L` : "-",
      quantidade:
        massaKg > 0
          ? `${formatMass(massaKg, { empty: "-" })}${umLabel ? ` ${umLabel}` : ""}`
          : "-",
    };
  }

  if (isEmbalado && umIsVolume) {
    const volTxt =
      volumeL > 0
        ? `${formatVolume(volumeL, { empty: "-" })} ${umLabel || "L"}`
        : "-";
    const qtdTxt =
      massaKg > 0
        ? `${formatMass(massaKg, { empty: "-" })} kg`
        : volTxt;
    return { volume: volTxt, quantidade: qtdTxt };
  }

  return {
    volume:
      volumeL > 0
        ? `${formatVolume(volumeL, { empty: "-" })} L`
        : "-",
    quantidade:
      massaKg > 0
        ? `${formatMass(massaKg, { empty: "-" })} kg`
        : "-",
  };
}

/**
 * Listas base da tela. Transbordos/estoque/vasilhames vêm do workspace
 * compartilhado (cache curto, vasilhames reaproveitados na hidratação do
 * estoque); o restante é buscado em paralelo.
 */
async function fetchTransbordoLists({ force = false } = {}) {
  const [workspace, prods, cliens, isos, entradasDoc] = await Promise.all([
    loadTransbordoWorkspaceLists({ force }),
    listProdutos({ modulo: "ARMAZENAGEM" }),
    entities.clientes.list(),
    listTankas(),
    entities.entradas.list(),
  ]);
  return {
    trans: workspace.transbordos,
    ents: workspace.estoque,
    vascs: workspace.vasilhames,
    prods,
    cliens,
    isos,
    entradasDoc,
  };
}

export default function Transbordo() {
  const [transbordos, setTransbordos] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [entradas, setEntradas] = useState([]);
  const [isotanques, setIsotanques] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [search, setSearch] = useState("");
  const [clienteFilter, setClienteFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTransbordo, setEditingTransbordo] = useState(null);
  const [readOnly, setReadOnly] = useState(false);
  const [viewTransbordo, setViewTransbordo] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [page, setPage] = useState(1);
  const loadSeqRef = useRef(0);
  const debouncedSearch = useDebouncedValue(search);
  const [saveError, setSaveError] = useState("");
  const [prefillConsumed, setPrefillConsumed] = useState(false);
  const [activePrefill, setActivePrefill] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const prefillEntrada = location.state?.prefillEntrada;
  const linkedTransbordoFromNav = location.state?.linkedTransbordo;
  const linkedTransbordoIdFromNav = location.state?.linkedTransbordoId;

  const clearPrefillNavigation = () => {
    if (location.state?.prefillEntrada || location.state?.linkedTransbordo) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  };

  /**
   * Migrações + heals fora do caminho crítico: rodam depois do primeiro paint
   * e atualizam o estado ao terminar. Resultados de rodadas obsoletas
   * (nova carga ou unmount) são descartados.
   */
  const runBackgroundMaintenance = async (seq, snapshot) => {
    setSyncing(true);
    try {
      let { volumes, prods, entradasDoc } = snapshot;
      let cliens = snapshot.cliens;
      let isos = snapshot.isos;
      let migrationChanged = false;

      // Migra Bombona/IBC/Tambor legados do Estoque → Vasilhames
      try {
        const mig = await migrateEstoqueEmbaladoParaVasilhames();
        if (mig.deletedEstoque > 0) {
          console.info(
            `[ChemFlow] Migrados ${mig.migrated} embalagem(ns) do Estoque → Vasilhames; removidos ${mig.deletedEstoque} do estoque.`
          );
        }
        const norm = await normalizeBarrilEmbalagensUnitarias();
        const cons = await consolidateUnitarioVasilhamesDuplicados();
        if (cons.deleted > 0) {
          console.info(
            `[ChemFlow] Consolidadas ${cons.mergedGroups} embalagem(ns) unitária(s); removidas ${cons.deleted} linha(s) duplicada(s).`
          );
        }
        migrationChanged =
          mig.migrated > 0 ||
          mig.deletedEstoque > 0 ||
          norm?.updated > 0 ||
          cons.deleted > 0;
      } catch (migErr) {
        console.warn("[ChemFlow] Migração embalado (estoque→vasilhame):", migErr);
      }
      if (seq !== loadSeqRef.current) return;

      // Só refaz a busca se a migração realmente alterou dados.
      if (migrationChanged) {
        const fresh = await fetchTransbordoLists({ force: true });
        if (seq !== loadSeqRef.current) return;
        volumes = applyDeclaredVolumeDecimals({
          estoque: fresh.ents,
          entradas: fresh.entradasDoc,
          transbordos: fresh.trans,
          vasilhames: fresh.vascs,
        });
        void persistDeclaredVolumeDecimals(volumes);
        prods = fresh.prods;
        cliens = fresh.cliens;
        isos = fresh.isos;
        entradasDoc = fresh.entradasDoc;
      }

      let transbordosAlinhados = volumes.transbordos;
      let vasilhamesAlinhados = volumes.vasilhames;
      try {
        // Lote da entrada é a fonte: realinha cópias antigas (ex.: "Não informado").
        const healed = await healLinkedLotes({
          estoqueRows: volumes.estoque,
          transbordos: volumes.transbordos,
          vasilhames: volumes.vasilhames,
        });
        transbordosAlinhados = healed.transbordos || transbordosAlinhados;
        vasilhamesAlinhados = healed.vasilhames || vasilhamesAlinhados;
      } catch (healErr) {
        console.error("[Transbordo] Falha ao alinhar lotes:", healErr);
      }
      // Densidade/massa: entrada do lote prevalece (Tanka sem dens / dens do produto).
      try {
        const densCtx = {
          produtos: prods,
          entradas: [...(volumes.estoque || []), ...(entradasDoc || [])],
        };
        const densUpdates = [];
        const nextTrans = [];
        for (const t of transbordosAlinhados || []) {
          const patch = healTransbordoDensidadeMassaPatch(t, densCtx);
          if (!patch) {
            nextTrans.push(t);
            continue;
          }
          densUpdates.push({ id: t.id, ...patch });
          nextTrans.push({ ...t, ...patch });
        }
        if (densUpdates.length > 0) {
          await entities.transbordos.bulkUpdate(densUpdates);
        }
        transbordosAlinhados = nextTrans;
      } catch (densErr) {
        console.error(
          "[Transbordo] Falha ao alinhar densidade/massa dos OPs:",
          densErr
        );
      }
      if (seq !== loadSeqRef.current) return;
      setTransbordos(transbordosAlinhados);
      setProdutos(prods);
      setClientes(cliens);
      setEntradas(volumes.estoque);
      setIsotanques(isos);
      setVasilhames(vasilhamesAlinhados);
    } catch (maintErr) {
      console.warn("[Transbordo] Manutenção em segundo plano falhou:", maintErr);
    } finally {
      if (seq === loadSeqRef.current) setSyncing(false);
    }
  };

  const loadData = async ({ silent = false } = {}) => {
    const seq = ++loadSeqRef.current;
    if (!silent) setLoading(true);
    let snapshot = null;
    try {
      snapshot = await withScreenLoadPerf("transbordo", async () => {
        // Recargas silenciosas (pós-save/delete) ignoram o cache do workspace.
        const lists = await fetchTransbordoLists({ force: silent });
        const volumes = applyDeclaredVolumeDecimals({
          estoque: lists.ents,
          entradas: lists.entradasDoc,
          transbordos: lists.trans,
          vasilhames: lists.vascs,
        });
        void persistDeclaredVolumeDecimals(volumes);
        if (seq !== loadSeqRef.current) return null;
        // Primeiro paint com as listas cruas; heals chegam em segundo plano.
        setTransbordos(volumes.transbordos);
        setProdutos(lists.prods);
        setClientes(lists.cliens);
        setEntradas(volumes.estoque);
        setIsotanques(lists.isos);
        setVasilhames(volumes.vasilhames);
        return {
          volumes,
          prods: lists.prods,
          cliens: lists.cliens,
          isos: lists.isos,
          entradasDoc: lists.entradasDoc,
        };
      });
    } catch {
      if (!silent) setTransbordos([]);
    }
    if (!silent) setLoading(false);
    if (snapshot) void runBackgroundMaintenance(seq, snapshot);
  };

  useEffect(() => {
    loadData();
    // Invalida rodadas em andamento ao desmontar (evita setState após unmount).
    return () => {
      loadSeqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (prefillEntrada && !loading && !prefillConsumed) {
      const allLinked = findAllLinkedTransbordos(
        transbordos,
        prefillEntrada,
        entradas,
        vasilhames
      );

      // Preferência: OP da navegação; senão OP único; senão o mais antigo da cadeia.
      let linked =
        (linkedTransbordoIdFromNav &&
          transbordos.find((t) => t.id === linkedTransbordoIdFromNav)) ||
        linkedTransbordoFromNav ||
        findLinkedTransbordo(transbordos, prefillEntrada, entradas, vasilhames) ||
        allLinked[0] ||
        null;

      // Garante versão fresca da lista carregada (com destinos completos)
      if (linked?.id) {
        linked = transbordos.find((t) => t.id === linked.id) || linked;
      }

      setEditingTransbordo(linked || null);
      setActivePrefill(prefillEntrada);
      setReadOnly(false);
      setSaveError("");
      setModalOpen(true);
      setPrefillConsumed(true);
    }
  }, [
    prefillEntrada,
    loading,
    prefillConsumed,
    transbordos,
    entradas,
    vasilhames,
    linkedTransbordoFromNav,
    linkedTransbordoIdFromNav,
  ]);

  const filtered = useMemo(() => transbordos.filter((t) => {
    const q = debouncedSearch.toLowerCase().trim();
    const matchSearch =
      !q ||
      t.codigo_transbordo?.toLowerCase().includes(q) ||
      t.produto_nome?.toLowerCase().includes(q) ||
      t.produto_codigo?.toLowerCase().includes(q) ||
      t.cliente_nome?.toLowerCase().includes(q) ||
      (t.operadores || []).some((op) => op.toLowerCase().includes(q)) ||
      (t.destinos || []).some(
        (d) =>
          d.tanka_codigo?.toLowerCase().includes(q) ||
          d.placa?.toLowerCase().includes(q)
      ) ||
      (t.origens || []).some(
        (o) =>
          (o.tipo_origem === "tanka" &&
            o.entrada_codigo?.toLowerCase().includes(q)) ||
          o.lote?.toLowerCase().includes(q)
      );

    const matchCliente =
      !clienteFilter ||
      clienteFilter === "Todos os clientes" ||
      t.cliente_nome === clienteFilter;

    return matchSearch && matchCliente;
  }), [transbordos, debouncedSearch, clienteFilter]);

  // Volta à primeira página quando o filtro muda.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, clienteFilter]);

  const pageRows = useMemo(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / DEFAULT_PAGE_SIZE));
    const current = Math.min(page, maxPage);
    const start = (current - 1) * DEFAULT_PAGE_SIZE;
    return filtered.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filtered, page]);

  /** Largura da coluna Produto limitada (não estica com nomes longos). */
  const produtoColCh = useMemo(() => {
    let maxLen = "Produto".length;
    for (const p of produtos) {
      const label = `${p.codigo ? `${p.codigo} - ` : ""}${p.produto || p.nome || ""}`;
      if (label.length > maxLen) maxLen = label.length;
    }
    for (const t of transbordos) {
      const label = `${t.produto_codigo ? `${t.produto_codigo} - ` : ""}${t.produto_nome || ""}`;
      if (label.length > maxLen) maxLen = label.length;
    }
    // Cabe o conteúdo, mas limita nomes muito longos
    return Math.min(Math.max(maxLen, 10), 36);
  }, [produtos, transbordos]);

  const formatDate = (d) => {
    if (!d) return "-";
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("pt-BR");
  };

  const handleNew = () => {
    setEditingTransbordo(null);
    setActivePrefill(null);
    clearPrefillNavigation();
    setReadOnly(false);
    setSaveError("");
    setModalOpen(true);
  };

  const handleEdit = (t) => {
    setEditingTransbordo(t);
    setActivePrefill(null);
    clearPrefillNavigation();
    setReadOnly(false);
    setSaveError("");
    setModalOpen(true);
  };

  const handleView = (t) => {
    setViewTransbordo(t);
    setViewOpen(true);
  };

  const handleSave = async (data) => {
    setSaveError("");
    try {
      await persistTransbordo({
        data,
        editingTransbordo,
        transbordos,
        produtos,
        isotanques,
        vasilhames,
      });
      await loadData({ silent: true });
      setModalOpen(false);
      setEditingTransbordo(null);
      setActivePrefill(null);
      clearPrefillNavigation();
    } catch (err) {
      console.error("[ChemFlow] Erro ao registrar transbordo:", err);
      setSaveError(
        err?.message ||
          "Não foi possível registrar o transbordo. Verifique os dados e tente novamente."
      );
    }
  };

  const handleDelete = async () => {
    const id = deleteId;
    const toDelete = transbordos.find((t) => t.id === id);
    if (!toDelete) {
      setDeleteId(null);
      return;
    }

    setDeleteId(null);
    setTransbordos((prev) => prev.filter((t) => t.id !== id));

    try {
      const produtoFiltrado = !!produtos.find(
        (p) => p.id === toDelete.produto_id
      )?.filtrado;

      await excluirTransbordo({
        transbordo: toDelete,
        transbordos,
        isotanques,
        vasilhames,
        produtoFiltrado,
      });

      await loadData({ silent: true });
    } catch (err) {
      console.error("[ChemFlow] Erro ao excluir transbordo:", err);
      await loadData({ silent: true });
    }
  };

  const clienteFilterOptions = [
    { id: "all", nome: "Todos os clientes" },
    ...clientes,
  ];

  // Totais sobre todo o conjunto filtrado (não só a página), numa única passada.
  const { totalVolume, totalMassa } = useMemo(() => {
    const densCtx = { produtos, entradas };
    let vol = 0;
    let massa = 0;
    for (const t of filtered) {
      const { volumeL, massaKg } = resolveTransbordoVolumeMassaNumeros(t, densCtx);
      vol += volumeL || 0;
      massa += massaKg || 0;
    }
    return { totalVolume: vol, totalMassa: massa };
  }, [filtered, produtos, entradas]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Transbordos</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {transbordos.length} registro(s) cadastrado(s)
              {syncing && (
                <span className="ml-2 text-xs" role="status" aria-live="polite">
                  · Sincronizando…
                </span>
              )}
            </p>
          </div>
          <Button onClick={handleNew} className="bg-primary hover:bg-primary/90 gap-2">
            <Plus className="w-4 h-4" />
            Novo Transbordo
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por tanka, produto ou cliente..."
              className="pl-10 bg-card"
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
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">ID</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">Data</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">Origem</th>
                <th
                  className="px-4 py-3 font-medium whitespace-nowrap"
                  style={{ width: `${produtoColCh}ch`, maxWidth: `${produtoColCh}ch` }}
                >
                  Produto
                </th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">Cliente</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">Volume</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">Quantidade</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">Operadores</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando transbordos...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum transbordo encontrado.
                  </td>
                </tr>
              ) : (
                pageRows.map((t, i) => {
                  const produtoLabel = `${t.produto_codigo ? `${t.produto_codigo} - ` : ""}${t.produto_nome || "-"}`;
                  const { volume: volumeCell, quantidade: quantidadeCell } =
                    renderTransbordoVolumeQuantidade(t, {
                      produtos,
                      entradas,
                    });
                  const origemBadges = resolveOrigemBadge(t);
                  return (
                  <tr
                    key={t.id}
                    className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                      i % 2 === 1 ? "bg-muted/40/30" : ""
                    }`}
                  >
                    <td className="px-4 py-3 align-middle font-medium text-primary whitespace-nowrap">
                      {t.codigo_transbordo || "-"}
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground whitespace-nowrap">
                      {formatDate(t.data)}
                    </td>
                    <td className="px-4 py-3 align-middle whitespace-nowrap">
                      {origemBadges.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {origemBadges.map((b) => (
                            <span
                              key={b.key}
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${b.badgeClass}`}
                            >
                              {b.label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td
                      className="px-4 py-3 align-middle text-foreground"
                      style={{ width: `${produtoColCh}ch`, maxWidth: `${produtoColCh}ch` }}
                    >
                      <span className="block truncate" title={produtoLabel}>
                        {produtoLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground whitespace-nowrap w-0">
                      {t.cliente_nome || "-"}
                    </td>
                    <td className="px-4 py-3 align-middle text-foreground font-medium whitespace-nowrap">
                      {volumeCell}
                    </td>
                    <td className="px-4 py-3 align-middle text-foreground font-medium whitespace-nowrap">
                      {quantidadeCell}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex flex-nowrap items-center gap-1 overflow-hidden">
                        {(t.operadores || []).slice(0, 2).map((op) => (
                          <span
                            key={op}
                            className="inline-flex shrink-0 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium whitespace-nowrap"
                          >
                            {op.split(" ")[0]}
                          </span>
                        ))}
                        {(t.operadores || []).length > 2 && (
                          <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                            +{t.operadores.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-1 whitespace-nowrap">
                        <RowActionButton onClick={() => handleView(t)} title="Visualizar">
                          <Eye />
                        </RowActionButton>
                        <RowActionButton onClick={() => handleEdit(t)} title="Editar">
                          <Pencil />
                        </RowActionButton>
                        <RowActionButton tone="danger" onClick={() => setDeleteId(t.id)} title="Excluir">
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

        {filtered.length > DEFAULT_PAGE_SIZE && (
          <ServerPaginationBar
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            total={filtered.length}
            onPageChange={setPage}
            className="px-5 border-t border-border shrink-0"
          />
        )}

        {/* Footer Summary */}
        <div className="flex items-center justify-between gap-6 px-5 py-3 border-t border-border text-sm flex-wrap shrink-0">
          <span className="text-muted-foreground">
            Itens exibidos: <span className="font-medium text-foreground">{filtered.length}</span>
          </span>
          <span className="text-muted-foreground">
            Volume total: <span className="font-medium text-foreground">{formatVolume(totalVolume)} L</span>
          </span>
          <span className="text-muted-foreground">
            Quantidade total: <span className="font-medium text-foreground">{formatMass(totalMassa)} kg</span>
          </span>
        </div>
      </div>

      {/* Modal */}
      <TransbordoModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingTransbordo(null);
          setActivePrefill(null);
          clearPrefillNavigation();
          setReadOnly(false);
          setSaveError("");
        }}
        onSave={handleSave}
        editingTransbordo={editingTransbordo}
        readOnly={readOnly}
        clientes={clientes}
        produtos={produtos}
        entradas={entradas}
        isotanques={isotanques}
        vasilhames={vasilhames}
        transbordos={transbordos}
        prefillEntrada={activePrefill}
        externalError={saveError}
      />

      {/* View Dialog */}
      <TransbordoViewDialog
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewTransbordo(null);
        }}
        transbordo={viewTransbordo}
        produtos={produtos}
        entradas={entradas}
        isotanques={isotanques}
        vasilhames={vasilhames}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este transbordo? O volume disponível
              nas origens será restaurado e as embalagens criadas por esta
              operação serão removidas. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
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
