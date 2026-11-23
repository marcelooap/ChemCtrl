import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { entities } from '@transbordo/services/entities';
import { useInternalAuth as useAuth } from '@/lib/InternalAuthContext';
import { Plus, Search, Eye, Pencil, Trash2, RefreshCw, Truck, AlertTriangle } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import { RowActionButton } from "@shared/components/ui/RowActionButton";
import { Checkbox } from "@shared/components/ui/checkbox";
import { Input } from "@shared/components/ui/input";
import { ServerPaginationBar } from "@shared/components/ServerPaginationBar";
import { DEFAULT_PAGE_SIZE } from "@shared/lib/pagination";
import { useDebouncedValue } from "@shared/hooks/useDebouncedValue";
import { withScreenLoadPerf } from "@shared/lib/perfMarks";
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
import { useToast } from "@shared/components/ui/use-toast";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import SaidaViewDialog from "@transbordo/components/saida/SaidaViewDialog";
import SaidaRemoverModal from "@transbordo/components/saida/SaidaRemoverModal";
import AgendamentoTransporteModal from "@painel/components/comercial/AgendamentoTransporteModal";
import {
  assertPodeExcluirSaidaDefinitivamente,
  cancelarCarregamentoSaida,
} from "@transbordo/lib/saidaCancelamento";
import { formatMass } from "@transbordo/lib/format";
import {
  applyDeclaredVolumeDecimals,
  persistDeclaredVolumeDecimals,
} from "@transbordo/lib/declaredVolume";
import {
  applySaidaFiscalToggle,
  reconcileValidatedSaidaEmbalagens,
} from "@transbordo/lib/saidaFiscal";
import {
  applyEstoqueStatusWmsPatch,
  ESTOQUE_STATUS_WMS_EVENT,
  saidaTemItemWmsNok,
  WMS_ALERT_TITLE,
} from "@transbordo/lib/saidaStatusWms";
import {
  saidaHasIndustrializacaoItems,
  saidaVisivelNoTransbordo,
  isSaidaModuloChemflow,
  isSaidaModuloPainel,
  canExcluirSaidaNoModuloOperacional,
  isSaidaValidadaNoModulo,
  isSaidaCancelada,
  saidaTemItemPendenteNoModulo,
  calcSaidaQuantidadeTotal,
  isSaidaCargaVazia,
  isItemSaidaVazio,
  isTanqueVazioItem,
  descricaoCarregamentoGenerico,
  resolveItemOrigem,
  resolveSaidaItemLote,
  ORIGEM_INDUSTRIALIZACAO,
  ORIGEM_TRANSBORDO,
} from "@transbordo/lib/saidaOrigem";
import {
  isSaidaExpedida,
  listSaidaIdsExpedidas,
} from "@transbordo/lib/saidaExpedicao";
import {
  findAgendamentoDisplayBySaida,
  formatSlotRef,
  hasTransporte,
  saidaTemProdutoInformado,
  updateTransporte,
} from "@painel/lib/agendamentosCarregamento";
import { checklistItemsFromBooking } from "@painel/lib/carregamentoChecklistConfig";
import { uniqueClientesByNome } from "@painel/lib/recebimentoCatalog";
import { useSaidaNovas } from "@transbordo/context/SaidaNovasContext";
import { useSubmitGuard } from "@/shared/hooks/useSubmitGuard";
import { healLinkedLotes } from "@transbordo/lib/cascadeEntradaUpdate";
import {
  healSaidaVolumesFromVasilhames,
  repairVolumeFromDestinosPatch,
} from "@transbordo/lib/vasilhameComposicao";
import { healTransbordoDensidadeMassaPatch } from "@transbordo/lib/densidadeOperacional";
import { loadTransbordoWorkspaceLists } from "@transbordo/services/transbordoWorkspace";

const STATUS_OPTIONS_VALIDACAO = [
  { value: "all", label: "Todos" },
  { value: "aguardando", label: "Pendente" },
  { value: "enviado_fiscal", label: "Validado" },
  { value: "cancelado", label: "Cancelado" },
];

const STATUS_OPTIONS_EXPEDICAO = [
  { value: "all", label: "Todos" },
  { value: "aguardando", label: "Aguardando" },
  { value: "expedido", label: "Expedido" },
  { value: "cancelado", label: "Cancelado" },
];

const STATUS_OPTIONS_AGENDAMENTO = [
  { value: "all", label: "Todos" },
  { value: "pendente", label: "Pendente" },
  { value: "agendado", label: "Agendado" },
];

const STATUS_OPTIONS_TRANSPORTE = [
  { value: "all", label: "Todos" },
  { value: "pendente", label: "Pendente" },
  { value: "registrado", label: "Registrado" },
];

const DEFAULT_BASE_PATH = "/chemflow/saida";

/** Diferença em dias entre a data programada (YYYY-MM-DD) e hoje. */
function calcDias(dataProgramada) {
  if (!dataProgramada) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const programada = new Date(dataProgramada + "T00:00:00");
  return Math.ceil((programada - today) / (1000 * 60 * 60 * 24));
}

/** Ordena pelo código da saída (S001, S012…) — maior ID primeiro. */
function compareSaidaCodigoDesc(a, b) {
  const parse = (value) => {
    const text = String(value || "").trim();
    const digits = text.replace(/\D+/g, "");
    if (digits) return Number(digits);
    return Number.NEGATIVE_INFINITY;
  };
  const diff = parse(b?.codigo) - parse(a?.codigo);
  if (diff !== 0) return diff;
  return String(b?.codigo || "").localeCompare(String(a?.codigo || ""), "pt-BR");
}

/** Busca textual: código, cliente, lote ou tanque (placa / barril) nos itens. */
function saidaMatchesSearch(saida, query, vasilhamesById) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;

  if (String(saida?.codigo || "").toLowerCase().includes(q)) return true;
  if (String(saida?.cliente_nome || "").toLowerCase().includes(q)) return true;
  if (String(saida?.pedido_cliente || "").toLowerCase().includes(q)) return true;

  for (const item of saida?.itens || []) {
    const placaItem = String(item?.vasilhame_placa || "").toLowerCase();
    const barrilItem = String(item?.vasilhame_barril || "").toLowerCase();
    if (placaItem.includes(q) || barrilItem.includes(q)) return true;
    if (String(item?.descricao_carregamento || "").toLowerCase().includes(q)) {
      return true;
    }
    if (String(item?.produto_nome || "").toLowerCase().includes(q)) return true;

    const vasilhameId = String(item?.vasilhame_id || "").trim();
    const vasilhame =
      vasilhameId && vasilhamesById
        ? vasilhamesById.get(vasilhameId)
        : null;

    const lote = String(
      resolveSaidaItemLote(item, { vasilhame }) || item?.lote || ""
    ).toLowerCase();
    if (lote.includes(q)) return true;

    if (!vasilhame) continue;

    const placaCadastro = String(
      vasilhame.placa || vasilhame.container_number || ""
    ).toLowerCase();
    const barrilCadastro = String(
      vasilhame.barril || vasilhame.barril_number || ""
    ).toLowerCase();
    if (placaCadastro.includes(q) || barrilCadastro.includes(q)) return true;
  }

  return false;
}

/**
 * Tela de listagem de saídas.
 * `basePath` / `title` permitem reutilizar a mesma UI no Painel / Industrialização.
 * `onlyIndustrializacao` limita à saídas com itens do módulo Industrialização.
 * No Transbordo operacional, saídas só da Industrialização ficam de fora.
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
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { isNew, markAsRead, saidasRevision, lastSaidaChange } = useSaidaNovas();
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
  const [transbordos, setTransbordos] = useState([]);
  const [expedidasIds, setExpedidasIds] = useState(() => new Set());
  const [agendamentos, setAgendamentos] = useState([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [clienteFilter, setClienteFilter] = useState("");
  const [agendamentoFilter, setAgendamentoFilter] = useState("");
  const [transporteFilter, setTransporteFilter] = useState("");
  /** Comercial: filtro opcional; inicia desmarcado ao abrir a tela. */
  const [carregamentosHoje, setCarregamentosHoje] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const listScrollRef = useRef(null);
  const [viewSaida, setViewSaida] = useState(null);
  const [transporteBooking, setTransporteBooking] = useState(null);
  const [fiscalConfirm, setFiscalConfirm] = useState(null); // { saida, enviar: boolean }
  const [fiscalBusyId, setFiscalBusyId] = useState(null);
  const [fiscalError, setFiscalError] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const { busy: submitBusy, run: runSubmit } = useSubmitGuard();
  // Expedição: remove Data Solicitação (-1) e adiciona Transporte (+1) → mantém 11.
  const tableColSpan = isExpedicao ? 12 : 11;

  const applySaidaVisibility = useCallback(
    (list) => {
      let next = list || [];
      if (onlyIndustrializacao) {
        next = next.filter(saidaHasIndustrializacaoItems);
      } else if (!isExpedicao) {
        next = next.filter(saidaVisivelNoTransbordo);
      }
      if (excludeChemflow) {
        next = next.filter((s) => !isSaidaModuloChemflow(s));
      }
      return next;
    },
    [onlyIndustrializacao, isExpedicao, excludeChemflow]
  );

  const runHealsInBackground = useCallback(
    async ({ list, volumes, entradasDoc }) => {
      setSyncing(true);
      try {
        let transbordosAlinhados = volumes.transbordos || [];
        try {
          const densCtx = {
            entradas: [...(volumes.estoque || []), ...(entradasDoc || [])],
          };
          const densUpdates = [];
          const nextTrans = [];
          for (const t of transbordosAlinhados) {
            const patch = healTransbordoDensidadeMassaPatch(t, densCtx);
            if (!patch) {
              nextTrans.push(t);
              continue;
            }
            densUpdates.push({ id: t.id, ...patch });
            nextTrans.push({ ...t, ...patch });
          }
          if (densUpdates.length > 0) {
            await entities.transbordos.bulkUpdate(densUpdates);
          }
          transbordosAlinhados = nextTrans;
        } catch (densErr) {
          console.error(
            "[Transbordo] Falha ao alinhar densidade/massa dos OPs:",
            densErr
          );
        }

        let nextList = list || [];
        let vasilhamesAlinhados = volumes.vasilhames;
        try {
          const healed = await healLinkedLotes({
            estoqueRows: volumes.estoque,
            transbordos: transbordosAlinhados,
            vasilhames: volumes.vasilhames,
            saidas: nextList,
          });
          nextList = healed.saidas || nextList;
          vasilhamesAlinhados = healed.vasilhames || volumes.vasilhames;
          transbordosAlinhados = healed.transbordos || transbordosAlinhados;
        } catch (err) {
          console.error("[Transbordo] Falha ao alinhar lote das saídas:", err);
        }
        try {
          const repairJobs = (vasilhamesAlinhados || []).map(async (row) => {
            const patch = repairVolumeFromDestinosPatch(row, transbordosAlinhados);
            if (!patch) return row;
            try {
              const updated = await entities.vasilhames.update(row.id, patch);
              return { ...row, ...(updated || {}), ...patch };
            } catch (err) {
              console.error(
                "[Transbordo] Falha ao restaurar volume do vasilhame:",
                err
              );
              return row;
            }
          });
          // Concorrência limitada em lotes de 8 para não saturar o PostgREST.
          const repaired = [];
          for (let i = 0; i < repairJobs.length; i += 8) {
            const chunk = await Promise.all(repairJobs.slice(i, i + 8));
            repaired.push(...chunk);
          }
          vasilhamesAlinhados = repaired;
        } catch (err) {
          console.error("[Transbordo] Falha ao alinhar volume dos vasilhames:", err);
        }
        try {
          const volHealed = await healSaidaVolumesFromVasilhames({
            saidas: nextList,
            vasilhames: vasilhamesAlinhados,
            transbordos: transbordosAlinhados,
            entitiesApi: entities,
          });
          nextList = volHealed.saidas || nextList;
        } catch (err) {
          console.error("[Transbordo] Falha ao alinhar volume das saídas:", err);
        }
        try {
          await reconcileValidatedSaidaEmbalagens(nextList, {
            vasilhames: vasilhamesAlinhados,
          });
        } catch (err) {
          console.error(
            "[Transbordo] Falha ao reconciliar expedição das saídas validadas:",
            err
          );
        }
        setSaidas(applySaidaVisibility(nextList));
        setVasilhames(vasilhamesAlinhados);
        setTransbordos(transbordosAlinhados);
      } finally {
        setSyncing(false);
      }
    },
    [applySaidaVisibility]
  );

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    await withScreenLoadPerf("saida", async () => {
      try {
        // Workspace já inclui saidas — evita double-fetch de t_saidas.
        // Clientes/entradas não devem derrubar a lista se falharem.
        const [workspace, cliens, expedidas, agends, entradasDoc] =
          await Promise.all([
            loadTransbordoWorkspaceLists({ force: silent }),
            entities.clientes
              .list("nome", { select: "id,nome,created_at" })
              .catch((err) => {
                console.error("[Saida] Falha ao carregar clientes:", err);
                return [];
              }),
            isExpedicao ? listSaidaIdsExpedidas() : Promise.resolve(new Set()),
            isExpedicao
              ? entities.agendamentosCarregamento
                  .list("-created_at")
                  .catch(() => [])
              : Promise.resolve([]),
            entities.entradas.list().catch((err) => {
              console.error("[Saida] Falha ao carregar entradas:", err);
              return [];
            }),
          ]);
        const ents = workspace.estoque;
        const vascs = workspace.vasilhames;
        const trans = workspace.transbordos;
        const saics = workspace.saidas || [];
        const volumes = applyDeclaredVolumeDecimals({
          estoque: ents,
          entradas: entradasDoc,
          transbordos: trans,
          vasilhames: vascs,
        });
        void persistDeclaredVolumeDecimals(volumes);

        const visible = applySaidaVisibility(saics);
        setSaidas(visible);
        setClientes(cliens || []);
        setEntradas(volumes.estoque);
        setVasilhames(volumes.vasilhames);
        setTransbordos(volumes.transbordos);
        setExpedidasIds(expedidas instanceof Set ? expedidas : new Set());
        setAgendamentos(Array.isArray(agends) ? agends : []);
        if (!silent) setLoading(false);

        void runHealsInBackground({
          list: saics,
          volumes,
          entradasDoc,
        });
      } catch (err) {
        console.error("[Saida] Falha ao carregar listagem:", err);
        if (!silent) {
          setSaidas([]);
          setExpedidasIds(new Set());
          setAgendamentos([]);
        }
        if (!silent) setLoading(false);
      }
    });
  };

  useEffect(() => {
    loadData();
  }, [onlyIndustrializacao, excludeChemflow, isExpedicao]);

  // Quando o Status WMS muda no Estoque, remove/exibe o alerta NOK na lista
  // sem esperar um reload completo (mesmo item vinculado).
  useEffect(() => {
    const onEstoqueStatusWms = (event) => {
      const id = event?.detail?.id;
      if (id == null) return;
      const statusWms = !!event.detail.status_wms;
      setEntradas((prev) => applyEstoqueStatusWmsPatch(prev, id, statusWms));
    };
    window.addEventListener(ESTOQUE_STATUS_WMS_EVENT, onEstoqueStatusWms);
    return () =>
      window.removeEventListener(ESTOQUE_STATUS_WMS_EVENT, onEstoqueStatusWms);
  }, []);

  const saidasRevisionSeen = useRef(saidasRevision);
  // Patch seletivo da lista em qualquer modo (inclui Solicitações/expedição).
  // Antes só rodava com trackNewFromPainel — Pedido Cliente demorava a refletir.
  useEffect(() => {
    if (saidasRevision === saidasRevisionSeen.current) return;
    saidasRevisionSeen.current = saidasRevision;
    const change = lastSaidaChange;
    if (!change?.eventType) {
      loadData({ silent: true });
      return;
    }
    if (change.eventType === "DELETE") {
      const deletedId = change.old?.id;
      if (!deletedId) return;
      setSaidas((prev) => prev.filter((s) => s.id !== deletedId));
      return;
    }
    const row = change.new;
    if (!row?.id) {
      loadData({ silent: true });
      return;
    }
    const [visible] = applySaidaVisibility([row]);
    if (!visible) {
      setSaidas((prev) => prev.filter((s) => s.id !== row.id));
      return;
    }
    setSaidas((prev) => {
      const idx = prev.findIndex((s) => s.id === row.id);
      if (idx === -1) {
        return change.eventType === "INSERT" ? [visible, ...prev] : prev;
      }
      const next = [...prev];
      next[idx] = { ...next[idx], ...visible };
      return next;
    });
  }, [saidasRevision, lastSaidaChange, applySaidaVisibility]);

  const getExpedicaoStatus = (saida) => {
    if (isSaidaCancelada(saida)) return "cancelado";
    return isSaidaExpedida(saida?.id, expedidasIds) ? "expedido" : "aguardando";
  };

  /** Mesma regra da coluna Validação — não usar só `saida.status`. */
  const isSaidaValidadaNaLista = (saida) =>
    !isSaidaCancelada(saida) &&
    isSaidaValidadaNoModulo(saida, operationalModule) &&
    !saidaTemItemPendenteNoModulo(saida, operationalModule);

  const deleteTarget = deleteId
    ? saidas.find((s) => s.id === deleteId) || null
    : null;

  const vasilhamesById = useMemo(() => {
    const map = new Map();
    for (const row of vasilhames || []) {
      const id = String(row?.id || "").trim();
      if (id) map.set(id, row);
    }
    return map;
  }, [vasilhames]);

  const wmsCtx = useMemo(
    () => ({
      vasilhames,
      transbordos,
      estoque: entradas,
    }),
    [vasilhames, transbordos, entradas]
  );

  const filtered = useMemo(() => {
    const rows = saidas.filter((s) => {
      const matchSearch = saidaMatchesSearch(s, debouncedSearch, vasilhamesById);

      let matchStatus = true;
      if (
        statusFilter &&
        statusFilter !== "Todos" &&
        statusFilter !== "all"
      ) {
        if (isExpedicao) {
          const status = getExpedicaoStatus(s);
          const wantAguardando =
            statusFilter === "Aguardando" || statusFilter === "aguardando";
          const wantExpedido =
            statusFilter === "Expedido" || statusFilter === "expedido";
          const wantCancelado =
            statusFilter === "Cancelado" || statusFilter === "cancelado";
          matchStatus =
            (wantAguardando && status === "aguardando") ||
            (wantExpedido && status === "expedido") ||
            (wantCancelado && status === "cancelado");
        } else {
          const cancelada = isSaidaCancelada(s);
          const isValidated = isSaidaValidadaNaLista(s);
          const wantPendente =
            statusFilter === "Pendente" ||
            statusFilter === "Aguardando" ||
            statusFilter === "aguardando";
          const wantValidado =
            statusFilter === "Validado" ||
            statusFilter === "Enviado" ||
            statusFilter === "Enviado ao Fiscal" ||
            statusFilter === "enviado_fiscal";
          const wantCancelado =
            statusFilter === "Cancelado" || statusFilter === "cancelado";
          matchStatus =
            (wantPendente && !cancelada && !isValidated) ||
            (wantValidado && isValidated) ||
            (wantCancelado && cancelada);
        }
      }

      const matchCliente =
        !clienteFilter ||
        clienteFilter === "Todos os clientes" ||
        clienteFilter === "all" ||
        s.cliente_nome === clienteFilter;

      let matchAgendamento = true;
      let matchTransporte = true;
      let matchCarregamentosHoje = true;
      if (isExpedicao) {
        const agendamento = findAgendamentoDisplayBySaida(agendamentos, s.id);

        if (
          agendamentoFilter &&
          agendamentoFilter !== "Todos" &&
          agendamentoFilter !== "all"
        ) {
          const wantPendente =
            agendamentoFilter === "Pendente" ||
            agendamentoFilter === "pendente";
          const wantAgendado =
            agendamentoFilter === "Agendado" ||
            agendamentoFilter === "agendado";
          matchAgendamento =
            (wantPendente && !agendamento) ||
            (wantAgendado && Boolean(agendamento));
        }

        if (
          transporteFilter &&
          transporteFilter !== "Todos" &&
          transporteFilter !== "all"
        ) {
          const registrado = hasTransporte(agendamento);
          const wantPendente =
            transporteFilter === "Pendente" ||
            transporteFilter === "pendente";
          const wantRegistrado =
            transporteFilter === "Registrado" ||
            transporteFilter === "registrado";
          matchTransporte =
            (wantPendente && !registrado) ||
            (wantRegistrado && registrado);
        }

        // Data programada = hoje (calcDias === 0), independente de já ter sido carregada.
        if (carregamentosHoje) {
          matchCarregamentosHoje = calcDias(s.data_programada) === 0;
        }
      }

      return (
        matchSearch &&
        matchStatus &&
        matchCliente &&
        matchAgendamento &&
        matchTransporte &&
        matchCarregamentosHoje
      );
    });

    // Operacional: saídas com tag "Novo" ficam no topo, separadas do restante.
    // Depois de visualizar/validar, voltam à ordem normal por código (ID).
    if (!trackNewFromPainel) {
      return [...rows].sort(compareSaidaCodigoDesc);
    }

    const novas = [];
    const demais = [];
    for (const s of rows) {
      if (isNew(s.id)) novas.push(s);
      else demais.push(s);
    }
    novas.sort(compareSaidaCodigoDesc);
    demais.sort(compareSaidaCodigoDesc);
    return [...novas, ...demais];
  }, [
    saidas,
    debouncedSearch,
    statusFilter,
    clienteFilter,
    agendamentoFilter,
    transporteFilter,
    carregamentosHoje,
    agendamentos,
    isExpedicao,
    trackNewFromPainel,
    isNew,
    expedidasIds,
    operationalModule,
    vasilhamesById,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    statusFilter,
    clienteFilter,
    agendamentoFilter,
    transporteFilter,
    carregamentosHoje,
  ]);

  const pagedFiltered = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return filtered.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filtered, page]);

  const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  const formatDate = (d) => {
    if (!d) return "-";
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("pt-BR");
  };

  const formatDateWithWeekday = (d) => {
    if (!d) return "-";
    const date = new Date(d + "T00:00:00");
    const dateStr = date.toLocaleDateString("pt-BR");
    const weekday = DIAS_SEMANA[date.getDay()];
    return (
      <span className="flex flex-col gap-0.5 leading-tight">
        <span>{dateStr}</span>
        <span className="text-xs font-medium text-primary">{weekday}</span>
      </span>
    );
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
    if (isSaidaCargaVazia(s)) {
      const descricoes = (s.itens || [])
        .map((item) => descricaoCarregamentoGenerico(item))
        .filter(Boolean);
      if (descricoes.length === 1) return descricoes[0];
      if (descricoes.length > 1) {
        return `${String(descricoes.length).padStart(2, "0")} itens genéricos`;
      }
      return "Carregamento genérico";
    }
    // Comercial: saída agendada antes do cliente informar produto/tanque.
    if (isExpedicao && !saidaTemProdutoInformado(s)) {
      return "Aguardando informações";
    }
    const itens = s.itens || [];
    const distinct = new Map();
    for (const item of itens) {
      if (isItemSaidaVazio(item)) continue;
      if (isTanqueVazioItem(item)) {
        const key = `gen:${item.item_uid || descricaoCarregamentoGenerico(item)}`;
        if (!distinct.has(key)) {
          distinct.set(
            key,
            descricaoCarregamentoGenerico(item) || "Carregamento genérico"
          );
        }
        continue;
      }
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

  /** Sempre a partir dos itens atuais — não depende de `quantidade_total` desatualizado. */
  const quantidadeTotalSaida = (s) =>
    calcSaidaQuantidadeTotal(s?.itens, { vasilhames, transbordos });

  const renderQuantidadeTotal = (s) => {
    if (isSaidaCargaVazia(s)) return "-";
    if (isExpedicao && !saidaTemProdutoInformado(s)) return "-";
    return formatMass(quantidadeTotalSaida(s), { empty: "-" });
  };

  const handleSaveTransporte = async ({ transportadora, motorista, placa }) => {
    if (!transporteBooking?.id) return;
    await updateTransporte({
      bookings: [transporteBooking],
      transportadora,
      motorista,
      placa,
      t,
    });
    toast({
      title: t("painel.comercial.agendamentos.transporte.saveSuccess"),
    });
    await loadData({ silent: true });
  };

  const rememberScroll = () => {
    const list = listScrollRef.current;
    const page = list?.closest(".overflow-y-auto") ?? null;
    return {
      list,
      listTop: list?.scrollTop ?? 0,
      page: page && page !== list ? page : null,
      pageTop: page && page !== list ? page.scrollTop : 0,
    };
  };

  const restoreScroll = (snap) => {
    if (!snap) return;
    const apply = () => {
      if (snap.list) snap.list.scrollTop = snap.listTop;
      if (snap.page) snap.page.scrollTop = snap.pageTop;
    };
    apply();
    requestAnimationFrame(apply);
  };

  const handleCancelarCarregamento = (justificativa) =>
    runSubmit(async () => {
      const id = deleteId;
      const saida = saidas.find((s) => s.id === id);
      if (!saida) {
        setDeleteId(null);
        return;
      }
      if (isModuloOperacional && !canExcluirSaidaNoModuloOperacional(saida)) {
        setDeleteId(null);
        return;
      }
      if (isExpedicao && isSaidaExpedida(id, expedidasIds)) {
        toast({
          title: "Não é possível cancelar",
          description: "Esta saída já foi expedida.",
          variant: "destructive",
        });
        setDeleteId(null);
        return;
      }

      try {
        const updated = await cancelarCarregamentoSaida({
          saida,
          justificativa,
          userNome: user?.nome || user?.full_name || "",
          estoque: entradas,
          vasilhames,
        });
        setSaidas((prev) =>
          prev.map((row) =>
            row.id === id ? { ...row, ...updated } : row
          )
        );
        if (viewSaida?.id === id) {
          setViewSaida((prev) => (prev ? { ...prev, ...updated } : prev));
        }
        setDeleteId(null);
        toast({
          title: "Carregamento cancelado",
          description: "A saída permanece no histórico com status Cancelado.",
        });
        await loadData({ silent: true });
      } catch (err) {
        toast({
          title: "Não foi possível cancelar",
          description: err?.message || "Tente novamente.",
          variant: "destructive",
        });
      }
    });

  const handleDelete = () =>
    runSubmit(async () => {
      const id = deleteId;
      const saida = saidas.find((s) => s.id === id);
      if (isModuloOperacional && !canExcluirSaidaNoModuloOperacional(saida)) {
        setDeleteId(null);
        return;
      }
      if (isExpedicao && isSaidaExpedida(id, expedidasIds)) {
        setDeleteId(null);
        return;
      }

      try {
        assertPodeExcluirSaidaDefinitivamente(saida);
      } catch (err) {
        toast({
          title: "Exclusão bloqueada",
          description: err?.message || "Desvalide a saída antes de excluir.",
          variant: "destructive",
        });
        return;
      }

      try {
        await entities.saidas.delete(id);
        const snap = rememberScroll();
        setRemovingId(id);
        setDeleteId(null);
        restoreScroll(snap);
        await new Promise((resolve) => setTimeout(resolve, 160));
        setSaidas((prev) => prev.filter((s) => s.id !== id));
        setRemovingId(null);
        restoreScroll(snap);
        toast({
          title: "Saída excluída",
          description: "A solicitação foi removida definitivamente.",
        });
        await loadData({ silent: true });
        restoreScroll(snap);
      } catch {
        setRemovingId(null);
        toast({
          title: "Não foi possível excluir",
          description: "Tente novamente.",
          variant: "destructive",
        });
      }
      setDeleteId(null);
    });

  const requestFiscalToggle = (saida) => {
    if (fiscalBusyId) return;
    const temPendente = saidaTemItemPendenteNoModulo(saida, operationalModule);
    const enviar = temPendente || !isSaidaValidadaNoModulo(saida, operationalModule);
    const painel = isSaidaModuloPainel(saida);
    const itensEscopo = (saida?.itens || []).filter((item) => {
      if (!item || isItemSaidaVazio(item)) return false;
      if (!painel) return true;
      return resolveItemOrigem(item) === operationalModule;
    });
    const somenteGenerico =
      itensEscopo.length > 0 && itensEscopo.every(isTanqueVazioItem);
    setFiscalConfirm({
      saida,
      enviar,
      somentePendentes: temPendente,
      somenteGenerico,
    });
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
      // Atualiza caches locais de estoque/vasilhames em background (sem piscar a tela)
      await loadData({ silent: true });
    } catch (err) {
      setFiscalError(
        err?.message ||
          "Não foi possível atualizar a validação. Tente novamente."
      );
    }
    setFiscalBusyId(null);
  };

  const clienteFilterOptions = useMemo(
    () => [
      { id: "all", nome: "Todos os clientes" },
      ...uniqueClientesByNome(clientes),
    ],
    [clientes]
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 space-y-4">
        {/* Header + Action Bar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {saidas.length} registro(s) cadastrado(s)
              {syncing ? " · sincronizando…" : ""}
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
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por código, cliente, pedido, lote ou tanque..."
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
              placeholder="Cliente"
              selectOnly
            />
          </div>
          {isExpedicao && (
            <>
              <div className="w-44">
                <SearchableSelect
                  value={transporteFilter}
                  onChange={(label) => setTransporteFilter(label)}
                  options={STATUS_OPTIONS_TRANSPORTE}
                  getOptionLabel={(o) => o.label}
                  getOptionValue={(o) => o.value}
                  placeholder="Transporte"
                  selectOnly
                />
              </div>
              <div className="w-44">
                <SearchableSelect
                  value={agendamentoFilter}
                  onChange={(label) => setAgendamentoFilter(label)}
                  options={STATUS_OPTIONS_AGENDAMENTO}
                  getOptionLabel={(o) => o.label}
                  getOptionValue={(o) => o.value}
                  placeholder="Agendamento"
                  selectOnly
                />
              </div>
            </>
          )}
          <div className="w-44">
            <SearchableSelect
              value={statusFilter}
              onChange={(label) => setStatusFilter(label)}
              options={statusOptions}
              getOptionLabel={(o) => o.label}
              getOptionValue={(o) => o.value}
              placeholder={isExpedicao ? "Carregamento" : "Status"}
              selectOnly
            />
          </div>
          {isExpedicao && (
            <label
              htmlFor="filtro-carregamentos-hoje"
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm transition-colors hover:bg-muted/50"
            >
              <Checkbox
                id="filtro-carregamentos-hoje"
                checked={carregamentosHoje}
                onCheckedChange={(checked) =>
                  setCarregamentosHoje(checked === true)
                }
                aria-label="Carregamentos Hoje"
              />
              <span className="whitespace-nowrap font-medium">
                Carregamentos Hoje
              </span>
            </label>
          )}
        </div>

        {!isExpedicao && fiscalError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {fiscalError}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
        <div ref={listScrollRef} className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-5 py-3 font-medium">ID</th>
                <th className="px-5 py-3 font-medium">Solicitante</th>
                {!isExpedicao && (
                  <th className="px-5 py-3 font-medium">Data Solicitação</th>
                )}
                <th className="px-5 py-3 font-medium">Data Programada</th>
                <th className="px-5 py-3 font-medium">Dias</th>
                <th className="px-5 py-3 font-medium text-center">Pedido Cliente</th>
                <th className="px-5 py-3 font-medium">Cliente</th>
                <th className="px-5 py-3 font-medium">Produtos</th>
                <th className="px-5 py-3 font-medium">Qtd. Total (kg)</th>
                {isExpedicao && (
                  <>
                    <th className="px-5 py-3 font-medium">Agendamento</th>
                    <th className="px-5 py-3 font-medium">Transporte</th>
                  </>
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
                pagedFiltered.map((s, i) => {
                  const expedicaoStatus = isExpedicao
                    ? getExpedicaoStatus(s)
                    : null;
                  const agendamento = isExpedicao
                    ? findAgendamentoDisplayBySaida(agendamentos, s.id)
                    : null;
                  const transporteRegistrado =
                    isExpedicao && hasTransporte(agendamento);
                  const cancelada = isSaidaCancelada(s);
                  const isValidated = isExpedicao
                    ? false
                    : isSaidaValidadaNaLista(s);
                  const hideDias =
                    cancelada ||
                    (isExpedicao
                      ? expedicaoStatus === "expedido"
                      : isValidated);
                  const isNova = trackNewFromPainel && isNew(s.id);
                  const wmsNok = saidaTemItemWmsNok(s, wmsCtx);
                  const next = pagedFiltered[i + 1];
                  const isLastNova =
                    isNova &&
                    (!next || !(trackNewFromPainel && isNew(next.id)));

                  return (
                  <tr
                    key={s.id}
                    className={`transition-opacity duration-150 ${
                      removingId === s.id ? "opacity-0" : ""
                    } ${
                      isNova
                        ? `bg-primary/[0.06] hover:bg-primary/[0.1] ${
                            isLastNova
                              ? "border-b-2 border-primary/25"
                              : "border-b border-primary/10"
                          }`
                        : wmsNok
                          ? `border-b border-border last:border-0 bg-amber-50/40 dark:bg-amber-950/20 hover:bg-amber-50/60 dark:hover:bg-amber-950/30`
                          : `border-b border-border last:border-0 hover:bg-muted/40 ${
                              i % 2 === 1 ? "bg-muted/40/30" : ""
                            }`
                    }`}
                  >
                    <td className="px-5 py-3 font-medium text-primary">
                      <span className="inline-flex items-center gap-1.5">
                        {s.codigo || "-"}
                        {wmsNok ? (
                          <AlertTriangle
                            className="h-3.5 w-3.5 text-amber-600 shrink-0"
                            title={WMS_ALERT_TITLE}
                            aria-label={WMS_ALERT_TITLE}
                          />
                        ) : null}
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
                    {!isExpedicao && (
                      <td className="px-5 py-3 text-muted-foreground">
                        {formatDateWithWeekday(s.data_solicitacao)}
                      </td>
                    )}
                    <td className="px-5 py-3 text-muted-foreground">
                      {s.data_programada
                        ? formatDateWithWeekday(s.data_programada)
                        : "Aguardando"}
                    </td>
                    <td className="px-5 py-3">
                      {hideDias || !s.data_programada
                        ? "-"
                        : renderDias(s.data_programada)}
                    </td>
                    <td className="px-5 py-3 text-foreground text-center">
                      {s.pedido_cliente || "-"}
                    </td>
                    <td className="px-5 py-3 text-foreground">{s.cliente_nome || "-"}</td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {renderProdutosLabel(s)}
                    </td>
                    <td className="px-5 py-3 font-medium text-foreground">
                      {renderQuantidadeTotal(s)}
                    </td>
                    {isExpedicao && (
                      <>
                        <td className="px-5 py-3">
                          {agendamento ? (
                            <span
                              className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap ${
                                agendamento.tipo === 'encaixe' || agendamento.horario === 'encaixe'
                                  ? 'bg-gray-100 text-gray-500 border-gray-300'
                                  : 'bg-green-50 text-green-700 border-green-300'
                              }`}
                            >
                              {formatSlotRef(agendamento)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-300">
                              Pendente
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            {transporteRegistrado ? (
                              <button
                                type="button"
                                onClick={() => setTransporteBooking(agendamento)}
                                className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border bg-green-50 text-green-700 border-green-300 hover:bg-green-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
                                title={t(
                                  "painel.comercial.agendamentos.transporte.button"
                                )}
                              >
                                Registrado
                              </button>
                            ) : (
                              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-300">
                                Pendente
                              </span>
                            )}
                            {agendamento && !transporteRegistrado ? (
                              <button
                                type="button"
                                onClick={() => setTransporteBooking(agendamento)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-amber-700 hover:bg-amber-100 hover:text-amber-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                                title={t(
                                  "painel.comercial.agendamentos.transporte.button"
                                )}
                                aria-label={t(
                                  "painel.comercial.agendamentos.transporte.button"
                                )}
                              >
                                <Truck className="w-3.5 h-3.5" />
                              </button>
                            ) : null}
                          </span>
                        </td>
                      </>
                    )}
                    <td className="px-5 py-3">
                      {cancelada ? (
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border bg-slate-100 text-slate-600 border-slate-300">
                          Cancelado
                        </span>
                      ) : isExpedicao ? (
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
                      <div className="flex items-center gap-1">
                        <RowActionButton
                          onClick={() => {
                            setViewSaida(s);
                            if (trackNewFromPainel && isNew(s.id)) {
                              markAsRead(s.id);
                            }
                          }}
                          title="Visualizar"
                        >
                          <Eye />
                        </RowActionButton>
                        {!cancelada &&
                        !(isExpedicao && expedicaoStatus === "expedido") ? (
                          <RowActionButton
                            onClick={() => navigate(`${basePath}/editar/${s.id}`)}
                            title="Editar"
                          >
                            <Pencil />
                          </RowActionButton>
                        ) : null}
                        {(!isModuloOperacional ||
                          canExcluirSaidaNoModuloOperacional(s)) &&
                        !(isExpedicao && expedicaoStatus === "expedido") ? (
                          <RowActionButton
                            tone="danger"
                            onClick={() => setDeleteId(s.id)}
                            title={
                              cancelada
                                ? "Excluir definitivamente"
                                : "Cancelar ou excluir"
                            }
                          >
                            <Trash2 />
                          </RowActionButton>
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

        <ServerPaginationBar
          page={page}
          pageSize={DEFAULT_PAGE_SIZE}
          total={filtered.length}
          onPageChange={setPage}
          disabled={loading}
          className="px-5 border-t border-border shrink-0 bg-card"
          meta={
            <>
              <span>
                Itens filtrados:{" "}
                <span className="font-medium text-foreground">
                  {filtered.length}
                </span>
              </span>
              <span>
                Quantidade total:{" "}
                <span className="font-medium text-foreground">
                  {formatMass(
                    filtered.reduce(
                      (sum, s) => sum + quantidadeTotalSaida(s),
                      0
                    )
                  )}{" "}
                  kg
                </span>
              </span>
            </>
          }
        />
      </div>

      {/* View Modal */}
      <SaidaViewDialog
        open={!!viewSaida}
        onClose={() => setViewSaida(null)}
        saida={viewSaida}
        vasilhames={vasilhames}
        transbordos={transbordos}
        entradas={entradas}
        showRelatorioFiscal={!isExpedicao}
        showChecklistColumn={isExpedicao}
        showValidadeLacreColumns={isExpedicao}
        checklistItems={
          isExpedicao
            ? checklistItemsFromBooking(
                findAgendamentoDisplayBySaida(agendamentos, viewSaida?.id),
                viewSaida?.id
              )
            : null
        }
        agendamento={
          isExpedicao
            ? findAgendamentoDisplayBySaida(agendamentos, viewSaida?.id)
            : null
        }
        highlightModule={isModuloOperacional ? operationalModule : null}
        onSaidaChange={(updated) => {
          if (!updated?.id) return;
          setViewSaida(updated);
          setSaidas((prev) =>
            prev.map((row) =>
              row.id === updated.id ? { ...row, ...updated } : row
            )
          );
          // Atualiza estoque/vasilhames após desvalidação individual.
          loadData({ silent: true });
        }}
      />

      {isExpedicao ? (
        <AgendamentoTransporteModal
          open={!!transporteBooking}
          onClose={() => setTransporteBooking(null)}
          booking={transporteBooking}
          permissionPrefix="painel_comercial_saida"
          onSave={handleSaveTransporte}
        />
      ) : null}

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
                {fiscalConfirm?.somenteGenerico
                  ? fiscalConfirm?.enviar
                    ? "Confirma a validação deste carregamento genérico? Nenhum saldo será baixado e nenhum item será registrado como saída."
                    : "A validação será removida. Nenhum saldo é alterado, porque este carregamento não está cadastrado no sistema."
                  : fiscalConfirm?.enviar
                  ? fiscalConfirm?.somentePendentes
                    ? "Há itens novos nesta saída. A baixa de estoque será feita só nos itens cadastrados. Carregamento genérico é validado sem baixa nem registro de saída. Os itens que já foram validados permanecem com o check de histórico."
                    : "Confirma a validação desta saída? Itens cadastrados seguem a baixa atual. Carregamento genérico é validado sem baixa nem registro de saída."
                  : isSaidaModuloPainel(fiscalConfirm?.saida)
                    ? "Os saldos dos produtos deste módulo retornarão para o estoque. Carregamento genérico não altera saldo. O histórico de validação é preservado. Itens de outros módulos não são alterados."
                    : "Tem certeza que deseja mudar o status dessa saída para Pendente? Os saldos dos produtos cadastrados retornarão ao estoque. Carregamento genérico não altera saldo. O histórico de validação é preservado."}
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

      <SaidaRemoverModal
        open={!!deleteId}
        saida={deleteTarget}
        busy={submitBusy}
        onClose={() => setDeleteId(null)}
        onCancelarCarregamento={handleCancelarCarregamento}
        onExcluirDefinitivamente={handleDelete}
      />
    </div>
  );
}