import { useState, useEffect } from "react";
import { entities } from '@chemflow/services/entities';
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
import SearchableSelect from "@chemflow/components/cadastro/SearchableSelect";
import EntradaModal from "@chemflow/components/entrada/EntradaModal";
import ComunicacaoRecebimentoDialog from "@chemflow/components/entrada/ComunicacaoRecebimentoDialog";
import { buildEntradaCodigoById } from "@chemflow/lib/entradaCodigo";
import { loteToKg, loteUnidadeEstoque } from "@chemflow/lib/conversao";
import { formatMass, formatNum } from "@chemflow/lib/format";
import { syncEntradaEstoqueCascade } from "@chemflow/lib/cascadeEntradaUpdate";

const ORIGEM_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "convencional", label: "ChemFlow" },
  { value: "industrializacao", label: "ChemBlend" },
];

function getSistemaOrigem(entrada) {
  return entrada?.origem === "industrializacao" ? "ChemBlend" : "ChemFlow";
}

function getEntradaLotes(entrada) {
  if (entrada?.lotes?.length > 0) return entrada.lotes;
  return [
    {
      produto_id: entrada?.produto_id,
      produto_codigo: entrada?.produto_codigo,
      produto_nome: entrada?.produto_nome,
      nota_fiscal: entrada?.nota_fiscal,
      lote: entrada?.lote,
      quantidade: entrada?.quantidade,
      unidade_medida: entrada?.unidade_medida,
    },
  ];
}

function matchesText(value, q) {
  if (value == null || value === "") return false;
  return String(value).toLowerCase().includes(q);
}

function StackedCell({ items, className = "", mono = false }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {items.map((item, i) => (
        <div
          key={i}
          className={`leading-5 min-h-5 truncate ${mono ? "font-medium" : ""}`}
          title={item && item !== "-" ? String(item) : undefined}
        >
          {item || "-"}
        </div>
      ))}
    </div>
  );
}

export default function Entrada() {
  const [entradas, setEntradas] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [transbordos, setTransbordos] = useState([]);
  const [estoque, setEstoque] = useState([]);
  const [search, setSearch] = useState("");
  const [origemFilter, setOrigemFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntrada, setEditingEntrada] = useState(null);
  const [viewEntrada, setViewEntrada] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [ents, prods, cliens, transbs, ests] = await Promise.all([
        entities.entradas.list("-created_date"),
        entities.produtos.list(),
        entities.clientes.list(),
        entities.transbordos.list(),
        entities.estoque.list(),
      ]);
      setEntradas(ents);
      setProdutos(prods);
      setClientes(cliens);
      setTransbordos(transbs);
      setEstoque(ests);
    } catch {
      setEntradas([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const idMap = buildEntradaCodigoById(entradas);

  const estoqueByEntradaId = estoque.reduce((acc, item) => {
    if (!item?.entrada_id) return acc;
    if (!acc[item.entrada_id]) acc[item.entrada_id] = [];
    acc[item.entrada_id].push(item);
    return acc;
  }, {});

  const filtered = entradas.filter((e) => {
    const q = search.toLowerCase().trim();
    const lotes = getEntradaLotes(e);
    const estoqueItens = estoqueByEntradaId[e.id] || [];
    const matchSearch =
      !q ||
      matchesText(idMap[e.id], q) ||
      matchesText(e.produto_codigo, q) ||
      matchesText(e.produto_nome, q) ||
      matchesText(e.cliente_nome, q) ||
      matchesText(e.lote, q) ||
      matchesText(e.nota_fiscal, q) ||
      matchesText(e.nota_fiscal_troca, q) ||
      lotes.some(
        (l) =>
          matchesText(l.produto_codigo, q) ||
          matchesText(l.produto_nome, q) ||
          matchesText(l.lote, q) ||
          matchesText(l.nota_fiscal, q) ||
          matchesText(l.nota_fiscal_troca, q)
      ) ||
      estoqueItens.some(
        (item) =>
          matchesText(item.nota_fiscal, q) ||
          matchesText(item.nota_fiscal_troca, q) ||
          matchesText(item.lote, q) ||
          (item.lotes || []).some(
            (l) =>
              matchesText(l.nota_fiscal, q) ||
              matchesText(l.nota_fiscal_troca, q) ||
              matchesText(l.lote, q)
          )
      );

    const sistema = getSistemaOrigem(e);
    const matchOrigem =
      !origemFilter ||
      origemFilter === "Todas" ||
      origemFilter === sistema;

    return matchSearch && matchOrigem;
  });

  const handleNew = () => {
    setEditingEntrada(null);
    setModalOpen(true);
  };

  const handleEdit = (entrada) => {
    setEditingEntrada(entrada);
    setModalOpen(true);
  };

  const handleView = (entrada) => {
    setViewEntrada(entrada);
    setViewOpen(true);
  };

  const handleSave = async (data) => {
    const nullIfEmpty = (v) => (v === "" || v === undefined ? null : v);

    const entradaPayload = {
      ...data,
      data: data.data || (() => {
        const d = new Date();
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 10);
      })(),
      cliente_id: nullIfEmpty(data.cliente_id),
      produto_id: nullIfEmpty(data.produto_id),
      data_fabricacao: nullIfEmpty(data.data_fabricacao),
      data_validade: nullIfEmpty(data.data_validade),
      lotes: (data.lotes || []).map((l) => ({
        ...l,
        produto_id: nullIfEmpty(l.produto_id),
        data_fabricacao: nullIfEmpty(l.data_fabricacao),
        data_validade: nullIfEmpty(l.data_validade),
      })),
    };

    let savedEntrada;
    let existingEstoque = [];
    if (editingEntrada) {
      savedEntrada = await entities.entradas.update(
        editingEntrada.id,
        entradaPayload
      );
      existingEstoque = await entities.estoque.filter({
        entrada_id: editingEntrada.id,
      });
    } else {
      savedEntrada = await entities.entradas.create(entradaPayload);
    }

    const grupoId = data.grupo_entrada || `GRP-${Date.now()}`;
    const entradaCodigo =
      idMap[savedEntrada.id] ||
      `E${String(entradas.length + 1).padStart(3, "0")}`;

    const existingByIndex = [...existingEstoque].sort((a, b) => {
      const da = new Date(a.created_at || a.created_date || 0).getTime();
      const db = new Date(b.created_at || b.created_date || 0).getTime();
      return da - db;
    });

    const estoqueRecords = (entradaPayload.lotes || []).map((lote, index) => {
      const loteQtd = loteToKg(lote);
      const lotePreco = lote.preco_unitario || data.preco_unitario || 0;
      const prev = existingByIndex[index];
      const prevLoteJson =
        Array.isArray(prev?.lotes) && prev.lotes[0] ? prev.lotes[0] : null;
      const notaFiscalTroca =
        prev?.nota_fiscal_troca ??
        prevLoteJson?.nota_fiscal_troca ??
        null;

      const record = {
        entrada_id: savedEntrada.id,
        entrada_codigo: prev?.entrada_codigo || entradaCodigo,
        grupo_entrada: grupoId,
        cliente_id: nullIfEmpty(data.cliente_id),
        cliente_nome: data.cliente_nome || "",
        produto_id: nullIfEmpty(lote.produto_id || data.produto_id),
        produto_nome: lote.produto_nome || data.produto_nome,
        produto_codigo: lote.produto_codigo || data.produto_codigo,
        nota_fiscal: lote.nota_fiscal,
        lote: lote.lote,
        densidade: lote.densidade,
        data_fabricacao: nullIfEmpty(lote.data_fabricacao),
        data_validade: nullIfEmpty(lote.data_validade),
        quantidade: loteQtd,
        unidade_medida: loteUnidadeEstoque(lote),
        // saldo_atual recalculado por syncEstoqueSaldos após persistir
        saldo_atual: prev?.saldo_atual ?? loteQtd,
        preco_unitario: lotePreco,
        custo_total: loteQtd * lotePreco,
        embalado: lote.embalado || false,
        peso_liquido: lote.embalado ? lote.peso_liquido || null : null,
        quantidade_embalagens: lote.embalado
          ? lote.quantidade_embalagens || null
          : null,
        status_wms: data.status_wms || false,
        origem: data.origem || null,
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
        lotes: [
          {
            ...lote,
            ...(notaFiscalTroca != null
              ? { nota_fiscal_troca: notaFiscalTroca }
              : {}),
          },
        ],
      };

      // Preserva coluna só se já existia no registro (evita erro de schema cache)
      if (prev && Object.prototype.hasOwnProperty.call(prev, "nota_fiscal_troca")) {
        record.nota_fiscal_troca = notaFiscalTroca;
      }

      return record;
    });

    let savedEstoques = [];
    if (editingEntrada) {
      const result = await syncEntradaEstoqueCascade({
        entradaId: savedEntrada.id,
        estoqueRecords,
      });
      savedEstoques = result.savedEstoques;
    } else {
      savedEstoques =
        estoqueRecords.length > 0
          ? await entities.estoque.bulkCreate(estoqueRecords)
          : [];
    }

    await loadData();
    setModalOpen(false);
    setEditingEntrada(null);
    return {
      savedEntrada,
      savedEstoques,
      entrada_codigo: entradaCodigo,
    };
  };

  const handleDelete = async () => {
    try {
      await entities.estoque.deleteMany({ entrada_id: deleteId });
      await entities.entradas.delete(deleteId);
      await loadData();
    } catch {
      // ignore
    }
    setDeleteId(null);
  };

  const handleDialogClose = () => {
    setViewOpen(false);
  };

  const handleToggleStatus = async (entrada, checked) => {
    setEntradas((prev) =>
      prev.map((e) =>
        e.id === entrada.id ? { ...e, comunicacao_enviada: checked } : e
      )
    );
    try {
      await entities.entradas.update(entrada.id, { comunicacao_enviada: checked });
    } catch {
      setEntradas((prev) =>
        prev.map((e) =>
          e.id === entrada.id
            ? { ...e, comunicacao_enviada: !checked }
            : e
        )
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Entradas</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {entradas.length} registro(s) de recebimento
          </p>
        </div>
        <Button onClick={handleNew} className="bg-primary hover:bg-primary/90 gap-2">
          <Plus className="w-4 h-4" />
          Nova Entrada
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por produto, cliente, lote ou NF..."
            className="pl-10 bg-white"
          />
        </div>
        <div className="w-52">
          <SearchableSelect
            value={origemFilter}
            onChange={(label) => setOrigemFilter(label)}
            options={ORIGEM_OPTIONS}
            getOptionLabel={(o) => o.label}
            getOptionValue={(o) => o.value}
            placeholder="Origem"
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
                <th className="px-5 py-3 font-medium">Origem</th>
                <th className="px-5 py-3 font-medium">Cód</th>
                <th className="px-5 py-3 font-medium">Produto</th>
                <th className="px-5 py-3 font-medium">Cliente</th>
                <th className="px-5 py-3 font-medium">Lote(s)</th>
                <th className="px-5 py-3 font-medium">Qtd. Total</th>
                <th className="px-5 py-3 font-medium">Unidade</th>
                <th className="px-5 py-3 font-medium">Envio E-mail</th>
                <th className="px-5 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando recebimentos...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum recebimento encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((e, i) => {
                  const lotes = getEntradaLotes(e);
                  const sistema = getSistemaOrigem(e);
                  const isChemBlend = sistema === "ChemBlend";
                  const unidades = lotes.map((l) => l.unidade_medida || "-");
                  const unidadesDistintas = [...new Set(unidades.filter((u) => u && u !== "-"))];
                  const showUnidadesStacked = unidadesDistintas.length > 1;

                  return (
                    <tr
                      key={e.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors align-middle ${
                        i % 2 === 1 ? "bg-muted/40/30" : ""
                      }`}
                    >
                      <td className="px-5 py-3 font-medium text-primary">
                        {idMap[e.id] || "-"}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                            isChemBlend
                              ? "bg-orange-100 text-orange-800"
                              : "bg-primary/10 text-primary"
                          }`}
                        >
                          {sistema}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-foreground">
                        <StackedCell
                          mono
                          items={lotes.map((l) => l.produto_codigo || "-")}
                        />
                      </td>
                      <td className="px-5 py-3 text-foreground">
                        <StackedCell
                          items={lotes.map((l) => l.produto_nome || "-")}
                        />
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{e.cliente_nome || "-"}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        <StackedCell items={lotes.map((l) => l.lote || "-")} />
                      </td>
                      <td className="px-5 py-3 font-medium text-foreground">
                        <StackedCell
                          items={lotes.map((l) =>
                            formatNum(l.quantidade, 0, { empty: "-" })
                          )}
                        />
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {showUnidadesStacked ? (
                          <StackedCell items={unidades} />
                        ) : (
                          unidadesDistintas[0] || e.unidade_medida || "-"
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleStatus(e, !e.comunicacao_enviada)
                          }
                          title={
                            e.comunicacao_enviada
                              ? "Marcar como pendente"
                              : "Marcar como enviado"
                          }
                          className="inline-flex items-center gap-2"
                        >
                          <span
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
                              e.comunicacao_enviada
                                ? "bg-green-500"
                                : "bg-amber-400"
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                                e.comunicacao_enviada
                                  ? "translate-x-4"
                                  : "translate-x-0.5"
                              }`}
                            />
                          </span>
                          <span
                            className={`text-xs font-semibold ${
                              e.comunicacao_enviada
                                ? "text-green-700"
                                : "text-amber-700"
                            }`}
                          >
                            {e.comunicacao_enviada ? "Enviado" : "Pendente"}
                          </span>
                        </button>
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
            Quantidade total:{" "}
            <span className="font-medium text-foreground">
              {formatMass(
                filtered.reduce((sum, e) => {
                  const lotes = getEntradaLotes(e);
                  const fromLotes = lotes.reduce(
                    (s, l) => s + (parseFloat(l.quantidade) || 0),
                    0
                  );
                  return sum + (fromLotes > 0 ? fromLotes : e.quantidade || 0);
                }, 0)
              )}
            </span>
          </span>
        </div>
      </div>

      {/* Modal */}
      <EntradaModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingEntrada(null);
        }}
        onSave={handleSave}
        editingEntrada={editingEntrada}
        readOnly={false}
        clientes={clientes}
        produtos={produtos}
        transbordos={transbordos}
        estoque={estoque}
      />

      {/* View Dialog */}
      <ComunicacaoRecebimentoDialog
        open={viewOpen}
        onClose={handleDialogClose}
        entrada={viewEntrada}
        entradaId={viewEntrada ? idMap[viewEntrada.id] || "-" : "-"}
        produtos={produtos}
        transbordos={transbordos}
        estoque={estoque}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta entrada e todos os registros de estoque
              associados? Esta ação não pode ser desfeita.
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