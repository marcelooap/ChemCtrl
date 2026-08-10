import { useState, useEffect } from "react";
import { entities } from '@transbordo/services/entities';
import { Plus, Search, Eye, Pencil, Trash2, Sparkles } from "lucide-react";
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
import IsotanqueModal from "@transbordo/components/cadastro/IsotanqueModal";
import IsotanqueViewDialog from "@transbordo/components/cadastro/IsotanqueViewDialog";
import DescontaminacaoModal from "@transbordo/components/cadastro/DescontaminacaoModal";
import { formatVolume } from "@transbordo/lib/format";
import { emptyToNull, ensureClienteByNome } from "@transbordo/lib/ensureCliente";

export default function IsotanquesTab() {
  const [isotanques, setIsotanques] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIsotanque, setEditingIsotanque] = useState(null);
  const [readOnly, setReadOnly] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [viewIsotanque, setViewIsotanque] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [descontamOpen, setDescontamOpen] = useState(false);
  const [descontaminacoes, setDescontaminacoes] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [isos, prods, cliens] = await Promise.all([
        entities.isotanques.list(),
        entities.produtos.list(),
        entities.clientes.list(),
      ]);
      setIsotanques(isos);
      setProdutos(prods);
      setClientes(cliens);
      try {
        const desconts = await entities.descontaminacoes.list("-data_descontaminacao");
        setDescontaminacoes(desconts);
      } catch {
        setDescontaminacoes([]);
      }
    } catch (err) {
      console.error("[Transbordo] Erro ao carregar isotanques:", err);
      if (!silent) {
        setIsotanques([]);
        setProdutos([]);
        setClientes([]);
        setDescontaminacoes([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filtered = isotanques.filter((it) => {
    const q = search.toLowerCase();
    return (
      it.codigo_itku?.toLowerCase().includes(q) ||
      it.tanka?.toLowerCase().includes(q) ||
      it.produto_nome?.toLowerCase().includes(q) ||
      it.cliente_nome?.toLowerCase().includes(q)
    );
  });

  const handleNew = () => {
    setEditingIsotanque(null);
    setReadOnly(false);
    setModalOpen(true);
  };

  const handleEdit = (iso) => {
    setEditingIsotanque(iso);
    setReadOnly(false);
    setModalOpen(true);
  };

  const handleView = (iso) => {
    setViewIsotanque(iso);
    setViewOpen(true);
  };

  const handleSave = async (data) => {
    try {
      const cliente = await ensureClienteByNome(data.cliente_nome);
      const payload = {
        ...data,
        cliente_id: emptyToNull(cliente.id || data.cliente_id),
        cliente_nome: emptyToNull(cliente.nome || data.cliente_nome),
        produto_id: emptyToNull(data.produto_id),
      };

      if (editingIsotanque) {
        await entities.isotanques.update(editingIsotanque.id, payload);
      } else {
        await entities.isotanques.create(payload);
      }
      await loadData({ silent: true });
      setModalOpen(false);
      setEditingIsotanque(null);
    } catch (err) {
      console.error("[Transbordo] Erro ao salvar isotanque:", err);
    }
  };

  const handleDelete = async () => {
    const idToDelete = deleteId;
    setDeleteId(null);
    try {
      await entities.isotanques.delete(idToDelete);
      setIsotanques((prev) => prev.filter((it) => it.id !== idToDelete));
    } catch (err) {
      console.error("[Transbordo] Erro ao excluir isotanque:", err);
    }
  };

  const handleDescontaminacao = async (data) => {
    try {
      await entities.descontaminacoes.create(data);
      await loadData({ silent: true });
      setDescontamOpen(false);
    } catch (err) {
      console.error("[Transbordo] Erro ao registrar descontaminação:", err);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    const raw = String(dateStr).slice(0, 10);
    const [y, m, d] = raw.split("-");
    if (!y || !m || !d) return dateStr;
    return `${d}/${m}/${y}`;
  };

  const calcularDiasLocados = (inicio) => {
    if (!inicio) return "-";
    const raw = String(inicio).slice(0, 10);
    const data = new Date(`${raw}T00:00:00`);
    if (isNaN(data)) return "-";
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const diff = Math.round((hoje - data) / (1000 * 60 * 60 * 24));
    return diff;
  };

  const formatCapacidade = (cap) => {
    if (cap == null || cap === "") return "-";
    return `${formatVolume(cap)} L`;
  };

  return (
    <div className="space-y-4">
      {/* Search + Buttons */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código ITKU, tanka, produto ou cliente..."
            className="pl-10 bg-white"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => setDescontamOpen(true)}
            className="gap-2 border-amber-300 text-amber-800 hover:bg-amber-50 hover:text-amber-900"
          >
            <Sparkles className="w-4 h-4" />
            Descontaminação
          </Button>
          <Button onClick={handleNew} className="gap-2">
            <Plus className="w-4 h-4" />
            Novo Isotanque
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col h-[calc(100vh-320px)]">
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-foreground/70 border-b-2 border-border bg-muted uppercase tracking-wide sticky top-0 z-10">
                <th className="px-5 py-3.5 font-semibold">Código ITKU</th>
                <th className="px-5 py-3.5 font-semibold">Tanka</th>
                <th className="px-5 py-3.5 font-semibold">Produto em Uso</th>
                <th className="px-5 py-3.5 font-semibold">Cliente</th>
                <th className="px-5 py-3.5 font-semibold">Capacidade</th>
                <th className="px-5 py-3.5 font-semibold">Início da Locação</th>
                <th className="px-5 py-3.5 font-semibold">Dias Locados</th>
                <th className="px-5 py-3.5 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando isotanques...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum isotanque encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((it, i) => (
                  <tr
                    key={it.id}
                    className={`border-b border-border last:border-0 hover:bg-primary/5 transition-colors ${
                      i % 2 === 1 ? "bg-muted/40" : "bg-background"
                    }`}
                  >
                    <td className="px-5 py-3.5 font-semibold text-primary">
                      {it.codigo_itku}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-800">
                        {it.tanka || "-"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-foreground">
                      {it.produto_nome || "-"}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {it.cliente_nome || "-"}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground tabular-nums">
                      {formatCapacidade(it.capacidade)}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground tabular-nums">
                      {formatDate(it.inicio_locacao)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                        {calcularDiasLocados(it.inicio_locacao)} dias
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleView(it)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Visualizar"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEdit(it)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(it.id)}
                          className="text-red-400 hover:text-red-600 transition-colors"
                          title="Excluir"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border text-sm shrink-0">
          <span className="text-muted-foreground">
            Isotanques cadastrados:{" "}
            <span className="font-medium text-foreground">{isotanques.length}</span>
          </span>
          <span className="text-muted-foreground">
            Exibindo:{" "}
            <span className="font-medium text-foreground">{filtered.length}</span>
          </span>
        </div>
      </div>

      {/* Modal */}
      <IsotanqueModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingIsotanque(null);
          setReadOnly(false);
        }}
        onSave={handleSave}
        editingIsotanque={editingIsotanque}
        readOnly={readOnly}
        produtos={produtos}
        clientes={clientes}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(v) => !v && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este isotanque? Esta ação não pode ser
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

      {/* View Dialog */}
      <IsotanqueViewDialog
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewIsotanque(null);
        }}
        isotanque={viewIsotanque}
        allIsotanques={isotanques}
        descontaminacoes={descontaminacoes}
      />

      {/* Descontaminação Modal */}
      <DescontaminacaoModal
        open={descontamOpen}
        onClose={() => setDescontamOpen(false)}
        onSave={handleDescontaminacao}
        isotanques={isotanques}
      />
    </div>
  );
}
