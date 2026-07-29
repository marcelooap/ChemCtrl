import { useState, useEffect } from "react";
import { entities } from "@chemflow/services/entities";
import { Search, Eye, Pencil, Trash2 } from "lucide-react";
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
import SearchableSelect from "@chemflow/components/cadastro/SearchableSelect";
import FiltracaoEditModal from "@chemflow/components/filtracao/FiltracaoEditModal";
import FiltracaoViewDialog from "@chemflow/components/filtracao/FiltracaoViewDialog";
import { formatVolume } from "@chemflow/lib/format";
import {
  getDominantLote,
  LOTE_APORTE_ANTERIOR,
} from "@chemflow/lib/vasilhameComposicao";
import { PARTICULA_TAMANHOS, formatParticulaCount } from "@chemflow/lib/filtracao";

export default function FiltracaoTab() {
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

  const loadData = async () => {
    setLoading(true);
    try {
      const [list, cliens, elems] = await Promise.all([
        entities.filtracoes.list("-created_date"),
        entities.clientes.list(),
        entities.elementos_filtrantes.list("-created_date"),
      ]);
      setFiltracoes(list);
      setClientes(cliens);
      setElementos(elems);
    } catch {
      setFiltracoes([]);
      setElementos([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const filtered = filtracoes.filter((f) => {
    const q = search.toLowerCase();
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
      !clienteFilter ||
      clienteFilter === "Todos os clientes" ||
      f.cliente_nome === clienteFilter;

    return matchSearch && matchCliente;
  });

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
    try {
      await entities.filtracoes.delete(deleteId);
      await loadData();
    } catch {
      // ignore
    }
    setDeleteId(null);
  };

  const clienteFilterOptions = [{ id: "all", nome: "Todos os clientes" }, ...clientes];
  const volumeTotal = filtered.reduce((sum, f) => sum + (f.volume || 0), 0);
  const colSpan = 8 + PARTICULA_TAMANHOS.length + 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por ID, placa, produto, lote, filtro..."
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
        <span className="text-sm text-muted-foreground ml-auto">
          {filtracoes.length} registro(s)
        </span>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col h-[calc(100vh-300px)]">
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Nº Placa</th>
                <th className="px-4 py-3 font-medium">Nº Barril</th>
                <th className="px-4 py-3 font-medium">Produto</th>
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Volume (L)</th>
                <th className="px-4 py-3 font-medium">Filtro</th>
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
                    Nenhum registro de filtração encontrado.
                    <span className="block text-xs mt-1">
                      Vasilhames de produtos marcados como filtrados são registrados
                      automaticamente no transbordo.
                    </span>
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
                      <td className="px-4 py-3">
                        {f.filtro_codigo ? (
                          <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                            {f.filtro_codigo}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {f.sae === null || f.sae === undefined || f.sae === "" ? (
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
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleView(f)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title="Visualizar"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleEdit(f)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title="Editar SAE / partículas / filtro"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteId(f.id)}
                            className="text-red-400 hover:text-red-600 transition-colors"
                            title="Excluir"
                          >
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

      <FiltracaoViewDialog
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewFiltracao(null);
        }}
        filtracao={viewFiltracao}
      />

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
    </div>
  );
}
