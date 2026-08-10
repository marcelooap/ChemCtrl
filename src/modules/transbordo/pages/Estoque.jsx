import { useState, useEffect } from "react";
import { entities } from '@transbordo/services/entities';
import { Plus, Search, Eye, Pencil, Trash2 } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
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
import EntradaModal from "@transbordo/components/entrada/EntradaModal";
import EstoqueEditModal from "@transbordo/components/estoque/EstoqueEditModal";
import EstoqueViewDialog from "@transbordo/components/estoque/EstoqueViewDialog";
import { buildEntradaCodigoById } from "@transbordo/lib/entradaCodigo";
import { loteToKg, loteUnidadeEstoque } from "@transbordo/lib/conversao";
import { formatMass, formatCurrency } from "@transbordo/lib/format";
import { computeEstoqueSaldo, getEstoqueQuantidade, getEstoqueUnidade, hydrateEstoqueFiscal } from "@transbordo/lib/estoqueSaldo";
import { migrateEstoqueEmbaladoParaVasilhames, isEstoqueEmbalagemUnitaria, normalizeBarrilEmbalagensUnitarias } from "@transbordo/lib/transbordoEmbalado";

const STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "ok", label: "OK" },
  { value: "nok", label: "NOK" },
];

const nullIfEmpty = (v) => (v === "" || v === undefined ? null : v);

export default function Estoque() {
  const [estoque, setEstoque] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [entradas, setEntradas] = useState([]);
  const [transbordos, setTransbordos] = useState([]);
  const [saidas, setSaidas] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [clienteFilter, setClienteFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewItem, setViewItem] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      try {
        const mig = await migrateEstoqueEmbaladoParaVasilhames();
        if (mig.deletedEstoque > 0) {
          console.info(
            `[ChemFlow] Migrados ${mig.migrated} embalagem(ns) unitária(s) do Estoque → Vasilhames; removidos ${mig.deletedEstoque} do estoque.`
          );
        }
        await normalizeBarrilEmbalagensUnitarias();
      } catch (migErr) {
        console.warn("[ChemFlow] Migração embalado (estoque→vasilhame):", migErr);
      }

      const [ests, prods, cliens, trans, saics, ents, vascs] = await Promise.all([
        entities.estoque.list(),
        entities.produtos.list(),
        entities.clientes.list(),
        entities.transbordos.list(),
        entities.saidas.list(),
        entities.entradas.list(),
        entities.vasilhames.list(),
      ]);

      // Saldo = quantidade − saídas fiscais (embalado + convencional via origem)
      // Bombonas/tambores/IBC de OP ficam só em Vasilhames
      const estoqueWithSaldo = ests
        .filter((e) => !isEstoqueEmbalagemUnitaria(e))
        .map((e) => {
        const hydrated = hydrateEstoqueFiscal(e);
        const quantidade = getEstoqueQuantidade(hydrated);
        const unidade_medida = getEstoqueUnidade(hydrated);
        return {
          ...hydrated,
          quantidade,
          unidade_medida,
          saldo_atual: computeEstoqueSaldo(
            { ...hydrated, quantidade },
            trans,
            saics,
            vascs
          ),
        };
      });

      const toUpdate = estoqueWithSaldo
        .filter((e) => {
          const original = ests.find((o) => o.id === e.id);
          const saldoChanged =
            Math.abs((original?.saldo_atual || 0) - e.saldo_atual) > 0.001;
          const qtdChanged =
            Math.abs((original?.quantidade || 0) - e.quantidade) > 0.001;
          const unidChanged = original?.unidade_medida !== e.unidade_medida;
          return saldoChanged || qtdChanged || unidChanged;
        })
        .map((e) => ({
          id: e.id,
          saldo_atual: e.saldo_atual,
          quantidade: e.quantidade,
          unidade_medida: e.unidade_medida,
        }));
      if (toUpdate.length > 0) {
        try {
          await entities.estoque.bulkUpdate(toUpdate);
        } catch {
          // Sync de saldo não deve derrubar a listagem
        }
      }

      setEstoque(estoqueWithSaldo);
      setProdutos(prods);
      setClientes(cliens);
      setTransbordos(trans);
      setSaidas(saics);
      setEntradas(ents);
      setVasilhames(vascs);
    } catch {
      if (!silent) setEstoque([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  /** Mesmo ID da tela de Entradas (E001…), para rastrear a origem. */
  const entradaIdMap = buildEntradaCodigoById(entradas);

  const getEstoqueDisplayId = (e) => {
    if (e?.entrada_id && entradaIdMap[e.entrada_id]) {
      return entradaIdMap[e.entrada_id];
    }
    return e?.entrada_codigo || "-";
  };

  const filtered = estoque.filter((e) => {
    const q = search.toLowerCase().trim();
    const displayId = getEstoqueDisplayId(e).toLowerCase();
    const matchSearch =
      !q ||
      displayId.includes(q) ||
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
  });

  const totalSaldo = filtered.reduce((sum, e) => sum + (e.saldo_atual || 0), 0);
  const totalCusto = filtered.reduce(
    (sum, e) => sum + (e.saldo_atual || 0) * (e.preco_unitario || 0),
    0
  );

  const handleNew = () => {
    setModalOpen(true);
  };

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
      quantidade,
      unidade_medida: data.unidade_medida,
      lotes,
    };
    const saldo_atual = computeEstoqueSaldo(
      provisional,
      transbordos,
      saidas,
      vasilhames
    );

    const payload = {
      nota_fiscal: data.nota_fiscal,
      nota_fiscal_troca: nullIfEmpty(data.nota_fiscal_troca),
      lote: data.lote,
      quantidade,
      unidade_medida: data.unidade_medida,
      data_fabricacao: nullIfEmpty(data.data_fabricacao),
      data_validade: nullIfEmpty(data.data_validade),
      preco_unitario: preco,
      custo_total: saldo_atual * preco,
      saldo_atual,
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
          ? hydrateEstoqueFiscal({ ...e, ...payload, quantidade, saldo_atual })
          : e
      )
    );

    await loadData({ silent: true });
  };

  const handleSave = async (data) => {
    const sanitizeLotes = (lotes) =>
      (lotes || []).map((l) => ({
        ...l,
        produto_id: nullIfEmpty(l.produto_id),
        data_fabricacao: nullIfEmpty(l.data_fabricacao),
        data_validade: nullIfEmpty(l.data_validade),
      }));

    const buildPayloadFromLote = (lote, { saldoAtual } = {}) => {
      const loteQtd = loteToKg(lote);
      const preco = Number(lote.preco_unitario ?? data.preco_unitario) || 0;
      const saldo = saldoAtual != null ? saldoAtual : loteQtd;
      return {
        cliente_id: nullIfEmpty(data.cliente_id),
        cliente_nome: data.cliente_nome || "",
        produto_id: nullIfEmpty(lote.produto_id || data.produto_id),
        produto_nome: lote.produto_nome || data.produto_nome,
        produto_codigo: lote.produto_codigo || data.produto_codigo,
        nota_fiscal: lote.nota_fiscal,
        lote: lote.lote,
        densidade: lote.densidade ?? null,
        data_fabricacao: nullIfEmpty(lote.data_fabricacao),
        data_validade: nullIfEmpty(lote.data_validade),
        quantidade: loteQtd,
        unidade_medida: loteUnidadeEstoque(lote),
        saldo_atual: saldo,
        preco_unitario: preco,
        custo_total: saldo * preco,
        embalado: lote.embalado || false,
        peso_liquido: lote.embalado ? lote.peso_liquido ?? null : null,
        quantidade_embalagens: lote.embalado
          ? lote.quantidade_embalagens ?? null
          : null,
        status_wms: data.status_wms || false,
        origem: data.origem || null,
        grupo_entrada: data.grupo_entrada || null,
        granel_pesagem: data.granel_pesagem || false,
        granel_ticket: data.granel_ticket || null,
        granel_peso_bruto: data.granel_peso_bruto ?? null,
        granel_validacao_bruto: data.granel_validacao_bruto ?? null,
        granel_peso_liquido: data.granel_peso_liquido ?? null,
        granel_validacao_liquido: data.granel_validacao_liquido ?? null,
        granel_erro_admissivel: data.granel_erro_admissivel ?? null,
        granel_peso_minimo: data.granel_peso_minimo ?? null,
        granel_peso_maximo: data.granel_peso_maximo ?? null,
        granel_margem: data.granel_margem || null,
        lotes: sanitizeLotes([lote]),
      };
    };

    let saved;
    const lotes = data.lotes?.length ? data.lotes : [data];

    if (lotes.length > 1) {
      const grupoId = data.grupo_entrada || `GRP-${Date.now()}`;
      const records = lotes.map((lote) => ({
        ...buildPayloadFromLote(lote),
        grupo_entrada: grupoId,
      }));
      saved = await entities.estoque.bulkCreate(records);
    } else {
      saved = [await entities.estoque.create(buildPayloadFromLote(lotes[0]))];
    }

    await loadData();
    setModalOpen(false);
    return saved;
  };

  const handleDelete = async () => {
    try {
      await entities.estoque.delete(deleteId);
      await loadData();
    } catch {
      // ignore
    }
    setDeleteId(null);
  };

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
    <div className="space-y-6">
      {/* Header + Action Bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Estoque</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {estoque.length} registro(s) em estoque
          </p>
        </div>
        <Button onClick={handleNew} className="bg-primary hover:bg-primary/90 gap-2">
          <Plus className="w-4 h-4" />
          Novo Registro
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por ID, código, produto, cliente ou lote..."
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

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col h-[calc(100vh-260px)]">
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-5 py-3 font-medium">ID</th>
                <th className="px-5 py-3 font-medium">Código</th>
                <th className="px-5 py-3 font-medium">Tipo</th>
                <th className="px-5 py-3 font-medium">Produto</th>
                <th className="px-5 py-3 font-medium">Cliente</th>
                <th className="px-5 py-3 font-medium">Lote</th>
                <th className="px-5 py-3 font-medium">Saldo Atual</th>
                <th className="px-5 py-3 font-medium">Unidade</th>
                <th className="px-5 py-3 font-medium">Status WMS</th>
                <th className="px-5 py-3 font-medium">Preço Unit.</th>
                <th className="px-5 py-3 font-medium">Custo Total</th>
                <th className="px-5 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando estoque...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum registro de estoque encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((e, i) => {
                  const saldoZerado = Number(e.saldo_atual) === 0;
                  return (
                  <tr
                    key={e.id}
                    className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                      i % 2 === 1 ? "bg-muted/40/30" : ""
                    } ${saldoZerado ? "opacity-50" : ""}`}
                  >
                    <td className="px-5 py-3 font-medium text-primary">
                      {getEstoqueDisplayId(e)}
                    </td>
                    <td className="px-5 py-3 font-medium text-foreground">
                      {e.produto_codigo || "-"}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                          e.embalado
                            ? "bg-orange-200 text-orange-800"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {e.embalado ? "Embalado" : "Convencional"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-foreground">{e.produto_nome || "-"}</td>
                    <td className="px-5 py-3 text-muted-foreground">{e.cliente_nome || "-"}</td>
                    <td className="px-5 py-3 text-muted-foreground">{e.lote || "-"}</td>
                    <td className="px-5 py-3 text-foreground">
                      {formatMass(e.saldo_atual, { empty: "-" })}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {e.unidade_medida || "-"}
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
                    <td className="px-5 py-3 text-muted-foreground">
                      {formatCurrency(e.preco_unitario)}
                    </td>
                    <td className="px-5 py-3 font-medium text-green-600">
                      {formatCurrency((e.saldo_atual || 0) * (e.preco_unitario || 0))}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleView(e)}
                          className="text-muted-foreground hover:text-muted-foreground transition-colors"
                          title="Visualizar"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEdit(e)}
                          className="text-muted-foreground hover:text-muted-foreground transition-colors"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(e.id)}
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
        <div className="flex items-center justify-between gap-6 px-5 py-3 border-t border-border text-sm flex-wrap shrink-0">
          <span className="text-muted-foreground">
            Itens exibidos:{" "}
            <span className="font-medium text-foreground">{filtered.length}</span>
          </span>
          <span className="text-muted-foreground">
            Qtd. total em estoque:{" "}
            <span className="font-medium text-foreground">
              {formatMass(totalSaldo)}
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

      {/* Novo registro (fluxo completo de entrada) */}
      <EntradaModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        editingEntrada={null}
        readOnly={false}
        clientes={clientes}
        produtos={produtos}
      />

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
        displayId={getEstoqueDisplayId(viewItem)}
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