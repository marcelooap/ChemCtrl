import { useState, useEffect, useMemo } from "react";
import { entities } from "@transbordo/services/entities";
import { Search, Eye, Pencil, Trash2 } from "lucide-react";
import { Input } from "@shared/components/ui/input";
import { RowActionButton } from "@shared/components/ui/RowActionButton";
import { cn } from "@shared/lib/utils";
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
import FiltracaoEditModal from "@transbordo/components/filtracao/FiltracaoEditModal";
import FiltracaoViewDialog from "@transbordo/components/filtracao/FiltracaoViewDialog";
import { formatVolume } from "@transbordo/lib/format";
import {
  getDominantLote,
  LOTE_APORTE_ANTERIOR,
} from "@transbordo/lib/vasilhameComposicao";
import {
  PARTICULA_TAMANHOS,
  formatParticulaCount,
  alignFiltracoesComVasilhames,
  filtracaoTemSae,
} from "@transbordo/lib/filtracao";
import { peekScrollAnchor, scheduleScrollRestore } from "@shared/lib/preserveScroll";
import { sameClientName } from "@industrializacao/lib/permissions";

function formatOperacaoData(value) {
  if (!value) return "—";
  const raw = String(value);
  const date = raw.includes("T")
    ? new Date(raw)
    : new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}

export default function FiltracaoTab({ readOnly = false, lockedCliente = "" }) {
  const [filtracoes, setFiltracoes] = useState([]);
  const [elementos, setElementos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [search, setSearch] = useState("");
  const [clienteFilter, setClienteFilter] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editingFiltracao, setEditingFiltracao] = useState(null);
  const [viewFiltracao, setViewFiltracao] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resultadoFilter, setResultadoFilter] = useState("pendente");

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [aligned, cliens, elems] = await Promise.all([
        alignFiltracoesComVasilhames(entities, { persist: !readOnly }),
        readOnly ? Promise.resolve([]) : entities.clientes.list(),
        entities.elementos_filtrantes.list("-created_date"),
      ]);
      setFiltracoes(aligned.rows);
      setClientes(cliens);
      setElementos(elems);
    } catch {
      if (!silent) {
        setFiltracoes([]);
        setElementos([]);
      }
    }
    if (!silent) setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const searched = useMemo(() => {
    const q = search.toLowerCase();
    const scoped = lockedCliente
      ? filtracoes.filter((f) => sameClientName(f.cliente_nome, lockedCliente))
      : filtracoes;
    return scoped.filter((f) => {
      const matchSearch =
        !q ||
        f.codigo?.toLowerCase().includes(q) ||
        f.placa?.toLowerCase().includes(q) ||
        f.barril?.toLowerCase().includes(q) ||
        f.produto_nome?.toLowerCase().includes(q) ||
        f.produto_codigo?.toLowerCase().includes(q) ||
        f.cliente_nome?.toLowerCase().includes(q) ||
        f.lote?.toLowerCase().includes(q) ||
        f.filtro_codigo?.toLowerCase().includes(q);

      const matchCliente =
        Boolean(lockedCliente) ||
        !clienteFilter ||
        clienteFilter === "Todos os clientes" ||
        f.cliente_nome === clienteFilter;

      return matchSearch && matchCliente;
    });
  }, [filtracoes, search, clienteFilter, lockedCliente]);

  const pendenteCount = searched.filter((f) => !filtracaoTemSae(f)).length;
  const analisadoCount = searched.length - pendenteCount;

  const filtered = readOnly
    ? searched
    : searched.filter((f) =>
        resultadoFilter === "analisado" ? filtracaoTemSae(f) : !filtracaoTemSae(f)
      );

  const handleView = (f) => {
    setViewFiltracao(f);
    setViewOpen(true);
  };

  const handleEdit = (f) => {
    setEditingFiltracao(f);
    setEditOpen(true);
  };

  const handleSave = async (data) => {
    if (!editingFiltracao) return;
    await entities.filtracoes.update(editingFiltracao.id, data);
    await loadData();
    setEditOpen(false);
    setEditingFiltracao(null);
  };

  const handleDelete = async () => {
    const id = deleteId;
    const snap = peekScrollAnchor();
    setDeleteId(null);
    setFiltracoes((prev) => prev.filter((f) => f.id !== id));
    try {
      await entities.filtracoes.delete(id);
      await loadData({ silent: true });
    } catch {
      await loadData({ silent: true });
    }
    scheduleScrollRestore(snap);
  };

  const clienteFilterOptions = [{ id: "all", nome: "Todos os clientes" }, ...clientes];
  const volumeTotal = filtered.reduce((sum, f) => sum + (f.volume || 0), 0);
  const colSpan = 9 + PARTICULA_TAMANHOS.length + (readOnly ? 0 : 1);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-3">
      <div className="shrink-0 flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              readOnly
                ? "Buscar por ID, placa, produto, lote..."
                : "Buscar por ID, placa, produto, lote, filtro..."
            }
            className="pl-10 bg-card h-9"
          />
        </div>
        {!lockedCliente && (
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
        )}
        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length} registro(s)
        </span>
      </div>

      {!readOnly && (
      <div
        role="group"
        aria-label="Situação do resultado SAE"
        className="shrink-0 inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/80 p-1 shadow-sm"
      >
        <button
          type="button"
          aria-pressed={resultadoFilter === "pendente"}
          onClick={() => setResultadoFilter("pendente")}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            resultadoFilter === "pendente"
              ? "bg-amber-500 text-white shadow-sm"
              : "text-muted-foreground hover:bg-background hover:text-foreground"
          )}
        >
          Pendente
          <span
            className={cn(
              "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs tabular-nums",
              resultadoFilter === "pendente"
                ? "bg-white/20 text-white"
                : "bg-amber-100 text-amber-800"
            )}
          >
            {pendenteCount}
          </span>
        </button>
        <button
          type="button"
          aria-pressed={resultadoFilter === "analisado"}
          onClick={() => setResultadoFilter("analisado")}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            resultadoFilter === "analisado"
              ? "bg-emerald-600 text-white shadow-sm"
              : "text-muted-foreground hover:bg-background hover:text-foreground"
          )}
        >
          Analisado
          <span
            className={cn(
              "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs tabular-nums",
              resultadoFilter === "analisado"
                ? "bg-white/20 text-white"
                : "bg-emerald-100 text-emerald-800"
            )}
          >
            {analisadoCount}
          </span>
        </button>
      </div>
      )}

      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Nº Placa</th>
                <th className="px-4 py-3 font-medium">Nº Barril</th>
                <th className="px-4 py-3 font-medium">Produto</th>
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Volume (L)</th>
                {!readOnly && <th className="px-4 py-3 font-medium">Filtro</th>}
                <th className="px-4 py-3 font-medium">SAE</th>
                {PARTICULA_TAMANHOS.map(({ key, short }) => (
                  <th key={key} className="px-3 py-3 font-medium whitespace-nowrap">
                    {short} mm
                  </th>
                ))}
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-8 text-center text-muted-foreground">
                    Carregando filtrações...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-8 text-center text-muted-foreground">
                    {readOnly
                      ? "Nenhuma filtração encontrada."
                      : resultadoFilter === "pendente"
                        ? "Nenhum tanque pendente de resultado SAE."
                        : "Nenhum tanque com resultado SAE registrado."}
                    {!readOnly && (
                    <span className="block text-xs mt-1">
                      Vasilhames de produtos marcados como filtrados são registrados
                      automaticamente no transbordo.
                    </span>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((f, i) => {
                  const dominant =
                    getDominantLote(f.composicao) || f.lote || "-";
                  const uniqueLotes = new Set(
                    (f.composicao || [])
                      .map((c) => (c.lote || "").trim())
                      .filter((l) => l && l !== LOTE_APORTE_ANTERIOR)
                  ).size;

                  return (
                    <tr
                      key={f.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                        i % 2 === 1 ? "bg-muted/40/30" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-primary">
                        {f.codigo || "-"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {formatOperacaoData(f.data_operacao)}
                      </td>
                      <td className="px-4 py-3 text-foreground">{f.placa || "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {f.barril || "—"}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {f.produto_nome || "-"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <span>{dominant}</span>
                          {uniqueLotes > 1 && (
                            <span
                              className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700"
                              title="Vários lotes — veja o detalhe"
                            >
                              +{uniqueLotes - 1}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-foreground font-medium whitespace-nowrap">
                        {formatVolume(f.volume, { empty: "-" })}
                      </td>
                      {!readOnly && (
                      <td className="px-4 py-3">
                        {f.filtro_codigo ? (
                          <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                            {f.filtro_codigo}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      )}
                      <td className="px-4 py-3">
                        {!filtracaoTemSae(f) ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            {formatParticulaCount(f.sae)}
                          </span>
                        )}
                      </td>
                      {PARTICULA_TAMANHOS.map(({ key }) => (
                        <td
                          key={key}
                          className="px-3 py-3 text-muted-foreground tabular-nums"
                        >
                          {formatParticulaCount(f[key])}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <RowActionButton onClick={() => handleView(f)} title="Visualizar">
                            <Eye />
                          </RowActionButton>
                          {!readOnly && (
                            <>
                              <RowActionButton
                                onClick={() => handleEdit(f)}
                                title="Editar SAE / partículas / filtro"
                              >
                                <Pencil />
                              </RowActionButton>
                              <RowActionButton tone="danger" onClick={() => setDeleteId(f.id)} title="Excluir">
                                <Trash2 />
                              </RowActionButton>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-6 px-4 py-3 border-t border-border text-sm flex-wrap shrink-0">
          <span className="text-muted-foreground">
            Total exibido:{" "}
            <span className="font-medium text-foreground">{filtered.length}</span>
          </span>
          <span className="text-muted-foreground">
            Volume total:{" "}
            <span className="font-medium text-foreground">
              {formatVolume(volumeTotal)} L
            </span>
          </span>
        </div>
      </div>

      {!readOnly && (
      <FiltracaoEditModal
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          setEditingFiltracao(null);
        }}
        onSave={handleSave}
        filtracao={editingFiltracao}
        elementos={elementos}
      />
      )}

      <FiltracaoViewDialog
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewFiltracao(null);
        }}
        filtracao={viewFiltracao}
        hideFiltro={readOnly}
      />

      {!readOnly && (
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este registro de filtração? O vasilhame
              correspondente permanece na tela de Vasilhames. Esta ação não pode ser
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
      )}
    </div>
  );
}
