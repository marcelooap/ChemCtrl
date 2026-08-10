import { useState, useEffect } from "react";
import { entities } from "@transbordo/services/entities";
import { Plus, Trash2, CirclePlay, Pencil } from "lucide-react";
import { Button } from "@shared/components/ui/button";
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
import EntradaElementosModal from "@transbordo/components/filtracao/EntradaElementosModal";
import ElementoEditModal from "@transbordo/components/filtracao/ElementoEditModal";
import { formatVolume } from "@transbordo/lib/format";
import {
  generateProximosCodigosFiltro,
  volumeTotalPorFiltro,
  promoverFiltroEmUso,
  statusElementoBadgeClass,
} from "@transbordo/lib/filtracao";

const formatDate = (d) => {
  if (!d) return "—";
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("pt-BR");
};

export default function InsumosTab() {
  const [elementos, setElementos] = useState([]);
  const [volumeMap, setVolumeMap] = useState(new Map());
  const [modalOpen, setModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingElemento, setEditingElemento] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [elems, filtracoes] = await Promise.all([
        entities.elementos_filtrantes.list("-created_date"),
        entities.filtracoes.list(),
      ]);
      setElementos(elems);
      setVolumeMap(volumeTotalPorFiltro(filtracoes));
    } catch {
      setElementos([]);
      setVolumeMap(new Map());
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const sorted = [...elementos].sort((a, b) => {
    const aUso = a.status === "Em uso" ? 0 : 1;
    const bUso = b.status === "Em uso" ? 0 : 1;
    if (aUso !== bUso) return aUso - bUso;
    const na = parseInt(String(a.codigo || "").replace(/\D/g, ""), 10) || 0;
    const nb = parseInt(String(b.codigo || "").replace(/\D/g, ""), 10) || 0;
    return na - nb;
  });

  const handleEntrada = async ({ data_compra, tipo, marca, quantidade }) => {
    setSaving(true);
    try {
      const codigos = generateProximosCodigosFiltro(elementos, quantidade);
      if (codigos.length === 0) return;
      await entities.elementos_filtrantes.bulkCreate(
        codigos.map((codigo) => ({
          codigo,
          tipo: tipo || "Cartucho",
          marca: marca || "",
          data_compra: data_compra || null,
          status: "Almoxarifado",
        }))
      );
      await loadData();
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleColocarEmUso = async (el) => {
    if (el.status === "Em uso") return;
    try {
      await promoverFiltroEmUso(entities, el.id, elementos);
      await loadData();
    } catch {
      // ignore
    }
  };

  const handleEdit = (el) => {
    setEditingElemento(el);
    setEditOpen(true);
  };

  const handleEditSave = async (data) => {
    if (!editingElemento) return;
    setSaving(true);
    try {
      if (data.status === "Em uso" && editingElemento.status !== "Em uso") {
        await promoverFiltroEmUso(entities, editingElemento.id, elementos);
        await entities.elementos_filtrantes.update(editingElemento.id, {
          marca: data.marca,
          tipo: data.tipo,
          data_compra: data.data_compra,
        });
      } else {
        await entities.elementos_filtrantes.update(editingElemento.id, data);
      }
      await loadData();
      setEditOpen(false);
      setEditingElemento(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await entities.elementos_filtrantes.delete(deleteId);
      await loadData();
    } catch {
      // ignore
    }
    setDeleteId(null);
  };

  const emUsoCount = elementos.filter((e) => e.status === "Em uso").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {elementos.length} elemento(s) filtrante(s)
          {emUsoCount > 0 ? ` · ${emUsoCount} em uso` : ""}
        </p>
        <Button
          onClick={() => setModalOpen(true)}
          className="bg-primary hover:bg-primary/90 gap-2"
        >
          <Plus className="w-4 h-4" />
          Entrada de elementos
        </Button>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col h-[calc(100vh-300px)]">
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Marca</th>
                <th className="px-4 py-3 font-medium">Data da compra</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Volume total (L)</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Carregando insumos...
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Nenhum elemento filtrante cadastrado.
                    <span className="block text-xs mt-1">
                      Use &quot;Entrada de elementos&quot; para registrar cartuchos.
                    </span>
                  </td>
                </tr>
              ) : (
                sorted.map((el) => {
                  const emUso = el.status === "Em uso";
                  const descartado = el.status === "Descartado";
                  const vol = volumeMap.get(el.id) || 0;
                  return (
                    <tr
                      key={el.id}
                      className={`border-b border-border last:border-0 transition-colors ${
                        emUso
                          ? "bg-emerald-50/80 dark:bg-emerald-950/30 ring-1 ring-inset ring-emerald-200/80"
                          : descartado
                            ? "opacity-70 hover:bg-muted/40"
                            : "hover:bg-muted/40"
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-primary">
                        {el.codigo || "—"}
                      </td>
                      <td className="px-4 py-3 text-foreground">{el.tipo || "Cartucho"}</td>
                      <td className="px-4 py-3 text-foreground">{el.marca || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(el.data_compra)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${statusElementoBadgeClass(
                            el.status
                          )}`}
                        >
                          {el.status || "Almoxarifado"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-foreground font-medium tabular-nums">
                        {formatVolume(vol, { empty: "0" })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {!emUso && !descartado && (
                            <button
                              onClick={() => handleColocarEmUso(el)}
                              className="text-muted-foreground hover:text-green-700 transition-colors"
                              title="Colocar em uso"
                            >
                              <CirclePlay className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleEdit(el)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title="Editar"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteId(el.id)}
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
      </div>

      <EntradaElementosModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleEntrada}
        saving={saving}
        proximosPreview={generateProximosCodigosFiltro(elementos, 1)[0] || "F001"}
      />

      <ElementoEditModal
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          setEditingElemento(null);
        }}
        onSave={handleEditSave}
        elemento={editingElemento}
        saving={saving}
      />

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este elemento filtrante? Filtrações
              vinculadas perderão a referência ao filtro.
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
