import { useState, useEffect } from "react";
import { entities } from '@transbordo/services/entities';
import { Plus, Search, Pencil, Trash2 } from "lucide-react";
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
import VasilhameCadastroModal from "@transbordo/components/cadastro/VasilhameCadastroModal";
import { formatVolume, formatMass } from "@transbordo/lib/format";
import { TIPOS_NAO_VASILHAME } from "@transbordo/lib/tiposEmbalagem";

function isTipoVasilhame(v) {
  const tipo = v?.tipo || "Vasilhame";
  return !TIPOS_NAO_VASILHAME.has(tipo);
}

function resolveCapacidade(v, allByPlaca = []) {
  if (v?.capacidade != null && Number(v.capacidade) > 0) {
    return Number(v.capacidade);
  }
  // Legado / fallback: maior volume positivo da mesma placa (capacidade cadastrada)
  const candidates = [v, ...allByPlaca]
    .map((item) => {
      if (item?.capacidade != null && Number(item.capacidade) > 0) {
        return Number(item.capacidade);
      }
      return Number(item?.volume) || 0;
    })
    .filter((n) => n > 0);
  return candidates.length ? Math.max(...candidates) : null;
}

export default function VasilhamesTab() {
  const [vasilhames, setVasilhames] = useState([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVasilhame, setEditingVasilhame] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const all = await entities.vasilhames.list("-created_date");
      // Fracionados ficam só na tela operacional de Vasilhames (pátio), não no cadastro
      setVasilhames(
        all.filter(isTipoVasilhame).filter((v) => !v.fracionado)
      );
    } catch {
      if (!silent) setVasilhames([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Group by placa — first occurrence is the latest (-created_date)
  const uniqueVasilhames = (() => {
    const map = new Map();
    const byPlaca = new Map();

    for (const v of vasilhames) {
      const key = String(v.placa || "").trim().toUpperCase();
      if (!key) continue;
      if (!byPlaca.has(key)) byPlaca.set(key, []);
      byPlaca.get(key).push(v);
      if (!map.has(key)) {
        map.set(key, v);
      }
    }

    return Array.from(map.entries()).map(([key, v]) => {
      const capacidade = resolveCapacidade(v, byPlaca.get(key) || []);
      return {
        ...v,
        capacidade,
        // Garante que o modal edite a capacidade correta mesmo se volume estiver 0 (Expedido)
        _capacidadeDisplay: capacidade,
      };
    });
  })();

  const filtered = uniqueVasilhames.filter((v) => {
    const q = search.toLowerCase();
    return (
      !q ||
      v.placa?.toLowerCase().includes(q) ||
      v.barril?.toLowerCase().includes(q)
    );
  });

  const handleNew = () => {
    setEditingVasilhame(null);
    setModalOpen(true);
  };

  const handleEdit = (v) => {
    setEditingVasilhame({
      ...v,
      capacidade: v._capacidadeDisplay ?? v.capacidade,
    });
    setModalOpen(true);
  };

  const handleSave = async (data) => {
    try {
      if (editingVasilhame) {
        // Atualiza cadastro sem zerar volume operacional (capacidade ≠ volume)
        await entities.vasilhames.update(editingVasilhame.id, data);
        setVasilhames((prev) =>
          prev.map((v) =>
            v.id === editingVasilhame.id ? { ...v, ...data } : v
          )
        );
      } else {
        await entities.vasilhames.create({
          ...data,
          volume: 0,
          origem: "manual",
          tipo: "Vasilhame",
        });
        await loadData({ silent: true });
      }
      setModalOpen(false);
      setEditingVasilhame(null);
    } catch {
      setModalOpen(false);
      setEditingVasilhame(null);
    }
  };

  const handleDelete = async () => {
    const idToDelete = deleteId;
    setDeleteId(null);
    try {
      await entities.vasilhames.delete(idToDelete);
      setVasilhames((prev) => prev.filter((v) => v.id !== idToDelete));
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-3">
      {/* Search + Button */}
      <div className="shrink-0 flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nº placa ou barril..."
            className="pl-10 bg-white h-9"
          />
        </div>
        <Button onClick={handleNew} className="gap-2 h-9">
          <Plus className="w-4 h-4" />
          Cadastrar Vasilhame
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-foreground/70 border-b-2 border-border bg-muted uppercase tracking-wide sticky top-0 z-10">
                <th className="px-5 py-3.5 font-semibold">Nº Placa</th>
                <th className="px-5 py-3.5 font-semibold">Nº Barril</th>
                <th className="px-5 py-3.5 font-semibold">Capacidade (L)</th>
                <th className="px-5 py-3.5 font-semibold">Tara (kg)</th>
                <th className="px-5 py-3.5 font-semibold">Status</th>
                <th className="px-5 py-3.5 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando vasilhames...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum vasilhame cadastrado.
                  </td>
                </tr>
              ) : (
                filtered.map((v, i) => {
                  const status = v.status || (v.data_saida ? "Expedido" : "No Pátio");
                  return (
                    <tr
                      key={v.id}
                      className={`border-b border-border last:border-0 hover:bg-primary/5 transition-colors ${
                        i % 2 === 1 ? "bg-muted/40" : "bg-background"
                      }`}
                    >
                      <td className="px-5 py-3.5 font-semibold text-primary">{v.placa || "-"}</td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-800">
                          {v.barril || "-"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-foreground font-medium tabular-nums">
                        {formatVolume(v._capacidadeDisplay ?? v.capacidade, { empty: "-" })}
                      </td>
                      <td className="px-5 py-3.5 text-foreground font-medium tabular-nums">{formatMass(v.tara, { empty: "-" })}</td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                            status === "No Pátio"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-green-100 text-green-800"
                          }`}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleEdit(v)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title="Editar"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteId(v.id)}
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

        {/* Footer Summary */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border text-sm shrink-0">
          <span className="text-muted-foreground">
            Vasilhames cadastrados:{" "}
            <span className="font-medium text-foreground">{uniqueVasilhames.length}</span>
          </span>
          <span className="text-muted-foreground">
            Exibindo:{" "}
            <span className="font-medium text-foreground">{filtered.length}</span>
          </span>
        </div>
      </div>

      {/* Modal */}
      <VasilhameCadastroModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingVasilhame(null);
        }}
        onSave={handleSave}
        editingVasilhame={editingVasilhame}
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
              Tem certeza que deseja excluir este vasilhame? Esta ação não pode ser
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
