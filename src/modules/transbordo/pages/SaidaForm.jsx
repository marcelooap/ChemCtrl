import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { entities } from "@transbordo/services/entities";
import { base44 } from "@industrializacao/api/base44Client";
import { useInternalAuth as useAuth } from "@/lib/InternalAuthContext";
import { ArrowLeft, Calendar, Plus, Save } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import { Label } from "@shared/components/ui/label";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import DateInputBr from "@transbordo/components/cadastro/DateInputBr";
import SaidaItemRow from "@transbordo/components/saida/SaidaItemRow";
import SaidaDestinoSelect from "@transbordo/components/saida/SaidaDestinoSelect";
import { normalizeDestino } from "@transbordo/lib/saidaDestinos";
import { formatMass, formatVolume } from "@transbordo/lib/format";
import { todayDateInputValue } from "@/i18n/formatters";
import { resyncTransbordoStockAfterSaidaEdit } from "@transbordo/lib/saidaFiscal";
import { clearSaidaLeituras } from "@transbordo/lib/saidaNovas";
import { allocateSaidaCodigo } from "@transbordo/lib/allocateBusinessCodes";
import { buildReservaChave } from "@painel/lib/materialReservas";
import {
  rpcSalvarSaidaComReserva,
  validarItensEmbalado,
} from "@painel/lib/saidaReservas";
import { promoverProdutosPorIds } from "@transbordo/lib/cadastroProdutosCentral";
import { listTankas } from "@transbordo/lib/cadastroTankaCentral";
import { rescheduleSaidaAgendamento, ENCAIXE_HORARIO } from "@painel/lib/agendamentosCarregamento";
import AgendamentoPosSaidaModal from "@painel/components/comercial/AgendamentoPosSaidaModal";
import {
  ORIGEM_TRANSBORDO,
  ORIGEM_INDUSTRIALIZACAO,
  MODULO_SAIDA_CHEMFLOW,
  TIPO_EMBALADO,
  TIPO_CONVENCIONAL,
  TIPO_IND_VASILHAME,
  TIPO_IND_RETORNO_MP,
  emptySaidaItem,
  isItemSaidaVazio,
  isTanqueVazioItem,
  tanqueVazioTemIdentificacao,
  newSaidaItemUid,
  resolveItemOrigem,
  itemFoiBaixado,
  saidaItemChave,
  isSaidaValidadaNoModulo,
  isSaidaModuloPainel,
} from "@transbordo/lib/saidaOrigem";
import { useSubmitGuard } from "@/shared/hooks/useSubmitGuard";
import {
  buildSaidaClienteOptions,
  uniqueClientesByNome,
} from "@painel/lib/recebimentoCatalog";
import {
  listNomesClientesIndustrializacao,
  persistClienteSelecionado,
} from "@painel/lib/saidaClientes";

/** Data local de hoje em yyyy-mm-dd (evita deslocamento UTC). */
const todayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const DEFAULT_BASE_PATH = "/chemflow/saida";

/**
 * Formulário de criação/edição de saída.
 * `basePath` permite reutilizar a mesma UI no Painel / Industrialização.
 * `enableMultiOrigem` habilita seleção Industrialização + Transbordo por item.
 * `lockedOrigem` força um módulo (esconde seletor) e carrega as fontes correspondentes.
 * `moduloOrigem` grava em `t_saidas.modulo_origem` (chemflow | painel | industrializacao).
 * `onCreateSuccess` (opcional) é chamado após criar uma nova saída, em vez de navegar.
 * `enableAgendamentoEdit` mostra o botão Agendamento na edição (Painel Comercial).
 */
export default function SaidaForm({
  basePath = DEFAULT_BASE_PATH,
  enableMultiOrigem = false,
  lockedOrigem = null,
  moduloOrigem = MODULO_SAIDA_CHEMFLOW,
  onCreateSuccess = null,
  enableAgendamentoEdit = false,
} = {}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isEdit = !!id;
  const defaultOrigem = lockedOrigem || ORIGEM_TRANSBORDO;
  const loadIndData =
    enableMultiOrigem || lockedOrigem === ORIGEM_INDUSTRIALIZACAO;
  const showOrigemSelector = enableMultiOrigem && !lockedOrigem;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { busy: submitBusy, run: runSubmit } = useSubmitGuard();
  const [entradas, setEntradas] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [containersInd, setContainersInd] = useState([]);
  const [stocksInd, setStocksInd] = useState([]);
  const [movementsInd, setMovementsInd] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [saidas, setSaidas] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [editingSaida, setEditingSaida] = useState(null);
  const [agendamentoOpen, setAgendamentoOpen] = useState(false);
  const [agendamentoPendente, setAgendamentoPendente] = useState(null);
  const [collapsedByIndex, setCollapsedByIndex] = useState({});
  const [formData, setFormData] = useState({
    cliente_id: "",
    cliente_nome: "",
    destino: "",
    data_solicitacao: todayStr(),
    data_programada: "",
    observacoes: "",
    itens: [emptySaidaItem(defaultOrigem)],
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [ents, vascs, cliens, saics, reservasList] = await Promise.all([
          entities.estoque.list(),
          entities.vasilhames.list(),
          entities.clientes.list(),
          entities.saidas.list("-created_date"),
          entities.materialReservas.list("-created_at").catch(() => []),
        ]);

        setEntradas(ents);
        setVasilhames(vascs);
        setSaidas(saics);
        setReservas(reservasList || []);
        setClientes(uniqueClientesByNome(cliens));

        if (loadIndData) {
          try {
            const [containers, stocks, movements] = await Promise.all([
              base44.entities.Container.list("-created_date", 2000),
              base44.entities.RawMaterialStock.list("-created_date", 1000),
              base44.entities.StockMovement.list("-movement_date", 1000),
            ]);
            setContainersInd(Array.isArray(containers) ? containers : []);
            setStocksInd(Array.isArray(stocks) ? stocks : []);
            setMovementsInd(Array.isArray(movements) ? movements : []);
          } catch {
            setContainersInd([]);
            setStocksInd([]);
            setMovementsInd([]);
            setError(
              "Dados da Industrialização não carregaram. Recarregue a página ou verifique a conexão."
            );
          }

          try {
            const [nomesInd, produtos, tankas] = await Promise.all([
              listNomesClientesIndustrializacao(),
              entities.produtos
                .list("produto", { select: "cliente_nome" })
                .catch(() => []),
              listTankas({ select: "id, cliente_nome" }).catch(() => []),
            ]);
            setClientes(
              buildSaidaClienteOptions(cliens, [
                ...(nomesInd || []),
                ...(produtos || []).map((p) => p.cliente_nome),
                ...(tankas || []).map((t) => t.cliente_nome),
                ...(ents || []).map((e) => e.cliente_nome),
                ...(vascs || []).map((v) => v.cliente_nome),
              ])
            );
          } catch (err) {
            console.error("[SaidaForm] Falha ao unir clientes:", err);
          }
        }

        if (id) {
          const saida = await entities.saidas.get(id);
          setEditingSaida(saida);
          const itens =
            (saida.itens || []).length > 0
              ? saida.itens.map((it) => ({
                  ...emptySaidaItem(resolveItemOrigem(it)),
                  ...it,
                  origem: resolveItemOrigem(it),
                  item_uid: String(it.item_uid || "").trim() || newSaidaItemUid(),
                  tanque_vazio: Boolean(it.tanque_vazio),
                }))
              : [emptySaidaItem(defaultOrigem)];
          setFormData({
            cliente_id: saida.cliente_id || "",
            cliente_nome: saida.cliente_nome || "",
            destino: normalizeDestino(saida.destino),
            data_solicitacao: saida.data_solicitacao || todayStr(),
            data_programada: saida.data_programada || "",
            observacoes: saida.observacoes || "",
            itens,
          });
          // Em edição, itens iniciam colapsados (resumo reduzido).
          const collapsed = {};
          itens.forEach((_, i) => {
            collapsed[i] = true;
          });
          setCollapsedByIndex(collapsed);
        }
      } catch {
        setError("Erro ao carregar dados.");
      }
      setLoading(false);
    };
    load();
  }, [id, loadIndData, defaultOrigem]);

  const sameId = (a, b) => Boolean(a) && Boolean(b) && String(a) === String(b);

  // Volume/saldo já baixado nesta saída volta para a conta, senão o tanque
  // expedido (saldo 0) impede salvar a inclusão de outro item.
  const creditoBaixado = (match, field) => {
    if (!editingSaida) return 0;
    let total = 0;
    for (const item of editingSaida.itens || []) {
      if (!match(item) || !itemFoiBaixado(item, editingSaida)) continue;
      total += Number(item[field]) || 0;
    }
    return total;
  };

  // Só devolve o volume baixado quando o saldo físico já foi reduzido.
  // Tanque ainda cheio (validação que não zerou o cadastro) não é somado de novo.
  const aplicarCredito = (saldo, credito) =>
    credito > 0 && saldo + 1e-6 < credito ? saldo + credito : saldo;

  const getAvailableSaldo = (entradaId, currentIndex) => {
    const entrada = entradas.find((e) => sameId(e.id, entradaId));
    let saldo = Number(entrada?.saldo_atual) || 0;
    saldo = aplicarCredito(saldo, creditoBaixado(
      (item) =>
        (item.tipo === TIPO_EMBALADO || item.tipo === "embalado") &&
        sameId(item.entrada_id, entradaId),
      "quantidade_solicitada"
    ));
    formData.itens.forEach((item, i) => {
      if (
        i !== currentIndex &&
        item.tipo === TIPO_EMBALADO &&
        sameId(item.entrada_id, entradaId)
      ) {
        saldo -= item.quantidade_solicitada || 0;
      }
    });
    return saldo;
  };

  const getAvailableVolume = (vasilhameId, currentIndex) => {
    const v = vasilhames.find((x) => sameId(x.id, vasilhameId));
    let vol = Number(v?.volume) || 0;
    vol = aplicarCredito(vol, creditoBaixado(
      (item) =>
        (item.tipo === TIPO_CONVENCIONAL || item.tipo === "convencional") &&
        sameId(item.vasilhame_id, vasilhameId),
      "volume_solicitado"
    ));
    formData.itens.forEach((item, i) => {
      if (
        i !== currentIndex &&
        item.tipo === TIPO_CONVENCIONAL &&
        sameId(item.vasilhame_id, vasilhameId)
      ) {
        vol -= item.volume_solicitado || 0;
      }
    });
    return vol;
  };

  const getAvailableContainerVolume = (containerId, currentIndex) => {
    const c = containersInd.find((x) => sameId(x.id, containerId));
    let vol = Number(c?.volume) || 0;
    vol = aplicarCredito(vol, creditoBaixado(
      (item) =>
        item.tipo === TIPO_IND_VASILHAME && sameId(item.container_id, containerId),
      "volume_solicitado"
    ));
    formData.itens.forEach((item, i) => {
      if (
        i !== currentIndex &&
        item.tipo === TIPO_IND_VASILHAME &&
        sameId(item.container_id, containerId)
      ) {
        vol -= item.volume_solicitado || 0;
      }
    });
    return vol;
  };

  const getAvailableStockSaldo = (stockId, currentIndex) => {
    const s = stocksInd.find((x) => sameId(x.id, stockId));
    let saldo = Number(s?.current_stock) || 0;
    saldo = aplicarCredito(saldo, creditoBaixado(
      (item) =>
        item.tipo === TIPO_IND_RETORNO_MP &&
        sameId(item.stock_id, stockId) &&
        !item.movement_id,
      "quantidade_solicitada"
    ));
    formData.itens.forEach((item, i) => {
      if (
        i !== currentIndex &&
        item.tipo === TIPO_IND_RETORNO_MP &&
        sameId(item.stock_id, stockId) &&
        !item.movement_id
      ) {
        saldo -= item.quantidade_solicitada || 0;
      }
    });
    return saldo;
  };

  const originalPorChave = () => {
    const map = new Map();
    for (const item of editingSaida?.itens || []) {
      const chave = saidaItemChave(item);
      if (chave && !map.has(chave)) map.set(chave, item);
    }
    return map;
  };

  const itemTravado = (item) => {
    if (!editingSaida) return false;
    const original = originalPorChave().get(saidaItemChave(item));
    return Boolean(original && itemFoiBaixado(original, editingSaida));
  };

  const updateItem = (index, updated) => {
    setFormData((prev) => ({
      ...prev,
      itens: prev.itens.map((it, i) => (i === index ? updated : it)),
    }));
  };

  const addItem = () => {
    const prevLen = formData.itens.length;
    const map = {};
    for (let i = 0; i < prevLen; i++) map[i] = true;
    map[prevLen] = false;
    setCollapsedByIndex(map);
    setFormData((prev) => ({
      ...prev,
      itens: [...prev.itens, emptySaidaItem(defaultOrigem)],
    }));
  };

  const removeItem = (index) => {
    if (itemTravado(formData.itens[index])) return;
    setFormData((prev) => ({
      ...prev,
      itens: prev.itens.filter((_, i) => i !== index),
    }));
    setCollapsedByIndex((prev) => {
      const entries = Object.entries(prev)
        .map(([k, v]) => [Number(k), v])
        .filter(([k]) => k !== index)
        .map(([k, v]) => [k > index ? k - 1 : k, v]);
      return Object.fromEntries(entries);
    });
  };

  const generateCodigo = async () => allocateSaidaCodigo(saidas);

  const handleSave = () => runSubmit(async () => {
    setError("");

    if (!formData.cliente_id) {
      setError("Selecione um cliente.");
      return;
    }
    if (!formData.data_solicitacao?.trim()) {
      setError("Informe a data da solicitação.");
      return;
    }
    if (!formData.data_programada?.trim()) {
      setError("Informe a data programada.");
      return;
    }
    // Saída pendente (ainda sem baixa) pode ser salva sem produtos: o horário é
    // reservado agora e os tanques/produtos entram depois, via edição.
    // Saída já validada exige produtos, pois o estoque já foi baixado.
    const itensPreenchidos = formData.itens.filter((it) => !isItemSaidaVazio(it));
    if (editingSaida) {
      const chavesAtuais = new Set(
        itensPreenchidos.map((item) => saidaItemChave(item)).filter(Boolean)
      );
      const removeuValidado = (editingSaida.itens || []).some((item) => {
        const chave = saidaItemChave(item);
        return chave && itemFoiBaixado(item, editingSaida) && !chavesAtuais.has(chave);
      });
      if (removeuValidado) {
        setError(
          "Não é possível remover um item já validado. Reverta a validação para Pendente na tela de Saída do módulo que validou o item."
        );
        return;
      }
    }
    if (editingSaida?.enviado_ao_fiscal && itensPreenchidos.length === 0) {
      setError("Adicione pelo menos um produto.");
      return;
    }

    for (let i = 0; i < formData.itens.length; i++) {
      const item = formData.itens[i];
      if (isItemSaidaVazio(item)) continue;

      if (isTanqueVazioItem(item)) {
        if (!tanqueVazioTemIdentificacao(item)) {
          setError(
            "Informe o número da placa ou o número do barril para identificar o tanque vazio."
          );
          return;
        }
        continue;
      }

      const origem = resolveItemOrigem(item);

      if (showOrigemSelector && !origem) {
        setError(`Produto ${i + 1}: selecione o módulo (Industrialização ou Transbordo).`);
        return;
      }

      if (item.tipo === TIPO_EMBALADO) {
        if (!item.entrada_id) {
          setError(`Produto ${i + 1}: selecione um produto e lote.`);
          return;
        }
        if (!item.quantidade_solicitada || item.quantidade_solicitada <= 0) {
          setError(`Produto ${i + 1}: informe a quantidade solicitada.`);
          return;
        }
        const available = getAvailableSaldo(item.entrada_id, i);
        if (item.quantidade_solicitada > available) {
          const um =
            entradas.find((e) => e.id === item.entrada_id)?.unidade_medida ||
            item.unidade ||
            "kg";
          const fmt =
            String(um).toLowerCase() === "l" ||
            String(um).toLowerCase() === "lt" ||
            String(um).toLowerCase() === "litro" ||
            String(um).toLowerCase() === "litros"
              ? formatVolume
              : formatMass;
          setError(
            `Produto ${i + 1}: quantidade solicitada maior que o saldo disponível (${fmt(available)} ${um}).`
          );
          return;
        }
      } else if (item.tipo === TIPO_CONVENCIONAL) {
        if (!item.produto_id && !item.produto_nome) {
          setError(`Produto ${i + 1}: selecione o produto.`);
          return;
        }
        if (!item.vasilhame_id) {
          setError(
            showOrigemSelector
              ? `Produto ${i + 1}: selecione a embalagem.`
              : `Produto ${i + 1}: selecione um vasilhame.`
          );
          return;
        }
        if (!item.volume_solicitado || item.volume_solicitado <= 0) {
          setError(`Produto ${i + 1}: informe o volume solicitado.`);
          return;
        }
        const available = getAvailableVolume(item.vasilhame_id, i);
        if (item.volume_solicitado > available) {
          setError(
            `Produto ${i + 1}: volume solicitado maior que o disponível (${formatVolume(available)} L).`
          );
          return;
        }
      } else if (item.tipo === TIPO_IND_VASILHAME) {
        if (!item.container_id) {
          setError(
            showOrigemSelector
              ? `Produto ${i + 1}: selecione a embalagem.`
              : `Produto ${i + 1}: selecione um vasilhame da Industrialização.`
          );
          return;
        }
        if (!item.volume_solicitado || item.volume_solicitado <= 0) {
          setError(`Produto ${i + 1}: informe o volume solicitado.`);
          return;
        }
        const available = getAvailableContainerVolume(item.container_id, i);
        if (item.volume_solicitado > available) {
          setError(
            `Produto ${i + 1}: volume solicitado maior que o disponível (${formatVolume(available)} L).`
          );
          return;
        }
      } else if (item.tipo === TIPO_IND_RETORNO_MP) {
        if (!item.stock_id && !item.movement_id) {
          setError(
            `Produto ${i + 1}: selecione um retorno de MP não aplicada.`
          );
          return;
        }
        if (!item.quantidade_solicitada || item.quantidade_solicitada <= 0) {
          setError(`Produto ${i + 1}: informe a quantidade solicitada.`);
          return;
        }
        if (item.stock_id && !item.movement_id) {
          const available = getAvailableStockSaldo(item.stock_id, i);
          if (item.quantidade_solicitada > available) {
            setError(
              `Produto ${i + 1}: quantidade maior que o saldo disponível (${formatMass(available)} ${item.unidade || "kg"}).`
            );
            return;
          }
        }
      } else {
        setError(`Produto ${i + 1}: tipo inválido.`);
        return;
      }
    }

    setSaving(true);

    try {
      const clientePersistido = await persistClienteSelecionado(
        formData.cliente_id,
        formData.cliente_nome
      );
      if (!clientePersistido.id) {
        setError("Selecione um cliente.");
        setSaving(false);
        return;
      }
      const clienteIdSalvo = clientePersistido.id;
      const clienteNomeSalvo = clientePersistido.nome || formData.cliente_nome;

      const entradaSaldos = {};
      entradas.forEach((e) => {
        entradaSaldos[e.id] = e.saldo_atual || 0;
      });
      const vasilhameVolumes = {};
      const vasilhameOriginal = {};
      vasilhames.forEach((v) => {
        vasilhameVolumes[v.id] = v.volume || 0;
        vasilhameOriginal[v.id] = v;
      });
      const containerVolumes = {};
      const containerOriginal = {};
      containersInd.forEach((c) => {
        containerVolumes[c.id] = c.volume || 0;
        containerOriginal[c.id] = c;
      });
      const stockSaldos = {};
      stocksInd.forEach((s) => {
        stockSaldos[s.id] = s.current_stock || 0;
      });

      const affectedContainers = new Set();
      const affectedStocks = new Set();

      const isFiscal = editingSaida?.enviado_ao_fiscal;
      const origemPorChave = originalPorChave();
      const jaBaixadoOriginal = (item) => {
        const original = origemPorChave.get(saidaItemChave(item));
        return Boolean(original && itemFoiBaixado(original, editingSaida));
      };

      if (isFiscal) {
        (editingSaida.itens || []).forEach((item) => {
          if (!itemFoiBaixado(item, editingSaida)) return;
          if (item.tipo === TIPO_EMBALADO && item.entrada_id) {
            entradaSaldos[item.entrada_id] =
              (entradaSaldos[item.entrada_id] || 0) +
              (item.quantidade_solicitada || 0);
          } else if (item.tipo === TIPO_CONVENCIONAL && item.vasilhame_id) {
            vasilhameVolumes[item.vasilhame_id] =
              (vasilhameVolumes[item.vasilhame_id] || 0) +
              (item.volume_solicitado || 0);
          } else if (item.tipo === TIPO_IND_VASILHAME && item.container_id) {
            containerVolumes[item.container_id] =
              (containerVolumes[item.container_id] || 0) +
              (item.volume_solicitado || 0);
            affectedContainers.add(item.container_id);
          } else if (
            item.tipo === TIPO_IND_RETORNO_MP &&
            item.stock_id &&
            !item.movement_id
          ) {
            stockSaldos[item.stock_id] =
              (stockSaldos[item.stock_id] || 0) +
              (item.quantidade_solicitada || 0);
            affectedStocks.add(item.stock_id);
          }
        });
      }

      const itensWithStock = itensPreenchidos.map((item) => {
        if (isTanqueVazioItem(item)) {
          return {
            ...emptySaidaItem(resolveItemOrigem(item) || defaultOrigem),
            item_uid: String(item.item_uid || "").trim() || newSaidaItemUid(),
            tanque_vazio: true,
            origem: resolveItemOrigem(item) || defaultOrigem || ORIGEM_TRANSBORDO,
            tipo: TIPO_CONVENCIONAL,
            vasilhame_placa: String(item.vasilhame_placa || "").trim(),
            vasilhame_barril: String(item.vasilhame_barril || "").trim(),
            produto_id: "",
            produto_nome: "",
            produto_codigo: "",
            quantidade_solicitada: 0,
            volume_solicitado: 0,
            peso_liquido: 0,
            peso_bruto: 0,
            vasilhame_id: "",
            container_id: "",
            entrada_id: "",
            stock_id: "",
            movement_id: "",
            reserva_id: null,
            sem_reserva: true,
            reserva_solicitante: null,
            reserva_chave: null,
            validado: item.validado,
          };
        }

        if (item.tipo === TIPO_EMBALADO) {
          const estoqueAntes = entradaSaldos[item.entrada_id] || 0;
          const qtd = item.quantidade_solicitada || 0;
          if (isFiscal && jaBaixadoOriginal(item)) {
            entradaSaldos[item.entrada_id] = estoqueAntes - qtd;
          }
          const unidade =
            entradas.find((e) => e.id === item.entrada_id)?.unidade_medida ||
            item.unidade ||
            "kg";
          return {
            ...item,
            origem: ORIGEM_TRANSBORDO,
            unidade,
            sem_reserva: !item.reserva_id,
            reserva_id: item.reserva_id || null,
            reserva_solicitante: item.reserva_id ? item.reserva_solicitante || null : null,
            reserva_chave: buildReservaChave({
              clienteId: clienteIdSalvo,
              clienteNome: clienteNomeSalvo,
              produtoCodigo: item.produto_codigo,
              lote: item.lote,
              unidade,
            }),
            estoque_atual: estoqueAntes,
            estoque_final: estoqueAntes - qtd,
          };
        }

        if (item.tipo === TIPO_CONVENCIONAL) {
          const volAntes = vasilhameVolumes[item.vasilhame_id] || 0;
          const vol = item.volume_solicitado || 0;
          if (isFiscal && jaBaixadoOriginal(item)) {
            vasilhameVolumes[item.vasilhame_id] = volAntes - vol;
          }

          const v = vasilhameOriginal[item.vasilhame_id];
          const originalVol = v?.volume || 0;
          const originalPesoLiq = v?.peso_liquido || 0;
          const densidade = originalVol > 0 ? originalPesoLiq / originalVol : 0;
          const pesoSolicitado = vol * densidade;

          return {
            ...item,
            origem: ORIGEM_TRANSBORDO,
            volume_disponivel: volAntes,
            saldo_final: volAntes - vol,
            quantidade_solicitada: pesoSolicitado,
          };
        }

        if (item.tipo === TIPO_IND_VASILHAME) {
          const volAntes = containerVolumes[item.container_id] || 0;
          const vol = item.volume_solicitado || 0;
          if (isFiscal && jaBaixadoOriginal(item)) {
            containerVolumes[item.container_id] = volAntes - vol;
            affectedContainers.add(item.container_id);
          }
          const c = containerOriginal[item.container_id];
          const dens =
            parseFloat(String(c?.density || "0").replace(",", ".")) || 0;
          const pesoSolicitado =
            item.peso_liquido ||
            (dens > 0 ? vol * dens : item.quantidade_solicitada || 0);

          return {
            ...item,
            origem: ORIGEM_INDUSTRIALIZACAO,
            volume_disponivel: volAntes,
            saldo_final: volAntes - vol,
            quantidade_solicitada: pesoSolicitado,
            peso_liquido: pesoSolicitado,
          };
        }

        // ind_retorno_mp
        if (item.movement_id) {
          return {
            ...item,
            origem: ORIGEM_INDUSTRIALIZACAO,
            estoque_atual: item.quantidade_solicitada || 0,
            estoque_final: 0,
          };
        }

        const estoqueAntes = stockSaldos[item.stock_id] || 0;
        const qtd = item.quantidade_solicitada || 0;
        if (isFiscal && jaBaixadoOriginal(item)) {
          stockSaldos[item.stock_id] = estoqueAntes - qtd;
          affectedStocks.add(item.stock_id);
        }
        return {
          ...item,
          origem: ORIGEM_INDUSTRIALIZACAO,
          estoque_atual: estoqueAntes,
          estoque_final: estoqueAntes - qtd,
        };
      });

      const itensPersistidos = itensWithStock.map((item) => {
        if (jaBaixadoOriginal(item)) return { ...item, validado: true };
        const original = origemPorChave.get(saidaItemChave(item));
        if (original?.validado === false) return { ...item, validado: false };
        if (!original && editingSaida) {
          const modulo = resolveItemOrigem(item);
          if (
            isSaidaValidadaNoModulo(editingSaida, modulo) ||
            editingSaida.enviado_ao_fiscal
          ) {
            return { ...item, validado: false };
          }
        }
        return item;
      });

      const quantidadeTotal = itensPersistidos.reduce(
        (sum, item) => sum + (item.quantidade_solicitada || 0),
        0
      );

      const codigo = editingSaida?.codigo || (await generateCodigo());

      const data = {
        cliente_id: clienteIdSalvo,
        cliente_nome: clienteNomeSalvo,
        destino: normalizeDestino(formData.destino) || null,
        data_solicitacao: formData.data_solicitacao,
        data_programada: agendamentoPendente?.dateIso || formData.data_programada,
        observacoes: formData.observacoes,
        itens: itensPersistidos,
        quantidade_total: quantidadeTotal,
        usuario_criador: editingSaida?.usuario_criador || user?.nome || "",
        usuario_responsavel: user?.nome || "",
        codigo,
        modulo_origem: editingSaida?.modulo_origem || moduloOrigem || MODULO_SAIDA_CHEMFLOW,
      };

      validarItensEmbalado({
        itens: itensPersistidos,
        reservas,
        saidas,
        entradas,
        clienteId: clienteIdSalvo,
        clienteNome: clienteNomeSalvo,
        excludeSaidaId: editingSaida?.id || null,
        buildChave: buildReservaChave,
      });

      let createdSaida = null;
      const salvo = await rpcSalvarSaidaComReserva({
        p_id: editingSaida?.id || null,
        p_data: data,
      });
      if (!salvo.missing && salvo.data) {
        createdSaida = salvo.data;
      } else if (itensPersistidos.some((item) => item.tipo === TIPO_EMBALADO)) {
        throw new Error(
          "Execute o script 035_t_saida_reserva_saldo.sql no SQL Editor do ChemFlow para gravar a saída com controle de reserva."
        );
      } else if (editingSaida) {
        await entities.saidas.update(editingSaida.id, data);
      } else {
        createdSaida = await entities.saidas.create({
          ...data,
          status: "aguardando",
          enviado_ao_fiscal: false,
        });
      }

      // Itens JSON não têm trigger de produto_id — promove origem se necessário.
      await promoverProdutosPorIds(
        itensPersistidos.map((item) => item.produto_id).filter(Boolean)
      ).catch(() => 0);

      if (isFiscal) {
        // Transbordo: devolve/reaplica saldo de itens removidos/alterados e recalcula estoque.
        // Industrialização permanece no bloco abaixo (sem alteração de comportamento).
        await resyncTransbordoStockAfterSaidaEdit(
          editingSaida,
          itensPersistidos.filter((item) => item.validado !== false),
          {
            estoque: entradas,
            vasilhames,
            dataSaida:
              editingSaida?.data_programada || todayDateInputValue() || null,
          }
        );

        for (const cid of affectedContainers) {
          const c = containerOriginal[cid];
          const newVol = Math.max(0, containerVolumes[cid] || 0);
          const dens =
            parseFloat(String(c?.density || "0").replace(",", ".")) || 0;
          const newNet = dens > 0 ? newVol * dens : Math.max(0, (c?.net_weight || 0));
          const stillInSaida = formData.itens.some(
            (i) => i.tipo === TIPO_IND_VASILHAME && i.container_id === cid
          );
          await base44.entities.Container.update(cid, {
            volume: newVol,
            net_weight: newNet,
            gross_weight: (c?.tare || 0) + newNet,
            status: stillInSaida && newVol <= 0 ? "Expedido" : "No Pátio",
            departure_date:
              stillInSaida && newVol <= 0 ? todayDateInputValue() : null,
          });
        }

        for (const sid of affectedStocks) {
          await base44.entities.RawMaterialStock.update(sid, {
            current_stock: Math.max(0, stockSaldos[sid] || 0),
          });
        }
      }

      if (editingSaida?.id && isSaidaModuloPainel(editingSaida)) {
        const modulosNovos = new Set();
        for (const item of itensPersistidos) {
          const chave = saidaItemChave(item);
          if (!chave || origemPorChave.has(chave)) continue;
          modulosNovos.add(resolveItemOrigem(item));
        }
        for (const modulo of modulosNovos) {
          try {
            await clearSaidaLeituras(editingSaida.id, modulo);
          } catch (err) {
            console.error("[SaidaForm] Falha ao reabrir notificação da saída:", err);
          }
        }
      }

      if (!editingSaida && typeof onCreateSuccess === "function" && createdSaida?.id) {
        onCreateSuccess(createdSaida);
        setSaving(false);
        return;
      }

      if (isEdit && agendamentoPendente && editingSaida?.id) {
        await rescheduleSaidaAgendamento({
          saida: {
            id: editingSaida.id,
            codigo: editingSaida.codigo,
            cliente_id: clienteIdSalvo,
            cliente_nome: clienteNomeSalvo,
          },
          dateIso: agendamentoPendente.dateIso,
          horario: agendamentoPendente.horario,
          tipo: agendamentoPendente.tipo,
          user,
        });
      }

      navigate(basePath);
    } catch (err) {
      setError(err?.message || "Erro ao salvar saída. Tente novamente.");
    }
    setSaving(false);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-border border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(basePath)}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {isEdit ? "Editar Saída" : "Nova Saída"}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isEdit
                ? `Editando ${editingSaida?.codigo || ""}`
                : showOrigemSelector
                  ? "Selecione Industrialização e/ou Transbordo por produto"
                  : lockedOrigem === ORIGEM_INDUSTRIALIZACAO
                    ? "Cadastre uma saída com vasilhames ou retorno de MP"
                    : "Cadastre uma nova solicitação de saída"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button variant="outline" onClick={() => navigate(basePath)}>
            Cancelar
          </Button>
          {isEdit && enableAgendamentoEdit ? (
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => setAgendamentoOpen(true)}
            >
              <Calendar className="w-4 h-4" />
              Agendamento
            </Button>
          ) : null}
          <Button
            onClick={handleSave}
            disabled={saving || submitBusy || !formData.data_programada}
            className="bg-primary hover:bg-primary/90 gap-2"
            title={
              !formData.data_programada
                ? "Preencha a data programada para salvar"
                : undefined
            }
          >
            <Save className="w-4 h-4" />
            {saving || submitBusy ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <h2 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2 mb-4">
          Dados da Solicitação
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Cliente *</Label>
            <SearchableSelect
              value={formData.cliente_nome}
              onChange={(_label, option) => {
                if (!option) return;
                setFormData((prev) => {
                  const clienteChanged = prev.cliente_id !== option.id;
                  return {
                    ...prev,
                    cliente_id: option.id,
                    cliente_nome: option.nome,
                    itens: clienteChanged
                      ? prev.itens.map(() => emptySaidaItem(defaultOrigem))
                      : prev.itens,
                  };
                });
                setCollapsedByIndex((prevMap) => {
                  if (formData.cliente_id !== option.id) return {};
                  return prevMap;
                });
              }}
              options={clientes}
              getOptionLabel={(c) => c.nome}
              getOptionValue={(c) => c.id}
              placeholder="Selecione um cliente..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Destino</Label>
            <SaidaDestinoSelect
              value={formData.destino}
              onChange={(destino) =>
                setFormData((prev) => ({ ...prev, destino }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Data da Solicitação *</Label>
            <DateInputBr
              value={formData.data_solicitacao}
              disabled
              onChange={(iso) =>
                setFormData((prev) => ({
                  ...prev,
                  data_solicitacao: iso,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Data Programada *</Label>
            <DateInputBr
              value={formData.data_programada}
              onChange={(iso) => {
                setFormData((prev) => ({
                  ...prev,
                  data_programada: iso,
                }));
                setAgendamentoPendente((prev) =>
                  prev && prev.dateIso === iso ? prev : null
                );
              }}
            />
            {agendamentoPendente ? (
              <p className="text-xs text-emerald-700">
                Horário:{" "}
                {agendamentoPendente.horario === ENCAIXE_HORARIO
                  ? "Encaixe"
                  : agendamentoPendente.horario}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
            Produtos da Saída
          </h2>
          <Button
            onClick={addItem}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Adicionar Produto
          </Button>
        </div>
        {!editingSaida?.enviado_ao_fiscal &&
        formData.itens.every(isItemSaidaVazio) ? (
          <p
            role="note"
            className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          >
            Produtos são opcionais por enquanto: você pode salvar e reservar o
            horário agora e, quando o cliente informar os tanques, editar esta
            saída para adicioná-los.
          </p>
        ) : null}
        <div className="space-y-4">
          {formData.itens.map((item, index) => (
            <SaidaItemRow
              key={index}
              index={index}
              item={item}
              itens={formData.itens}
              entradas={entradas}
              vasilhames={vasilhames}
              reservas={reservas}
              saidas={saidas}
              saidaId={id || null}
              containersInd={containersInd}
              stocksInd={stocksInd}
              movementsInd={movementsInd}
              clienteId={formData.cliente_id}
              clienteNome={formData.cliente_nome}
              enableMultiOrigem={showOrigemSelector}
              lockedOrigem={lockedOrigem}
              onChange={(updated) => updateItem(index, updated)}
              onRemove={() => removeItem(index)}
              locked={itemTravado(item)}
              getAvailableSaldo={getAvailableSaldo}
              getAvailableVolume={getAvailableVolume}
              getAvailableContainerVolume={getAvailableContainerVolume}
              getAvailableStockSaldo={getAvailableStockSaldo}
              collapsed={!!collapsedByIndex[index]}
              onToggleCollapse={() =>
                setCollapsedByIndex((prev) => ({
                  ...prev,
                  [index]: !prev[index],
                }))
              }
            />
          ))}
        </div>
        {formData.itens.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            Nenhum produto adicionado. Clique em &quot;Adicionar Produto&quot;.
          </p>
        )}
      </div>
      {isEdit && enableAgendamentoEdit ? (
        <AgendamentoPosSaidaModal
          open={agendamentoOpen}
          deferBooking
          saida={{
            id: editingSaida?.id,
            codigo: editingSaida?.codigo,
            cliente_id: formData.cliente_id,
            cliente_nome: formData.cliente_nome,
            data_programada: formData.data_programada,
          }}
          onClose={() => setAgendamentoOpen(false)}
          onScheduled={(payload) => {
            if (!payload?.dateIso) return;
            setFormData((prev) => ({
              ...prev,
              data_programada: payload.dateIso,
            }));
            setAgendamentoPendente({
              dateIso: payload.dateIso,
              horario: payload.horario,
              tipo: payload.tipo,
            });
            setAgendamentoOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
