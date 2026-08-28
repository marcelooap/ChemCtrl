import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { entities } from "@transbordo/services/entities";
import { base44 } from "@industrializacao/api/base44Client";
import { useInternalAuth as useAuth } from "@/lib/InternalAuthContext";
import { ArrowLeft, Plus, Save } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import { Label } from "@shared/components/ui/label";
import { Textarea } from "@shared/components/ui/textarea";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import DateInputBr from "@transbordo/components/cadastro/DateInputBr";
import SaidaItemRow from "@transbordo/components/saida/SaidaItemRow";
import { formatMass, formatVolume } from "@transbordo/lib/format";
import { todayDateInputValue } from "@/i18n/formatters";
import { resyncTransbordoStockAfterSaidaEdit } from "@transbordo/lib/saidaFiscal";
import { allocateSaidaCodigo } from "@transbordo/lib/allocateBusinessCodes";
import {
  ORIGEM_TRANSBORDO,
  ORIGEM_INDUSTRIALIZACAO,
  MODULO_SAIDA_CHEMFLOW,
  TIPO_EMBALADO,
  TIPO_CONVENCIONAL,
  TIPO_IND_VASILHAME,
  TIPO_IND_RETORNO_MP,
  emptySaidaItem,
  resolveItemOrigem,
} from "@transbordo/lib/saidaOrigem";
import { useSubmitGuard } from "@/shared/hooks/useSubmitGuard";

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
 */
export default function SaidaForm({
  basePath = DEFAULT_BASE_PATH,
  enableMultiOrigem = false,
  lockedOrigem = null,
  moduloOrigem = MODULO_SAIDA_CHEMFLOW,
  onCreateSuccess = null,
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
  const [editingSaida, setEditingSaida] = useState(null);
  const [collapsedByIndex, setCollapsedByIndex] = useState({});
  const [formData, setFormData] = useState({
    cliente_id: "",
    cliente_nome: "",
    data_solicitacao: todayStr(),
    data_programada: "",
    observacoes: "",
    itens: [emptySaidaItem(defaultOrigem)],
  });

  useEffect(() => {
    const load = async () => {
      try {
        const core = Promise.all([
          entities.estoque.list(),
          entities.vasilhames.list(),
          entities.clientes.list(),
          entities.saidas.list("-created_date"),
        ]);

        const [ents, vascs, cliens, saics] = await core;

        setEntradas(ents);
        setVasilhames(vascs);
        setClientes(cliens);
        setSaidas(saics);

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
                }))
              : [emptySaidaItem(defaultOrigem)];
          setFormData({
            cliente_id: saida.cliente_id || "",
            cliente_nome: saida.cliente_nome || "",
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

  const getAvailableSaldo = (entradaId, currentIndex) => {
    const entrada = entradas.find((e) => e.id === entradaId);
    if (!entrada) return 0;
    let saldo = entrada.saldo_atual || 0;
    if (editingSaida?.enviado_ao_fiscal) {
      (editingSaida.itens || []).forEach((item) => {
        if (item.tipo === TIPO_EMBALADO && item.entrada_id === entradaId) {
          saldo += item.quantidade_solicitada || 0;
        }
      });
    }
    formData.itens.forEach((item, i) => {
      if (
        i !== currentIndex &&
        item.tipo === TIPO_EMBALADO &&
        item.entrada_id === entradaId
      ) {
        saldo -= item.quantidade_solicitada || 0;
      }
    });
    return saldo;
  };

  const getAvailableVolume = (vasilhameId, currentIndex) => {
    const v = vasilhames.find((x) => x.id === vasilhameId);
    if (!v) return 0;
    let vol = v.volume || 0;
    if (editingSaida?.enviado_ao_fiscal) {
      (editingSaida.itens || []).forEach((item) => {
        if (item.tipo === TIPO_CONVENCIONAL && item.vasilhame_id === vasilhameId) {
          vol += item.volume_solicitado || 0;
        }
      });
    }
    formData.itens.forEach((item, i) => {
      if (
        i !== currentIndex &&
        item.tipo === TIPO_CONVENCIONAL &&
        item.vasilhame_id === vasilhameId
      ) {
        vol -= item.volume_solicitado || 0;
      }
    });
    return vol;
  };

  const getAvailableContainerVolume = (containerId, currentIndex) => {
    const c = containersInd.find((x) => x.id === containerId);
    if (!c) return 0;
    let vol = c.volume || 0;
    if (editingSaida?.enviado_ao_fiscal) {
      (editingSaida.itens || []).forEach((item) => {
        if (item.tipo === TIPO_IND_VASILHAME && item.container_id === containerId) {
          vol += item.volume_solicitado || 0;
        }
      });
    }
    formData.itens.forEach((item, i) => {
      if (
        i !== currentIndex &&
        item.tipo === TIPO_IND_VASILHAME &&
        item.container_id === containerId
      ) {
        vol -= item.volume_solicitado || 0;
      }
    });
    return vol;
  };

  const getAvailableStockSaldo = (stockId, currentIndex) => {
    const s = stocksInd.find((x) => x.id === stockId);
    if (!s) return 0;
    let saldo = s.current_stock || 0;
    if (editingSaida?.enviado_ao_fiscal) {
      (editingSaida.itens || []).forEach((item) => {
        if (
          item.tipo === TIPO_IND_RETORNO_MP &&
          item.stock_id === stockId &&
          !item.movement_id
        ) {
          saldo += item.quantidade_solicitada || 0;
        }
      });
    }
    formData.itens.forEach((item, i) => {
      if (
        i !== currentIndex &&
        item.tipo === TIPO_IND_RETORNO_MP &&
        item.stock_id === stockId &&
        !item.movement_id
      ) {
        saldo -= item.quantidade_solicitada || 0;
      }
    });
    return saldo;
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
    if (formData.itens.length === 0) {
      setError("Adicione pelo menos um produto.");
      return;
    }

    for (let i = 0; i < formData.itens.length; i++) {
      const item = formData.itens[i];
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
        if (!item.vasilhame_id) {
          setError(`Produto ${i + 1}: selecione um vasilhame.`);
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
          setError(`Produto ${i + 1}: selecione um vasilhame da Industrialização.`);
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

      if (isFiscal) {
        (editingSaida.itens || []).forEach((item) => {
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

      const itensWithStock = formData.itens.map((item) => {
        const origem = resolveItemOrigem(item);

        if (item.tipo === TIPO_EMBALADO) {
          const estoqueAntes = entradaSaldos[item.entrada_id] || 0;
          const qtd = item.quantidade_solicitada || 0;
          if (isFiscal) {
            entradaSaldos[item.entrada_id] = estoqueAntes - qtd;
          }
          return {
            ...item,
            origem: ORIGEM_TRANSBORDO,
            unidade:
              entradas.find((e) => e.id === item.entrada_id)?.unidade_medida ||
              item.unidade ||
              "kg",
            estoque_atual: estoqueAntes,
            estoque_final: estoqueAntes - qtd,
          };
        }

        if (item.tipo === TIPO_CONVENCIONAL) {
          const volAntes = vasilhameVolumes[item.vasilhame_id] || 0;
          const vol = item.volume_solicitado || 0;
          if (isFiscal) {
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
          if (isFiscal) {
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
        if (isFiscal) {
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

      const quantidadeTotal = itensWithStock.reduce(
        (sum, item) => sum + (item.quantidade_solicitada || 0),
        0
      );

      const codigo = editingSaida?.codigo || (await generateCodigo());

      const data = {
        cliente_id: formData.cliente_id,
        cliente_nome: formData.cliente_nome,
        data_solicitacao: formData.data_solicitacao,
        data_programada: formData.data_programada,
        observacoes: formData.observacoes,
        itens: itensWithStock,
        quantidade_total: quantidadeTotal,
        usuario_criador: editingSaida?.usuario_criador || user?.nome || "",
        usuario_responsavel: user?.nome || "",
      };

      let createdSaida = null;
      if (editingSaida) {
        await entities.saidas.update(editingSaida.id, data);
      } else {
        createdSaida = await entities.saidas.create({
          ...data,
          codigo,
          status: "aguardando",
          enviado_ao_fiscal: false,
          modulo_origem: moduloOrigem || MODULO_SAIDA_CHEMFLOW,
        });
      }

      if (isFiscal) {
        // Transbordo: devolve/reaplica saldo de itens removidos/alterados e recalcula estoque.
        // Industrialização permanece no bloco abaixo (sem alteração de comportamento).
        await resyncTransbordoStockAfterSaidaEdit(editingSaida, itensWithStock, {
          estoque: entradas,
          vasilhames,
          dataSaida:
            editingSaida?.data_programada || todayDateInputValue() || null,
        });

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

      if (!editingSaida && typeof onCreateSuccess === "function" && createdSaida?.id) {
        onCreateSuccess(createdSaida);
        setSaving(false);
        return;
      }

      navigate(basePath);
    } catch {
      setError("Erro ao salvar saída. Tente novamente.");
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
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate(basePath)}>
            Cancelar
          </Button>
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
        <div className="grid grid-cols-3 gap-4">
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
              onChange={(iso) =>
                setFormData((prev) => ({
                  ...prev,
                  data_programada: iso,
                }))
              }
            />
          </div>
          <div className="space-y-1.5 col-span-3">
            <Label>Observações</Label>
            <Textarea
              value={formData.observacoes}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, observacoes: e.target.value }))
              }
              placeholder="Observações da solicitação..."
              rows={2}
            />
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
        <div className="space-y-4">
          {formData.itens.map((item, index) => (
            <SaidaItemRow
              key={index}
              index={index}
              item={item}
              itens={formData.itens}
              entradas={entradas}
              vasilhames={vasilhames}
              containersInd={containersInd}
              stocksInd={stocksInd}
              movementsInd={movementsInd}
              clienteId={formData.cliente_id}
              clienteNome={formData.cliente_nome}
              enableMultiOrigem={showOrigemSelector}
              lockedOrigem={lockedOrigem}
              onChange={(updated) => updateItem(index, updated)}
              onRemove={() => removeItem(index)}
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
    </div>
  );
}
