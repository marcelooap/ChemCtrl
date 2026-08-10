import { useState, useEffect } from "react";
import { entities } from '@transbordo/services/entities';
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
import ProdutoModal from "@transbordo/components/cadastro/ProdutoModal";
import { emptyToNull, ensureClienteByNome } from "@transbordo/lib/ensureCliente";
import { formatDensidade } from "@transbordo/lib/format";

export default function ProdutosTab() {
  const [produtos, setProdutos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduto, setEditingProduto] = useState(null);
  const [readOnly, setReadOnly] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState("");

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [prods, cliens] = await Promise.all([
        entities.produtos.list(),
        entities.clientes.list(),
      ]);

      // Sincroniza clientes referidos em produtos mas ainda ausentes em t_clientes
      const nomesExistentes = new Set(
        cliens.map((c) => c.nome?.trim().toLowerCase()).filter(Boolean)
      );
      const nomesFaltando = [
        ...new Set(
          prods
            .map((p) => p.cliente_nome?.trim())
            .filter((n) => n && !nomesExistentes.has(n.toLowerCase()))
        ),
      ];
      let clientesAtualizados = cliens;
      if (nomesFaltando.length > 0) {
        const criados = await Promise.all(
          nomesFaltando.map((nome) => ensureClienteByNome(nome))
        );
        clientesAtualizados = [
          ...cliens,
          ...criados.filter((c) => c.id).map((c) => ({ id: c.id, nome: c.nome })),
        ];
      }

      setProdutos(prods);
      setClientes(clientesAtualizados);
    } catch (err) {
      console.error("[Transbordo] Erro ao carregar produtos/clientes:", err);
      if (!silent) {
        setProdutos([]);
        setClientes([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const sortedAll = [...produtos].sort((a, b) => {
    const da = new Date(a.created_date || a.data_cadastro);
    const db = new Date(b.created_date || b.data_cadastro);
    return da - db;
  });
  const idMap = {};
  sortedAll.forEach((p, i) => {
    idMap[p.id] = String(i + 1).padStart(2, "0");
  });

  const filtered = produtos
    .filter((p) => {
      const q = search.toLowerCase();
      return (
        p.codigo?.toLowerCase().includes(q) ||
        p.produto?.toLowerCase().includes(q) ||
        p.cliente_nome?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => Number(idMap[b.id] || 0) - Number(idMap[a.id] || 0));

  const handleNew = () => {
    setEditingProduto(null);
    setReadOnly(false);
    setSaveError("");
    setModalOpen(true);
  };

  const handleEdit = (produto) => {
    setEditingProduto(produto);
    setReadOnly(false);
    setSaveError("");
    setModalOpen(true);
  };

  const handleView = (produto) => {
    setEditingProduto(produto);
    setReadOnly(true);
    setSaveError("");
    setModalOpen(true);
  };

  const handleSave = async (data) => {
    setSaveError("");
    try {
      const cliente = await ensureClienteByNome(data.cliente_nome);
      const payload = {
        ...data,
        cliente_id: emptyToNull(cliente.id || data.cliente_id),
        cliente_nome: emptyToNull(cliente.nome || data.cliente_nome),
      };

      if (editingProduto) {
        await entities.produtos.update(editingProduto.id, payload);
      } else {
        await entities.produtos.create(payload);
      }
      await loadData({ silent: true });
      setModalOpen(false);
      setEditingProduto(null);
    } catch (err) {
      console.error("[Transbordo] Erro ao salvar produto:", err);
      setSaveError(
        err?.message?.replace(/^\[ChemFlow:[^\]]+\]\s*/, "") ||
          "Não foi possível salvar o produto. Verifique a conexão com o banco."
      );
    }
  };

  const handleDelete = async () => {
    const idToDelete = deleteId;
    setDeleteId(null);
    try {
      await entities.produtos.delete(idToDelete);
      setProdutos((prev) => prev.filter((p) => p.id !== idToDelete));
    } catch (err) {
      console.error("[Transbordo] Erro ao excluir produto:", err);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString("pt-BR");
  };

  const clientesFromProdutos = produtos
    .map((p) => p.cliente_nome)
    .filter(Boolean);
  const uniqueClienteNomes = [...new Set(clientesFromProdutos)];
  const mergedClientes = [
    ...clientes,
    ...uniqueClienteNomes
      .filter(
        (nome) =>
          !clientes.some(
            (c) => c.nome?.toLowerCase() === nome.toLowerCase()
          )
      )
      .map((nome) => ({ id: nome, nome })),
  ];

  return (
    <div className="space-y-4">
      {/* Search + Button */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por ID, produto ou cliente..."
            className="pl-10 bg-white"
          />
        </div>
        <Button onClick={handleNew} className="gap-2">
          <Plus className="w-4 h-4" />
          Novo Produto
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col h-[calc(100vh-320px)]">
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-foreground/70 border-b-2 border-border bg-muted uppercase tracking-wide sticky top-0 z-10">
                <th className="px-5 py-3.5 font-semibold">ID</th>
                <th className="px-5 py-3.5 font-semibold">Data de Cadastro</th>
                <th className="px-5 py-3.5 font-semibold">Código</th>
                <th className="px-5 py-3.5 font-semibold">Produto</th>
                <th className="px-5 py-3.5 font-semibold">Cliente</th>
                <th className="px-5 py-3.5 font-semibold">Densidade</th>
                <th className="px-5 py-3.5 font-semibold">Filtrado</th>
                <th className="px-5 py-3.5 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando produtos...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum produto encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((p, i) => (
                  <tr
                    key={p.id}
                    className={`border-b border-border last:border-0 hover:bg-primary/5 transition-colors ${
                      i % 2 === 1 ? "bg-muted/40" : "bg-background"
                    }`}
                  >
                    <td className="px-5 py-3.5">
                      <span className="font-semibold text-primary">
                        {idMap[p.id] || "-"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground tabular-nums">
                      {formatDate(p.data_cadastro)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-800">
                        {p.codigo}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-foreground">{p.produto}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {p.cliente_nome || "-"}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-orange-50 text-amber-800">
                        {!p.densidade || p.densidade === "-"
                          ? "-"
                          : formatDensidade(p.densidade)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {p.filtrado ? (
                        <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          Sim
                        </span>
                      ) : (
                        <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                          Não
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleView(p)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Visualizar"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEdit(p)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(p.id)}
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
            Produtos cadastrados:{" "}
            <span className="font-medium text-foreground">{produtos.length}</span>
          </span>
          <span className="text-muted-foreground">
            Exibindo:{" "}
            <span className="font-medium text-foreground">{filtered.length}</span>
          </span>
        </div>
      </div>

      {/* Modal */}
      <ProdutoModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingProduto(null);
          setReadOnly(false);
          setSaveError("");
        }}
        onSave={handleSave}
        editingProduto={editingProduto}
        readOnly={readOnly}
        clientes={mergedClientes}
        externalError={saveError}
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
              Tem certeza que deseja excluir este produto? Esta ação não pode ser
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