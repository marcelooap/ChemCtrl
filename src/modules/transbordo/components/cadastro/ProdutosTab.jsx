import { useState, useEffect, useMemo } from "react";
import { entities } from '@transbordo/services/entities';
import { Plus, Search, Pencil, Trash2, Check, FileText } from "lucide-react";
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
import ProdutoModal from "@transbordo/components/cadastro/ProdutoModal";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import OrgaoRegulamentadorBadge from "@transbordo/components/cadastro/OrgaoRegulamentadorBadge";
import { cascadeProdutoIdentity } from "@transbordo/lib/cascadeProdutoUpdate";
import { emptyToNull, ensureClienteByNome } from "@transbordo/lib/ensureCliente";
import { formatDensidade } from "@transbordo/lib/format";
import { generatePublicToken } from "@industrializacao/lib/publicToken";
import { deleteProdutoDocument } from "@transbordo/api/storage";
import { registrarUsoProduto } from "@transbordo/lib/cadastroProdutosCentral";
import { useInternalAuth } from "@/lib/InternalAuthContext";
import { useSubmitGuard } from "@/shared/hooks/useSubmitGuard";

const ALL_CLIENTS_LABEL = "Todos os clientes";

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function matchesFiltradoTerm(filtrado, query) {
  const q = normalizeText(query);
  if (q === "sim" || q === "filtrado") return Boolean(filtrado);
  if (q === "nao" || q === "nao filtrado") return !filtrado;
  return false;
}

function produtoMatchesSearch(produto, query, displayId) {
  const q = normalizeText(query);
  if (!q) return true;

  const hasDensidade =
    produto?.densidade != null &&
    produto.densidade !== "" &&
    produto.densidade !== "-";
  const densidadeFmt = hasDensidade ? formatDensidade(produto.densidade) : "";
  const fields = [
    displayId,
    produto?.codigo,
    produto?.produto,
    produto?.cliente_nome,
    densidadeFmt,
    densidadeFmt.replace(/,/g, "."),
    hasDensidade ? produto.densidade : "",
  ];

  if (fields.some((field) => normalizeText(field).includes(q))) return true;
  return matchesFiltradoTerm(produto?.filtrado, q);
}

function produtoMatchesCliente(produto, filter, filterId) {
  const q = normalizeText(filter);
  if (!q || q === normalizeText(ALL_CLIENTS_LABEL)) return true;
  const nome = normalizeText(produto?.cliente_nome);
  if (filterId) {
    if (produto?.cliente_id && String(produto.cliente_id) === String(filterId)) return true;
    return nome === q;
  }
  return nome.includes(q);
}

function buildProdutoEstoqueKey(produtoId, codigo, clienteId, clienteNome) {
  if (produtoId) return `id:${String(produtoId)}`;
  const cod = String(codigo || "")
    .trim()
    .toUpperCase();
  if (!cod) return "";
  const cli = String(clienteId || clienteNome || "")
    .trim()
    .toUpperCase();
  return `cod:${cod}||${cli}`;
}

export default function ProdutosTab() {
  const { user } = useInternalAuth();
  const [produtos, setProdutos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [estoque, setEstoque] = useState([]);
  const [estoqueComSaldoKeys, setEstoqueComSaldoKeys] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [clienteFilter, setClienteFilter] = useState("");
  const [clienteFilterId, setClienteFilterId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduto, setEditingProduto] = useState(null);
  const [readOnly, setReadOnly] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState("");
  const { busy: submitBusy, run: runSubmit } = useSubmitGuard();

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [prods, cliens, ests] = await Promise.all([
        entities.produtos.list(),
        entities.clientes.list("nome"),
        entities.estoque.list().catch(() => []),
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

      const saldoKeys = new Set();
      for (const e of ests || []) {
        if ((Number(e.saldo_atual) || 0) <= 0) continue;
        if (e.produto_id) {
          saldoKeys.add(buildProdutoEstoqueKey(e.produto_id));
        }
        const byCodigo = buildProdutoEstoqueKey(
          null,
          e.produto_codigo,
          e.cliente_id,
          e.cliente_nome
        );
        if (byCodigo) saldoKeys.add(byCodigo);
      }

      setProdutos(prods);
      setClientes(clientesAtualizados);
      setEstoque(ests || []);
      setEstoqueComSaldoKeys(saldoKeys);
    } catch (err) {
      console.error("[Transbordo] Erro ao carregar produtos/clientes:", err);
      if (!silent) {
        setProdutos([]);
        setClientes([]);
        setEstoque([]);
        setEstoqueComSaldoKeys(new Set());
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const produtoTemSaldo = useMemo(() => {
    return (p) => {
      if (!p) return false;
      if (p.id && estoqueComSaldoKeys.has(buildProdutoEstoqueKey(p.id))) {
        return true;
      }
      const byCodigo = buildProdutoEstoqueKey(
        null,
        p.codigo,
        p.cliente_id,
        p.cliente_nome
      );
      return Boolean(byCodigo && estoqueComSaldoKeys.has(byCodigo));
    };
  }, [estoqueComSaldoKeys]);

  const idMap = useMemo(() => {
    const sortedAll = [...produtos].sort((a, b) => {
      const da = new Date(a.created_date || a.data_cadastro);
      const db = new Date(b.created_date || b.data_cadastro);
      return da - db;
    });
    const map = {};
    sortedAll.forEach((p, i) => {
      map[p.id] = String(i + 1).padStart(2, "0");
    });
    return map;
  }, [produtos]);

  const mergedClientes = useMemo(() => {
    const byName = new Map();
    const push = (cliente) => {
      const nome = String(cliente?.nome || "").trim();
      if (!nome) return;
      const key = normalizeText(nome);
      if (byName.has(key)) return;
      byName.set(key, { id: cliente.id || nome, nome });
    };
    for (const cliente of clientes) push(cliente);
    for (const nome of produtos.map((p) => p.cliente_nome)) push({ nome });
    return [...byName.values()].sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
    );
  }, [clientes, produtos]);

  const clienteFilterOptions = useMemo(() => {
    const byName = new Map();
    for (const cliente of clientes) {
      const nome = String(cliente?.nome || "").trim();
      if (!nome) continue;
      const key = normalizeText(nome);
      if (!byName.has(key)) byName.set(key, { id: cliente.id || nome, nome });
    }
    const sorted = [...byName.values()].sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
    );
    return [{ id: "all", nome: ALL_CLIENTS_LABEL }, ...sorted];
  }, [clientes]);

  const filtered = useMemo(
    () =>
      produtos
        .filter(
          (p) =>
            produtoMatchesCliente(p, clienteFilter, clienteFilterId) &&
            produtoMatchesSearch(p, search, idMap[p.id])
        )
        .sort((a, b) => Number(idMap[b.id] || 0) - Number(idMap[a.id] || 0)),
    [produtos, clienteFilter, clienteFilterId, search, idMap]
  );

  const handleClienteFilterChange = (label, option) => {
    const next = label || "";
    setClienteFilter(next);
    if (!next || normalizeText(next) === normalizeText(ALL_CLIENTS_LABEL)) {
      setClienteFilterId(null);
      return;
    }
    setClienteFilterId(option?.id && option.id !== "all" ? option.id : null);
  };

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

  const handleSave = async (data) => {
    setSaveError("");
    try {
      const cliente = await ensureClienteByNome(data.cliente_nome);
      const payload = {
        ...data,
        cliente_id: emptyToNull(cliente.id || data.cliente_id),
        cliente_nome: emptyToNull(cliente.nome || data.cliente_nome),
        orgao_regulamentador: data.controlado
          ? emptyToNull(data.orgao_regulamentador)
          : null,
        controlado: Boolean(data.controlado),
      };

      if (editingProduto) {
        await entities.produtos.update(editingProduto.id, payload);
        await cascadeProdutoIdentity({
          produtoId: editingProduto.id,
          before: {
            codigo: editingProduto.codigo,
            produto: editingProduto.produto,
          },
          after: {
            codigo: payload.codigo,
            produto: payload.produto,
          },
        });
      } else {
        // Reutiliza registro existente (ex.: origem INDUSTRIALIZACAO -> AMBOS)
        // ou cria com origem ARMAZENAGEM. Não cria receita.
        let existingId = null;
        try {
          existingId = await registrarUsoProduto({
            codigo: payload.codigo,
            nome: payload.produto,
            modulo: "ARMAZENAGEM",
            attrs: {
              cliente_nome: payload.cliente_nome || "",
              densidade: payload.densidade || "-",
              densidade_tabelada: Boolean(payload.densidade_tabelada),
              filtrado: Boolean(payload.filtrado),
              controlado: Boolean(payload.controlado),
              orgao_regulamentador: payload.orgao_regulamentador || "",
            },
          });
        } catch (err) {
          if (err?.code !== "CADASTRO_PRODUTOS_RPC_MISSING") throw err;
          // Pré-046: create legado
          try {
            await entities.produtos.create({
              ...payload,
              public_token: generatePublicToken(),
            });
          } catch (createErr) {
            const msg = String(createErr?.message || "");
            if (/public_token/i.test(msg)) {
              await entities.produtos.create(payload);
            } else {
              throw createErr;
            }
          }
          existingId = null;
        }

        if (existingId) {
          const updatePayload = {
            ...payload,
          };
          try {
            const current = await entities.produtos.get(existingId);
            if (!current?.public_token) {
              updatePayload.public_token = generatePublicToken();
            }
          } catch {
            updatePayload.public_token = generatePublicToken();
          }
          try {
            await entities.produtos.update(existingId, updatePayload);
          } catch (err) {
            const msg = String(err?.message || "");
            if (/public_token/i.test(msg)) {
              const { public_token: _pt, ...rest } = updatePayload;
              await entities.produtos.update(existingId, rest);
            } else {
              throw err;
            }
          }
        }
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

  const handleFdsMetadataChange = (metadata) => {
    if (!editingProduto?.id) return;
    setEditingProduto((prev) => (prev ? { ...prev, ...metadata } : prev));
    setProdutos((prev) =>
      prev.map((p) =>
        p.id === editingProduto.id ? { ...p, ...metadata } : p
      )
    );
  };

  const handleDelete = () => runSubmit(async () => {
    const idToDelete = deleteId;
    const target = produtos.find((p) => p.id === idToDelete);
    setDeleteId(null);
    try {
      if (target?.fds_url) {
        await deleteProdutoDocument(idToDelete).catch(() => {});
      }
      await entities.produtos.delete(idToDelete);
      setProdutos((prev) => prev.filter((p) => p.id !== idToDelete));
    } catch (err) {
      console.error("[Transbordo] Erro ao excluir produto:", err);
    }
  });

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString("pt-BR");
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-3">
      <div className="relative z-20 shrink-0 flex flex-col items-start gap-2">
        <div className="flex w-full flex-wrap items-center gap-3">
          <div className="relative w-full shrink-0 sm:w-[28rem]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por ID, código, produto, cliente, densidade ou filtrado..."
              className="pl-10 bg-white h-9"
              aria-label="Buscar produtos"
            />
          </div>
          <div className="w-full shrink-0 sm:w-64">
            <SearchableSelect
              value={clienteFilter}
              onChange={handleClienteFilterChange}
              options={clienteFilterOptions}
              getOptionLabel={(c) => c.nome}
              getOptionValue={(c) => c.id}
              placeholder="Todos os clientes"
              ariaLabel="Filtrar por cliente"
              inputClassName="h-9 py-0 bg-white"
            />
          </div>
        </div>
        <Button onClick={handleNew} className="gap-2 h-9 shrink-0">
          <Plus className="w-4 h-4" />
          Novo Produto
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0">
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
                <th className="px-5 py-3.5 font-semibold">Órgão Regulamentador</th>
                <th className="px-5 py-3.5 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando produtos...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted-foreground">
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
                    <td className="px-5 py-3.5 font-medium text-foreground">
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        {produtoTemSaldo(p) ? (
                          <Check
                            className="w-3.5 h-3.5 text-green-600 shrink-0"
                            strokeWidth={3}
                            aria-label="Com saldo em estoque"
                            title="Com saldo em estoque"
                          />
                        ) : null}
                        <span className="truncate">{p.produto}</span>
                        {p.fds_url ? (
                          <FileText
                            className="w-3.5 h-3.5 shrink-0 text-muted-foreground"
                            title="FDS anexada"
                            aria-label="FDS anexada"
                          />
                        ) : null}
                      </span>
                    </td>
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
                      <OrgaoRegulamentadorBadge
                        controlado={p.controlado}
                        orgao={p.orgao_regulamentador}
                      />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1">
                        <RowActionButton onClick={() => handleEdit(p)} title="Editar">
                          <Pencil />
                        </RowActionButton>
                        <RowActionButton tone="danger" onClick={() => setDeleteId(p.id)} title="Excluir">
                          <Trash2 />
                        </RowActionButton>
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
        produtos={produtos}
        estoque={estoque}
        externalError={saveError}
        uploadedBy={user?.nome || user?.full_name || user?.id || ""}
        onFdsMetadataChange={handleFdsMetadataChange}
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
