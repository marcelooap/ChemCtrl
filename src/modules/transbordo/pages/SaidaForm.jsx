import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { entities } from '@transbordo/services/entities';
import { useInternalAuth as useAuth } from '@/lib/InternalAuthContext';
import { ArrowLeft, Plus, Save } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import { Label } from "@shared/components/ui/label";
import { Textarea } from "@shared/components/ui/textarea";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import DateInputBr from "@transbordo/components/cadastro/DateInputBr";
import SaidaItemRow from "@transbordo/components/saida/SaidaItemRow";
import { formatMass, formatVolume } from "@transbordo/lib/format";

/** Data local de hoje em yyyy-mm-dd (evita deslocamento UTC). */
const todayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const emptyItem = () => ({
  tipo: "embalado",
  produto_id: "",
  produto_nome: "",
  produto_codigo: "",
  quantidade_solicitada: 0,
  peso_liquido_embalagem: 0,
  quantidade_embalagens: 0,
  lote: "",
  estoque_atual: 0,
  estoque_final: 0,
  entrada_id: "",
  vasilhame_id: "",
  vasilhame_placa: "",
  vasilhame_barril: "",
  volume_disponivel: 0,
  volume_solicitado: 0,
  saldo_final: 0,
  peso_liquido: 0,
  peso_bruto: 0,
});

const DEFAULT_BASE_PATH = "/chemflow/saida";

/**
 * Formulário de criação/edição de saída.
 * `basePath` permite reutilizar a mesma UI no Painel Comercial.
 */
export default function SaidaForm({ basePath = DEFAULT_BASE_PATH } = {}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isEdit = !!id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [entradas, setEntradas] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
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
    itens: [emptyItem()],
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [ents, vascs, cliens, saics] = await Promise.all([
          entities.estoque.list(),
          entities.vasilhames.list(),
          entities.clientes.list(),
          entities.saidas.list("-created_date"),
        ]);
        setEntradas(ents);
        setVasilhames(vascs);
        setClientes(cliens);
        setSaidas(saics);

        if (id) {
          const saida = await entities.saidas.get(id);
          setEditingSaida(saida);
          setFormData({
            cliente_id: saida.cliente_id || "",
            cliente_nome: saida.cliente_nome || "",
            data_solicitacao: saida.data_solicitacao || todayStr(),
            data_programada: saida.data_programada || "",
            observacoes: saida.observacoes || "",
            itens:
              (saida.itens || []).length > 0
                ? saida.itens.map((it) => ({ ...emptyItem(), ...it }))
                : [emptyItem()],
          });
        }
      } catch {
        setError("Erro ao carregar dados.");
      }
      setLoading(false);
    };
    load();
  }, [id]);

  // ── Saldo virtual: restaura estoque da saída original (edição) e desconta outros itens do formulário ──
  const getAvailableSaldo = (entradaId, currentIndex) => {
    const entrada = entradas.find((e) => e.id === entradaId);
    if (!entrada) return 0;
    let saldo = entrada.saldo_atual || 0;
    if (editingSaida?.enviado_ao_fiscal) {
      (editingSaida.itens || []).forEach((item) => {
        if (item.tipo === "embalado" && item.entrada_id === entradaId) {
          saldo += item.quantidade_solicitada || 0;
        }
      });
    }
    formData.itens.forEach((item, i) => {
      if (i !== currentIndex && item.tipo === "embalado" && item.entrada_id === entradaId) {
        saldo -= item.quantidade_solicitada || 0;
      }
    });
    return saldo;
  };

  const getAvailableVolume = (vasilhameId, currentIndex) => {
    const v = vasilhames.find((v) => v.id === vasilhameId);
    if (!v) return 0;
    let vol = v.volume || 0;
    if (editingSaida?.enviado_ao_fiscal) {
      (editingSaida.itens || []).forEach((item) => {
        if (item.tipo === "convencional" && item.vasilhame_id === vasilhameId) {
          vol += item.volume_solicitado || 0;
        }
      });
    }
    formData.itens.forEach((item, i) => {
      if (i !== currentIndex && item.tipo === "convencional" && item.vasilhame_id === vasilhameId) {
        vol -= item.volume_solicitado || 0;
      }
    });
    return vol;
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
    setFormData((prev) => ({ ...prev, itens: [...prev.itens, emptyItem()] }));
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

  const generateCodigo = () => {
    const existing = saidas
      .map((s) => s.codigo)
      .filter(Boolean)
      .map((c) => parseInt(c.replace(/\D/g, "")))
      .filter((n) => !isNaN(n));
    const max = existing.length > 0 ? Math.max(...existing) : 0;
    return `S${String(max + 1).padStart(3, "0")}`;
  };

  const handleSave = async () => {
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

    // Validar itens
    for (let i = 0; i < formData.itens.length; i++) {
      const item = formData.itens[i];
      if (item.tipo === "embalado") {
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
          setError(
            `Produto ${i + 1}: quantidade solicitada maior que o saldo disponível (${formatMass(available)} kg).`
          );
          return;
        }
      } else {
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
      }
    }

    setSaving(true);

    try {
      // ── Mapas de saldo virtual (restaura + desconta) ──
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

      const affectedEntradas = new Set();
      const affectedVasilhames = new Set();

      const isFiscal = editingSaida?.enviado_ao_fiscal;

      // Restaurar estoque da saída original (edição) — apenas se já era fiscal
      if (isFiscal) {
        (editingSaida.itens || []).forEach((item) => {
          if (item.tipo === "embalado" && item.entrada_id) {
            entradaSaldos[item.entrada_id] =
              (entradaSaldos[item.entrada_id] || 0) + (item.quantidade_solicitada || 0);
            affectedEntradas.add(item.entrada_id);
          } else if (item.tipo === "convencional" && item.vasilhame_id) {
            vasilhameVolumes[item.vasilhame_id] =
              (vasilhameVolumes[item.vasilhame_id] || 0) + (item.volume_solicitado || 0);
            affectedVasilhames.add(item.vasilhame_id);
          }
        });
      }

      // Descontar novos itens e snapshot dos valores
      const itensWithStock = formData.itens.map((item) => {
        if (item.tipo === "embalado") {
          const estoqueAntes = entradaSaldos[item.entrada_id] || 0;
          const qtd = item.quantidade_solicitada || 0;
          if (isFiscal) {
            entradaSaldos[item.entrada_id] = estoqueAntes - qtd;
            affectedEntradas.add(item.entrada_id);
          }
          return {
            ...item,
            estoque_atual: estoqueAntes,
            estoque_final: estoqueAntes - qtd,
          };
        } else {
          const volAntes = vasilhameVolumes[item.vasilhame_id] || 0;
          const vol = item.volume_solicitado || 0;
          if (isFiscal) {
            vasilhameVolumes[item.vasilhame_id] = volAntes - vol;
            affectedVasilhames.add(item.vasilhame_id);
          }

          const v = vasilhameOriginal[item.vasilhame_id];
          const originalVol = v?.volume || 0;
          const originalPesoLiq = v?.peso_liquido || 0;
          const densidade =
            originalVol > 0 ? originalPesoLiq / originalVol : 0;
          const pesoSolicitado = vol * densidade;

          return {
            ...item,
            volume_disponivel: volAntes,
            saldo_final: volAntes - vol,
            quantidade_solicitada: pesoSolicitado,
          };
        }
      });

      const quantidadeTotal = itensWithStock.reduce(
        (sum, item) => sum + (item.quantidade_solicitada || 0),
        0
      );

      const codigo = editingSaida?.codigo || generateCodigo();

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

      if (editingSaida) {
        await entities.saidas.update(editingSaida.id, data);
      } else {
        await entities.saidas.create({
          ...data,
          codigo,
          status: "aguardando",
          enviado_ao_fiscal: false,
        });
      }

      // Atualizar estoque apenas se a saída já era fiscal
      if (isFiscal) {
        const entradaUpdates = [...affectedEntradas].map((eid) => ({
          id: eid,
          saldo_atual: Math.max(0, entradaSaldos[eid]),
        }));
        if (entradaUpdates.length > 0)
          await entities.estoque.bulkUpdate(entradaUpdates);

        const vasilhameUpdates = [...affectedVasilhames].map((vid) => {
          const v = vasilhameOriginal[vid];
          const newVol = vasilhameVolumes[vid];
          const originalVol = v?.volume || 0;
          const originalPesoLiq = v?.peso_liquido || 0;
          const densidade = originalVol > 0 ? originalPesoLiq / originalVol : 0;
          const stillInSaida = formData.itens.some(
            (i) => i.tipo === "convencional" && i.vasilhame_id === vid
          );
          return {
            id: vid,
            volume: newVol,
            peso_liquido: newVol * densidade,
            peso_bruto: (v?.tara || 0) + newVol * densidade,
            status: stillInSaida ? "Expedido" : "No Pátio",
            data_saida: stillInSaida
              ? editingSaida?.data_programada || null
              : null,
          };
        });
        if (vasilhameUpdates.length > 0)
          await entities.vasilhames.bulkUpdate(vasilhameUpdates);
      }

      navigate(basePath);
    } catch {
      setError("Erro ao salvar saída. Tente novamente.");
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-border border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
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
            disabled={saving || !formData.data_programada}
            className="bg-primary hover:bg-primary/90 gap-2"
            title={
              !formData.data_programada
                ? "Preencha a data programada para salvar"
                : undefined
            }
          >
            <Save className="w-4 h-4" />
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Cabeçalho */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <h2 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2 mb-4">
          Dados da Solicitação
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Cliente *</Label>
            <SearchableSelect
              value={formData.cliente_nome}
              onChange={(label, option) => {
                if (!option) return;
                setFormData((prev) => {
                  const clienteChanged = prev.cliente_id !== option.id;
                  return {
                    ...prev,
                    cliente_id: option.id,
                    cliente_nome: option.nome,
                    itens: clienteChanged
                      ? prev.itens.map(() => emptyItem())
                      : prev.itens,
                  };
                });
                setCollapsedByIndex((prevMap) => {
                  // limpa colapso se o cliente mudou (itens resetados)
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

      {/* Produtos */}
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
              clienteId={formData.cliente_id}
              onChange={(updated) => updateItem(index, updated)}
              onRemove={() => removeItem(index)}
              getAvailableSaldo={getAvailableSaldo}
              getAvailableVolume={getAvailableVolume}
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
            Nenhum produto adicionado. Clique em "Adicionar Produto".
          </p>
        )}
      </div>
    </div>
  );
}