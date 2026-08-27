import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { entities } from '@transbordo/services/entities';
import { syncEstoqueSaldos, isUnidadeMassaEntrada, isUnidadeVolumeEntrada, normalizeUnidadeEntrada } from "@transbordo/lib/estoqueSaldo";
import { findLinkedTransbordo, findAllLinkedTransbordos, multipleTransbordosMessage } from "@transbordo/lib/findLinkedTransbordo";
import { Plus, Search, Eye, Pencil, Trash2 } from "lucide-react";
import { Button } from "@shared/components/ui/button";
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
} from "@transbordo/lib/format";
import { restoreTankaVasilhamesAfterExclude } from "@transbordo/lib/tankaVolume";
import {
  deleteEstoqueDoTransbordo,
  migrateEstoqueEmbaladoParaVasilhames,
  normalizeBarrilEmbalagensUnitarias,
} from "@transbordo/lib/transbordoEmbalado";
import {
  persistTransbordo,
  revertTopUpsDoTransbordo,
} from "@transbordo/lib/persistTransbordo";


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

function renderTransbordoVolumeQuantidade(transbordo) {
  const medida = resolveTransbordoMedida(transbordo);
  const umLabel = labelUnidadeEntrada(medida.unidade);
  const isEmbalado = Boolean(medida.embalado);
  const umIsVolume = isUnidadeVolumeEntrada(medida.unidade);
  const vol = Number(transbordo?.volume_total) || 0;
  const mass = Number(transbordo?.massa_total) || 0;

  if (isEmbalado && !umIsVolume) {
    const qtd = vol > 0 ? vol : mass;
    return {
      volume: "-",
      quantidade:
        qtd > 0
          ? `${formatMass(qtd, { empty: "-" })}${umLabel ? ` ${umLabel}` : ""}`
          : "-",
    };
  }

  if (isEmbalado && umIsVolume) {
    const qtdTxt =
      vol > 0
        ? `${formatVolume(vol, { empty: "-" })} ${umLabel || "L"}`
        : "-";
    return { volume: qtdTxt, quantidade: qtdTxt };
  }

  return {
    volume: vol > 0 ? `${formatVolume(vol, { empty: "-" })} L` : "-",
    quantidade: mass > 0 ? `${formatMass(mass, { empty: "-" })} kg` : "-",
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
  const [saveError, setSaveError] = useState("");
  const [prefillConsumed, setPrefillConsumed] = useState(false);
  const [activePrefill, setActivePrefill] = useState(null);
  const [chainBlockMessage, setChainBlockMessage] = useState("");
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

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      // Migra Bombona/IBC/Tambor legados do Estoque → Vasilhames
      try {
        const mig = await migrateEstoqueEmbaladoParaVasilhames();
        if (mig.deletedEstoque > 0) {
          console.info(
            `[ChemFlow] Migrados ${mig.migrated} embalagem(ns) do Estoque → Vasilhames; removidos ${mig.deletedEstoque} do estoque.`
          );
        }
        await normalizeBarrilEmbalagensUnitarias();
      } catch (migErr) {
        console.warn("[ChemFlow] Migração embalado (estoque→vasilhame):", migErr);
      }

      const [trans, prods, cliens, ents, isos, vascs] = await Promise.all([
        entities.transbordos.list("-created_date"),
        entities.produtos.list(),
        entities.clientes.list(),
        entities.estoque.list(),
        entities.isotanques.list(),
        entities.vasilhames.list(),
      ]);
      setTransbordos(trans);
      setProdutos(prods);
      setClientes(cliens);
      setEntradas(ents);
      setIsotanques(isos);
      setVasilhames(vascs);
    } catch {
      if (!silent) setTransbordos([]);
    }
    if (!silent) setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (prefillEntrada && !loading && !prefillConsumed) {
      const allLinked = findAllLinkedTransbordos(
        transbordos,
        prefillEntrada,
        entradas,
        vasilhames
      );

      if (allLinked.length > 1) {
        setEditingTransbordo(null);
        setActivePrefill(null);
        setModalOpen(false);
        setPrefillConsumed(true);
        setChainBlockMessage(multipleTransbordosMessage(allLinked));
        clearPrefillNavigation();
        return;
      }

      // Preferência: OP passado na navegação (já resolvido na Entrada)
      let linked =
        (linkedTransbordoIdFromNav &&
          transbordos.find((t) => t.id === linkedTransbordoIdFromNav)) ||
        linkedTransbordoFromNav ||
        findLinkedTransbordo(transbordos, prefillEntrada, entradas, vasilhames);

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

  const filtered = transbordos.filter((t) => {
    const q = search.toLowerCase().trim();
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
  });

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
      const dens = parseDensidade(toDelete.densidade);
      const produtoFiltrado = !!produtos.find(
        (p) => p.id === toDelete.produto_id
      )?.filtrado;

      // IDs de estoque (entrada/embalado) que voltam a ficar disponíveis
      const affectedEstoqueIds = (toDelete.origens || [])
        .filter(
          (o) =>
            (!o.tipo_origem ||
              o.tipo_origem === "entrada" ||
              o.tipo_origem === "embalado") &&
            o.entrada_id
        )
        .map((o) => o.entrada_id);

      // 1) Reverte top-ups em vasilhames fracionados que já existiam
      await revertTopUpsDoTransbordo({
        transbordo: toDelete,
        vasilhamesList: vasilhames,
        densFallback: dens,
        produtoFiltrado,
      });

      // 2) Restaura volume das tankas usadas como origem (se tinham sido zeradas)
      await restoreTankaVasilhamesAfterExclude({
        origens: toDelete.origens || [],
        excludeTransbordoId: toDelete.id,
        isotanques,
        transbordos,
        entities,
        vasilhamesList: vasilhames,
      });

      // 3) Remove embalagens, estoque embalado e filtrações criadas por este transbordo
      await entities.vasilhames.deleteMany({ transbordo_id: id });
      await entities.filtracoes.deleteMany({ transbordo_id: id });
      await deleteEstoqueDoTransbordo(id);

      // 4) Remove o movimento — libera novamente o disponível nas origens de estoque
      await entities.transbordos.delete(id);

      // 5) Recalcula saldo_atual dos estoques de origem
      await syncEstoqueSaldos(affectedEstoqueIds);

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

  const totalVolume = filtered.reduce((sum, t) => sum + (t.volume_total || 0), 0);
  const totalMassa = filtered.reduce((sum, t) => sum + (t.massa_total || 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Transbordos</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {transbordos.length} registro(s) cadastrado(s)
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
                filtered.map((t, i) => {
                  const produtoLabel = `${t.produto_codigo ? `${t.produto_codigo} - ` : ""}${t.produto_nome || "-"}`;
                  const { volume: volumeCell, quantidade: quantidadeCell } =
                    renderTransbordoVolumeQuantidade(t);
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
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <button onClick={() => handleView(t)} className="text-muted-foreground hover:text-muted-foreground transition-colors" title="Visualizar">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleEdit(t)} className="text-muted-foreground hover:text-muted-foreground transition-colors" title="Editar">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteId(t.id)} className="text-red-400 hover:text-red-600 transition-colors" title="Excluir">
                          <Trash2 className="w-4 h-4" />
                        </button>
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

      {/* Cadeia com múltiplos OPs — não permite editar via entrada */}
      <AlertDialog
        open={!!chainBlockMessage}
        onOpenChange={(v) => !v && setChainBlockMessage("")}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edição de transbordo bloqueada</AlertDialogTitle>
            <AlertDialogDescription>{chainBlockMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setChainBlockMessage("")}>
              Entendi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
