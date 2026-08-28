import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { entities } from '@transbordo/services/entities';
import { useInternalAuth as useAuth } from '@/lib/InternalAuthContext';
import { Plus, Search, Eye, Pencil, Trash2, RefreshCw } from "lucide-react";
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
import SaidaViewDialog from "@transbordo/components/saida/SaidaViewDialog";
import { formatMass } from "@transbordo/lib/format";
import { applySaidaFiscalToggle } from "@transbordo/lib/saidaFiscal";
import {
  syncEstoqueSaldos,
  resolveEstoqueIdsFromSaidaConvencional,
} from "@transbordo/lib/estoqueSaldo";
import {
  saidaHasIndustrializacaoItems,
  isSaidaModuloChemflow,
  isSaidaModuloPainel,
  canExcluirSaidaNoModuloOperacional,
  isSaidaValidadaNoModulo,
  ORIGEM_INDUSTRIALIZACAO,
  ORIGEM_TRANSBORDO,
  TIPO_EMBALADO,
  TIPO_CONVENCIONAL,
} from "@transbordo/lib/saidaOrigem";
import {
  isSaidaExpedida,
  listSaidaIdsExpedidas,
} from "@transbordo/lib/saidaExpedicao";
import {
  findAgendamentoDisplayBySaida,
  formatSlotRef,
} from "@painel/lib/agendamentosCarregamento";
import { useSaidaNovas } from "@transbordo/context/SaidaNovasContext";
import { useSubmitGuard } from "@/shared/hooks/useSubmitGuard";

const STATUS_OPTIONS_VALIDACAO = [
  { value: "all", label: "Todos" },
  { value: "aguardando", label: "Pendente" },
  { value: "enviado_fiscal", label: "Validado" },
];

const STATUS_OPTIONS_EXPEDICAO = [
  { value: "all", label: "Todos" },
  { value: "aguardando", label: "Aguardando" },
  { value: "expedido", label: "Expedido" },
];

const DEFAULT_BASE_PATH = "/chemflow/saida";

/**
 * Tela de listagem de saídas.
 * `basePath` / `title` permitem reutilizar a mesma UI no Painel / Industrialização.
 * `onlyIndustrializacao` limita à saídas com itens do módulo Industrialização.
 * `excludeChemflow` oculta saídas criadas no ChemFlow (transbordo).
 * `statusMode`: "validacao" (ChemFlow) | "expedicao" (Painel Comercial — Expedido/Aguardando).
 */
export default function Saida({
  basePath = DEFAULT_BASE_PATH,
  title = "Saídas",
  onlyIndustrializacao = false,
  excludeChemflow = false,
  statusMode = "validacao",
} = {}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isNew, markAsRead, saidasRevision } = useSaidaNovas();
  const isExpedicao = statusMode === "expedicao";
  const trackNewFromPainel =
    !isExpedicao && (!excludeChemflow || onlyIndustrializacao);
  const isModuloOperacional = !isExpedicao;
  const operationalModule = onlyIndustrializacao
    ? ORIGEM_INDUSTRIALIZACAO
    : ORIGEM_TRANSBORDO;
  const statusOptions = isExpedicao
    ? STATUS_OPTIONS_EXPEDICAO
    : STATUS_OPTIONS_VALIDACAO;
  const [saidas, setSaidas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [entradas, setEntradas] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [expedidasIds, setExpedidasIds] = useState(() => new Set());
  const [agendamentos, setAgendamentos] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [clienteFilter, setClienteFilter] = useState("");
  const [deleteId, setDeleteId] = useState(null);
  const [viewSaida, setViewSaida] = useState(null);
  const [fiscalConfirm, setFiscalConfirm] = useState(null); // { saida, enviar: boolean }
  const [fiscalBusyId, setFiscalBusyId] = useState(null);
  const [fiscalError, setFiscalError] = useState("");
  const [loading, setLoading] = useState(true);
  const { busy: submitBusy, run: runSubmit } = useSubmitGuard();
  const tableColSpan = isExpedicao ? 11 : 10;

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [saics, cliens, ents, vascs, expedidas, agends] = await Promise.all([
        entities.saidas.list("-created_date"),
        entities.clientes.list(),
        entities.estoque.list(),
        entities.vasilhames.list(),
        isExpedicao ? listSaidaIdsExpedidas() : Promise.resolve(new Set()),
        isExpedicao
          ? entities.agendamentosCarregamento.list("-created_at").catch(() => [])
          : Promise.resolve([]),
      ]);
      let list = saics || [];
      if (onlyIndustrializacao) {
        list = list.filter(saidaHasIndustrializacaoItems);
      }
      if (excludeChemflow) {
        list = list.filter((s) => !isSaidaModuloChemflow(s));
      }
      setSaidas(list);
      setClientes(cliens);
      setEntradas(ents);
      setVasilhames(vascs);
      setExpedidasIds(expedidas instanceof Set ? expedidas : new Set());
      setAgendamentos(Array.isArray(agends) ? agends : []);
    } catch {
      if (!silent) {
        setSaidas([]);
        setExpedidasIds(new Set());
        setAgendamentos([]);
      }
    }
    if (!silent) setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [onlyIndustrializacao, excludeChemflow, isExpedicao]);

  const saidasRevisionSeen = useRef(saidasRevision);
  useEffect(() => {
    if (!trackNewFromPainel) return;
    if (saidasRevision === saidasRevisionSeen.current) return;
    saidasRevisionSeen.current = saidasRevision;
    loadData({ silent: true });
  }, [saidasRevision, trackNewFromPainel]);

  const getExpedicaoStatus = (saida) =>
    isSaidaExpedida(saida?.id, expedidasIds) ? "expedido" : "aguardando";

  const filtered = saidas.filter((s) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      s.codigo?.toLowerCase().includes(q) ||
      s.cliente_nome?.toLowerCase().includes(q);

    let matchStatus = true;
    if (statusFilter && statusFilter !== "Todos") {
      if (isExpedicao) {
        const status = getExpedicaoStatus(s);
        matchStatus =
          (statusFilter === "Aguardando" && status === "aguardando") ||
          (statusFilter === "Expedido" && status === "expedido");
      } else {
        matchStatus =
          ((statusFilter === "Pendente" || statusFilter === "Aguardando") &&
            s.status === "aguardando") ||
          ((statusFilter === "Validado" ||
            statusFilter === "Enviado" ||
            statusFilter === "Enviado ao Fiscal") &&
            s.status === "enviado_fiscal");
      }
    }

    const matchCliente =
      !clienteFilter ||
      clienteFilter === "Todos os clientes" ||
      s.cliente_nome === clienteFilter;

    return matchSearch && matchStatus && matchCliente;
  });

  const formatDate = (d) => {
    if (!d) return "-";
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("pt-BR");
  };

  const calcDias = (dataProgramada) => {
    if (!dataProgramada) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const programada = new Date(dataProgramada + "T00:00:00");
    return Math.ceil((programada - today) / (1000 * 60 * 60 * 24));
  };

  const renderDias = (dataProgramada) => {
    const dias = calcDias(dataProgramada);
    if (dias === null) return "-";
    if (dias < 0)
      return <span className="text-red-600 font-medium">Atrasado</span>;
    if (dias === 0)
      return <span className="text-amber-600 font-medium">Hoje</span>;
    return <span className="text-green-600 font-medium">{dias} dia(s)</span>;
  };

  const renderProdutosLabel = (s) => {
    const itens = s.itens || [];
    const distinct = new Map();
    for (const item of itens) {
      const key = item.produto_id || item.produto_nome;
      if (!key) continue;
      if (!distinct.has(key)) {
        distinct.set(key, item.produto_nome || "—");
      }
    }
    const count = distinct.size;
    if (count === 0) return "—";
    if (count === 1) return [...distinct.values()][0];
    const text = String(count).padStart(2, "0");
    return `${text} Produtos`;
  };

  const handleDelete = () => runSubmit(async () => {
    const saida = saidas.find((s) => s.id === deleteId);
    if (isModuloOperacional && !canExcluirSaidaNoModuloOperacional(saida)) {
      setDeleteId(null);
      return;
    }
    if (saida?.enviado_ao_fiscal) {
      // Restaurar estoque / vasilhames via mesma lógica de reverter fiscal
      try {
        await applySaidaFiscalToggle(saida, false, {
          userNome: user?.nome || "",
          estoque: entradas,
          vasilhames,
        });
      } catch {
        // segue para exclusão; sync Transbordo abaixo tenta recuperar saldo
      }
    }

    try {
      await entities.saidas.delete(deleteId);

      // Garante saldo Transbordo (embalado + convencional) após exclusão.
      // Industrialização não é recalculada aqui.
      if (saida?.enviado_ao_fiscal) {
        const itens = saida.itens || [];
        const embaladoIds = itens
          .filter(
            (i) =>
              (i.tipo === TIPO_EMBALADO || i.tipo === "embalado") &&
              i.entrada_id
          )
          .map((i) => i.entrada_id);
        let convencionalIds = [];
        try {
          const transbordos = await entities.transbordos.list();
          convencionalIds = resolveEstoqueIdsFromSaidaConvencional(
            itens.filter(
              (i) =>
                i.tipo === TIPO_CONVENCIONAL || i.tipo === "convencional"
            ),
            vasilhames,
            transbordos,
            entradas
          );
        } catch {
          convencionalIds = [];
        }
        const estoqueIds = [
          ...new Set([...embaladoIds, ...convencionalIds].filter(Boolean)),
        ];
        if (estoqueIds.length > 0) {
          await syncEstoqueSaldos(estoqueIds);
        }
      }

      await loadData();
    } catch {
      // ignore
    }
    setDeleteId(null);
  });

  const requestFiscalToggle = (saida) => {
    if (fiscalBusyId) return;
    const enviar = !isSaidaValidadaNoModulo(saida, operationalModule);
    setFiscalConfirm({ saida, enviar });
  };

  const confirmFiscalToggle = async () => {
    if (!fiscalConfirm?.saida) return;
    const { saida, enviar } = fiscalConfirm;
    setFiscalConfirm(null);
    setFiscalError("");
    setFiscalBusyId(saida.id);
    try {
      const updated = await applySaidaFiscalToggle(saida, enviar, {
        userNome: user?.nome || "",
        estoque: entradas,
        vasilhames,
        moduleScope: isSaidaModuloPainel(saida) ? operationalModule : "all",
      });
      setSaidas((prev) =>
        prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
      );
      if (enviar && trackNewFromPainel) {
        markAsRead(saida.id);
      }
      // Atualiza caches locais de estoque/vasilhames
      await loadData();
    } catch (err) {
      setFiscalError(
        err?.message ||
          "Não foi possível atualizar a validação. Tente novamente."
      );
    }
    setFiscalBusyId(null);
  };

  const clienteFilterOptions = [{ id: "all", nome: "Todos os clientes" }, ...clientes];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 space-y-4">
        {/* Header + Action Bar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {saidas.length} registro(s) cadastrado(s)
            </p>
          </div>
          <Button
            onClick={() => navigate(`${basePath}/novo`)}
            className="bg-primary hover:bg-primary/90 gap-2"
          >
            <Plus className="w-4 h-4" />
            Nova Saída
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por código ou cliente..."
              className="pl-10 bg-card"
            />
          </div>
          <div className="w-48">
            <SearchableSelect
              value={statusFilter}
              onChange={(label) => setStatusFilter(label)}
              options={statusOptions}
              getOptionLabel={(o) => o.label}
              getOptionValue={(o) => o.value}
              placeholder="Status"
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

        {!isExpedicao && fiscalError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {fiscalError}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-5 py-3 font-medium">ID</th>
                <th className="px-5 py-3 font-medium">Solicitante</th>
                <th className="px-5 py-3 font-medium">Data Solicitação</th>
                <th className="px-5 py-3 font-medium">Data Programada</th>
                <th className="px-5 py-3 font-medium">Dias</th>
                <th className="px-5 py-3 font-medium">Cliente</th>
                <th className="px-5 py-3 font-medium">Produtos</th>
                <th className="px-5 py-3 font-medium">Qtd. Total (kg)</th>
                {isExpedicao && (
                  <th className="px-5 py-3 font-medium">Agendamento</th>
                )}
                <th className="px-5 py-3 font-medium">
                  {isExpedicao ? "Carregamento" : "Validação"}
                </th>
                <th className="px-5 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={tableColSpan} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando saídas...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={tableColSpan} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhuma saída encontrada.
                  </td>
                </tr>
              ) : (
                filtered.map((s, i) => {
                  const expedicaoStatus = isExpedicao
                    ? getExpedicaoStatus(s)
                    : null;
                  const agendamento = isExpedicao
                    ? findAgendamentoDisplayBySaida(agendamentos, s.id)
                    : null;
                  const isValidated = isExpedicao
                    ? false
                    : isSaidaValidadaNoModulo(s, operationalModule);
                  const hideDias = isExpedicao
                    ? expedicaoStatus === "expedido"
                    : isValidated;

                  return (
                  <tr
                    key={s.id}
                    className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                      i % 2 === 1 ? "bg-muted/40/30" : ""
                    }`}
                  >
                    <td className="px-5 py-3 font-medium text-primary">
                      <span className="inline-flex items-center gap-1.5">
                        {s.codigo || "-"}
                        {trackNewFromPainel && isNew(s.id) ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none bg-primary/10 text-primary">
                            Novo
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-foreground">
                      {s.usuario_criador || "-"}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {formatDate(s.data_solicitacao)}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {formatDate(s.data_programada)}
                    </td>
                    <td className="px-5 py-3">
                      {hideDias ? "-" : renderDias(s.data_programada)}
                    </td>
                    <td className="px-5 py-3 text-foreground">{s.cliente_nome || "-"}</td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {renderProdutosLabel(s)}
                    </td>
                    <td className="px-5 py-3 font-medium text-foreground">
                      {formatMass(s.quantidade_total, { empty: "-" })}
                    </td>
                    {isExpedicao && (
                      <td className="px-5 py-3">
                        {agendamento ? (
                          <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap bg-green-50 text-green-700 border-green-300">
                            {formatSlotRef(agendamento)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-300">
                            Pendente
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-5 py-3">
                      {isExpedicao ? (
                        <span
                          className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border ${
                            expedicaoStatus === "expedido"
                              ? "bg-green-50 text-green-700 border-green-300"
                              : "bg-amber-50 text-amber-700 border-amber-300"
                          }`}
                        >
                          {expedicaoStatus === "expedido"
                            ? "Expedido"
                            : "Aguardando"}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={fiscalBusyId === s.id}
                          onClick={() => requestFiscalToggle(s)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 active:scale-[0.97] ${
                            isValidated
                              ? "bg-green-50 text-green-700 border-green-300 hover:bg-green-100 hover:border-green-400 hover:shadow-md focus-visible:ring-green-400"
                              : "bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100 hover:border-amber-400 hover:shadow-md focus-visible:ring-amber-400"
                          }`}
                          title={
                            isValidated
                              ? "Clique para retornar a Pendente"
                              : "Clique para marcar como Validado"
                          }
                        >
                          {fiscalBusyId === s.id ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3 opacity-70" />
                          )}
                          {fiscalBusyId === s.id
                            ? "..."
                            : isValidated
                              ? "Validado"
                              : "Pendente"}
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setViewSaida(s);
                            if (trackNewFromPainel && isNew(s.id)) {
                              markAsRead(s.id);
                            }
                          }}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Visualizar"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {!(isExpedicao && expedicaoStatus === "expedido") ? (
                          <button
                            onClick={() => navigate(`${basePath}/editar/${s.id}`)}
                            className="text-muted-foreground hover:text-muted-foreground transition-colors"
                            title="Editar"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        ) : null}
                        {(!isModuloOperacional ||
                          canExcluirSaidaNoModuloOperacional(s)) ? (
                          <button
                            onClick={() => setDeleteId(s.id)}
                            className="text-red-400 hover:text-red-600 transition-colors"
                            title="Excluir"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ) : null}
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
                filtered.reduce((sum, s) => sum + (s.quantidade_total || 0), 0)
              )}{" "}
              kg
            </span>
          </span>
        </div>
      </div>

      {/* View Modal */}
      <SaidaViewDialog
        open={!!viewSaida}
        onClose={() => setViewSaida(null)}
        saida={viewSaida}
        vasilhames={vasilhames}
        entradas={entradas}
        showRelatorioFiscal={!isExpedicao}
        highlightModule={isModuloOperacional ? operationalModule : null}
      />

      {/* Validação Confirmation (ChemFlow / Industrialização) */}
      {!isExpedicao && (
        <AlertDialog
          open={!!fiscalConfirm}
          onOpenChange={(v) => !v && setFiscalConfirm(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {fiscalConfirm?.enviar
                  ? "Confirmar validação"
                  : "Reverter validação"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {fiscalConfirm?.enviar
                  ? "Confirma a validação desta saída?"
                  : isSaidaModuloPainel(fiscalConfirm?.saida)
                    ? "Os saldos dos produtos deste módulo retornarão para o estoque. Itens de outros módulos não são alterados."
                    : "Tem certeza que deseja mudar o status dessa saída para Pendente? Lembrando que todos os saldos dos produtos presentes nessa saída retornarão para o estoque."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  confirmFiscalToggle();
                }}
                className={
                  fiscalConfirm?.enviar
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-amber-600 hover:bg-amber-700"
                }
              >
                Confirmar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta saída? O estoque será
              restaurado. Esta ação não pode ser desfeita.
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