import { useState, useEffect } from "react";
import { entities } from '@transbordo/services/entities';
import { Plus, Search, Eye, Pencil, Trash2, Truck } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import VasilhameModal from "@transbordo/components/vasilhame/VasilhameModal";
import VasilhameViewDialog from "@transbordo/components/vasilhame/VasilhameViewDialog";
import { formatVolume, formatMass, roundVolume, roundMass } from "@transbordo/lib/format";
import {
  unifyDuplicateVasilhames,
  normalizeVasilhameLote,
  getDominantLote,
  repairVasilhameComposicao,
  LOTE_APORTE_ANTERIOR,
} from "@transbordo/lib/vasilhameComposicao";
import { migrateEstoqueEmbaladoParaVasilhames, normalizeBarrilEmbalagensUnitarias, normalizeCodigoVasilhamesEntrada } from "@transbordo/lib/transbordoEmbalado";
import {
  syncEstoqueSaldos,
  resolveEstoqueIdsFromVasilhame,
} from "@transbordo/lib/estoqueSaldo";
import {
  isDestinoEmbalagemUnitaria,
  getQuantidadeEmbalagensFromVasilhame,
  getVolumePorEmbalagemFromVasilhame,
  buildPlacaEmbalagens,
} from "@transbordo/lib/tiposEmbalagem";
import {
  buildVasilhameYardRestorePatch,
  collectConvencionalItemsForVasilhame,
  needsVasilhameYardVolumeHeal,
} from "@transbordo/lib/vasilhamePatio";
import NumberInputBr from "@transbordo/components/NumberInputBr";

export default function Vasilhames() {
  const [vasilhames, setVasilhames] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [search, setSearch] = useState("");
  const [clienteFilter, setClienteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVasilhame, setEditingVasilhame] = useState(null);
  const [readOnly, setReadOnly] = useState(false);
  const [viewVasilhame, setViewVasilhame] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [saidaVasilhame, setSaidaVasilhame] = useState(null);
  const [saidaData, setSaidaData] = useState("");
  const [saidaQtdEmbalagens, setSaidaQtdEmbalagens] = useState("");
  const [saidaError, setSaidaError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      try {
        const mig = await migrateEstoqueEmbaladoParaVasilhames();
        if (mig.deletedEstoque > 0) {
          console.info(
            `[ChemFlow] Migrados ${mig.migrated} embalagem(ns) do Estoque → Vasilhames.`
          );
        }
        await normalizeBarrilEmbalagensUnitarias();
        await normalizeCodigoVasilhamesEntrada();
      } catch (migErr) {
        console.warn("[ChemFlow] Migração embalado (estoque→vasilhame):", migErr);
      }

      const [vas, prods, cliens, trans] = await Promise.all([
        entities.vasilhames.list("-created_date"),
        entities.produtos.list(),
        entities.clientes.list(),
        entities.transbordos.list(),
      ]);

      const { kept, deletedIds } = await unifyDuplicateVasilhames(vas, entities);
      let list =
        deletedIds.length > 0
          ? kept
          : vas.map((v) => normalizeVasilhameLote(v));

      // Repara composição incompleta (ex.: só lote final após completar)
      const repaired = [];
      for (const v of list) {
        if (
          (v.status || "No Pátio") === "No Pátio" &&
          v.placa &&
          (v.origem === "transbordo" || v.origem === "manual" || v.fracionado)
        ) {
          repaired.push(await repairVasilhameComposicao(v, trans, entities));
        } else {
          repaired.push(normalizeVasilhameLote(v));
        }
      }
      list = repaired;

      const loteFixes = list
        .map((v) => {
          const dominant = getDominantLote(v.composicao);
          if (dominant && dominant !== (v.lote || "")) {
            return { id: v.id, lote: dominant };
          }
          return null;
        })
        .filter(Boolean);
      if (loteFixes.length > 0) {
        entities.vasilhames.bulkUpdate(loteFixes).catch(() => {});
      }

      // Corrige tanques no pátio com volume/peso zerados após reverter saída
      const zeroPatioCandidates = list.filter((v) => {
        if ((v.tipo || "") === "Tankagem") return false;
        const expedido =
          (v.status || "") === "Expedido" ||
          (v.data_saida != null && String(v.data_saida).trim() !== "");
        if (expedido) return false;
        return (
          (Number(v.volume) || 0) <= 0 && (Number(v.peso_liquido) || 0) <= 0
        );
      });
      if (zeroPatioCandidates.length > 0) {
        let saidasList = [];
        try {
          saidasList = await entities.saidas.list("-created_date");
        } catch {
          saidasList = [];
        }

        const healed = [];
        for (let i = 0; i < list.length; i++) {
          const v = list[i];
          const linked = collectConvencionalItemsForVasilhame(saidasList, v.id);
          if (!needsVasilhameYardVolumeHeal(v, linked)) {
            healed.push(v);
            continue;
          }
          const restore = buildVasilhameYardRestorePatch(v, {
            linkedItems: linked,
            transbordos: trans,
          });
          if (!restore || ((restore.volume || 0) <= 0 && (restore.peso_liquido || 0) <= 0)) {
            healed.push(v);
            continue;
          }
          const volumePatch = {
            volume: restore.volume,
            peso_liquido: restore.peso_liquido,
            peso_bruto: restore.peso_bruto,
            ...(restore.placa != null ? { placa: restore.placa } : {}),
            ...(restore.composicao ? { composicao: restore.composicao } : {}),
          };
          try {
            await entities.vasilhames.update(v.id, volumePatch);
            healed.push({ ...v, ...volumePatch });
          } catch (healErr) {
            console.warn("[ChemFlow] Heal volume pátio:", v.placa || v.id, healErr);
            healed.push(v);
          }
        }
        list = healed;
      }

      setVasilhames(list.map((v) => normalizeVasilhameLote(v)));
      setProdutos(prods);
      setClientes(cliens);
    } catch {
      setVasilhames([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const filtered = vasilhames.filter((v) => {
    // Tankagem fica só na tela de Tankagem
    if ((v.tipo || "") === "Tankagem") return false;

    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      v.codigo?.toLowerCase().includes(q) ||
      v.placa?.toLowerCase().includes(q) ||
      v.barril?.toLowerCase().includes(q) ||
      v.produto_nome?.toLowerCase().includes(q) ||
      v.cliente_nome?.toLowerCase().includes(q) ||
      v.lote?.toLowerCase().includes(q);

    const matchCliente =
      !clienteFilter ||
      clienteFilter === "Todos os clientes" ||
      v.cliente_nome === clienteFilter;

    const matchStatus =
      !statusFilter ||
      statusFilter === "Todos" ||
      (v.status || "No Pátio") === statusFilter;

    return matchSearch && matchCliente && matchStatus;
  });

  const formatDate = (d) => {
    if (!d) return "-";
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("pt-BR");
  };

  const handleNew = () => {
    setEditingVasilhame(null);
    setReadOnly(false);
    setModalOpen(true);
  };

  const handleEdit = (v) => {
    setEditingVasilhame(v);
    setReadOnly(false);
    setModalOpen(true);
  };

  const handleView = (v) => {
    setViewVasilhame(v);
    setViewOpen(true);
  };

  const syncEstoqueFromVasilhame = async (vasilhame) => {
    if (!vasilhame) return;
    try {
      const [transbordos, estoqueList] = await Promise.all([
        entities.transbordos.list(),
        entities.estoque.list(),
      ]);
      const ids = resolveEstoqueIdsFromVasilhame(
        vasilhame,
        transbordos,
        estoqueList
      );
      if (ids.length > 0) {
        await syncEstoqueSaldos(ids);
      }
    } catch (err) {
      console.warn("[ChemFlow] Sync saldo após saída de vasilhame:", err);
    }
  };

  const handleSave = async (data) => {
    const prevExpedido =
      editingVasilhame &&
      ((editingVasilhame.status || "") === "Expedido" ||
        (editingVasilhame.data_saida != null &&
          String(editingVasilhame.data_saida).trim() !== ""));
    const nextExpedido =
      (data?.status || "") === "Expedido" ||
      (data?.data_saida != null && String(data.data_saida).trim() !== "");

    let saved = editingVasilhame;
    if (editingVasilhame) {
      let payload = data;
      if (prevExpedido && !nextExpedido) {
        try {
          const [saidasList, trans] = await Promise.all([
            entities.saidas.list("-created_date"),
            entities.transbordos.list(),
          ]);
          const linked = collectConvencionalItemsForVasilhame(
            saidasList,
            editingVasilhame.id
          );
          const restore = buildVasilhameYardRestorePatch(editingVasilhame, {
            linkedItems: linked,
            transbordos: trans,
          });
          if (restore) {
            payload = {
              ...data,
              ...restore,
              // Mantém volume/peso do formulário se o usuário já informou valores > 0
              volume:
                Number(data.volume) > 0 ? data.volume : restore.volume,
              peso_liquido:
                Number(data.peso_liquido) > 0
                  ? data.peso_liquido
                  : restore.peso_liquido,
              peso_bruto:
                Number(data.peso_bruto) > 0
                  ? data.peso_bruto
                  : restore.peso_bruto,
            };
          }
        } catch (restoreErr) {
          console.warn("[ChemFlow] Restore pátio (edit):", restoreErr);
        }
      }
      await entities.vasilhames.update(editingVasilhame.id, payload);
      saved = { ...editingVasilhame, ...payload };
    } else {
      saved = await entities.vasilhames.create({
        ...data,
        codigo: "Manual",
        origem: "manual",
      });
    }

    if (prevExpedido !== nextExpedido || nextExpedido) {
      await syncEstoqueFromVasilhame(saved);
    }

    await loadData();
    setModalOpen(false);
    setEditingVasilhame(null);
  };

  const handleDelete = async () => {
    try {
      await entities.vasilhames.delete(deleteId);
      await loadData();
    } catch {
      // ignore
    }
    setDeleteId(null);
  };

  const handleSaida = (v) => {
    setSaidaVasilhame(v);
    setSaidaData(v.data_saida || new Date().toISOString().split("T")[0]);
    const qtd = getQuantidadeEmbalagensFromVasilhame(v);
    setSaidaQtdEmbalagens(qtd > 0 ? String(qtd) : "");
    setSaidaError("");
  };

  const handleSaidaSave = async () => {
    if (!saidaVasilhame) return;
    try {
      const reverting =
        saidaData == null || String(saidaData).trim() === "";
      let updatedVasilhame = { ...saidaVasilhame };

      // Remover data de saída → No Pátio + restaurar volume/peso
      if (reverting) {
        const [saidasList, trans] = await Promise.all([
          entities.saidas.list("-created_date"),
          entities.transbordos.list(),
        ]);
        const linked = collectConvencionalItemsForVasilhame(
          saidasList,
          saidaVasilhame.id
        );
        const patch =
          buildVasilhameYardRestorePatch(saidaVasilhame, {
            linkedItems: linked,
            transbordos: trans,
          }) || {
            status: "No Pátio",
            data_saida: null,
          };
        await entities.vasilhames.update(saidaVasilhame.id, patch);
        updatedVasilhame = { ...saidaVasilhame, ...patch };
        await syncEstoqueFromVasilhame(updatedVasilhame);
        await loadData();
        setSaidaVasilhame(null);
        setSaidaData("");
        setSaidaQtdEmbalagens("");
        setSaidaError("");
        return;
      }

      const isUnitario = isDestinoEmbalagemUnitaria(saidaVasilhame.tipo);
      const qtdAtual = getQuantidadeEmbalagensFromVasilhame(saidaVasilhame);
      const qtdSaida = Math.round(Number(saidaQtdEmbalagens) || 0);

      if (isUnitario) {
        if (qtdSaida <= 0) {
          setSaidaError("Informe a quantidade de embalagens da saída.");
          return;
        }
        if (qtdAtual > 0 && qtdSaida > qtdAtual) {
          setSaidaError(
            `Quantidade máxima disponível: ${qtdAtual} embalagem(ns).`
          );
          return;
        }

        const volPorEmb =
          getVolumePorEmbalagemFromVasilhame(saidaVasilhame) ||
          (qtdAtual > 0
            ? roundVolume((saidaVasilhame.volume || 0) / qtdAtual)
            : 0);
        const dens =
          parseFloat(
            String(saidaVasilhame.densidade || "0").replace(",", ".")
          ) || 0;
        const restante = Math.max(0, (qtdAtual || qtdSaida) - qtdSaida);

        if (restante <= 0) {
          const patch = {
            data_saida: saidaData,
            status: "Expedido",
            volume: 0,
            peso_liquido: 0,
            peso_bruto: roundMass(saidaVasilhame.tara || 0),
            placa: buildPlacaEmbalagens(0, saidaVasilhame.tipo),
            // Mantém quantidade_l/kg na composição para baixa de estoque / auditoria
            composicao: (saidaVasilhame.composicao || []).map((c, i) =>
              i === 0 ? { ...c, quantidade_embalagens: 0 } : c
            ),
          };
          await entities.vasilhames.update(saidaVasilhame.id, patch);
          updatedVasilhame = { ...saidaVasilhame, ...patch };
        } else {
          const newVol = roundVolume(restante * volPorEmb);
          const newPeso =
            dens > 0
              ? roundMass(newVol * dens)
              : roundMass(
                  ((saidaVasilhame.peso_liquido || 0) * restante) /
                    (qtdAtual || restante)
                );
          const tara = roundMass(saidaVasilhame.tara || 0);
          const patch = {
            data_saida: null,
            status: "No Pátio",
            volume: newVol,
            peso_liquido: newPeso,
            peso_bruto: roundMass(tara + newPeso),
            placa: buildPlacaEmbalagens(restante, saidaVasilhame.tipo),
            composicao: (saidaVasilhame.composicao || []).map((c, i) =>
              i === 0
                ? {
                    ...c,
                    quantidade_embalagens: restante,
                    quantidade_l: newVol,
                    quantidade_kg: newPeso,
                    volume_por_embalagem: volPorEmb,
                  }
                : c
            ),
          };
          await entities.vasilhames.update(saidaVasilhame.id, patch);
          updatedVasilhame = { ...saidaVasilhame, ...patch };
        }
      } else {
        const patch = {
          data_saida: saidaData,
          status: "Expedido",
        };
        await entities.vasilhames.update(saidaVasilhame.id, patch);
        updatedVasilhame = { ...saidaVasilhame, ...patch };
      }

      // Abate/restaura saldo do estoque de origem (ex.: E012 via OP T008)
      await syncEstoqueFromVasilhame(updatedVasilhame);

      await loadData();
      setSaidaVasilhame(null);
      setSaidaData("");
      setSaidaQtdEmbalagens("");
      setSaidaError("");
    } catch {
      setSaidaError("Não foi possível registrar a saída. Tente novamente.");
    }
  };

  const clienteFilterOptions = [{ id: "all", nome: "Todos os clientes" }, ...clientes];
  const statusFilterOptions = [
    { value: "Todos", label: "Todos" },
    { value: "No Pátio", label: "No Pátio" },
    { value: "Expedido", label: "Expedido" },
  ];

  const noPatio = vasilhames.filter(
    (v) =>
      (v.tipo || "") !== "Tankagem" &&
      (v.status || "No Pátio") === "No Pátio"
  );
  const volumePatio = noPatio.reduce((sum, v) => sum + (v.volume || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vasilhames / Envase</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{vasilhames.length} embalagem(ns)</p>
        </div>
        <Button onClick={handleNew} className="bg-primary hover:bg-primary/90 gap-2">
          <Plus className="w-4 h-4" />
          Adicionar Tanque
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produto, nº placa, nº barril, cliente..."
            className="pl-10 bg-card"
          />
        </div>
        <div className="w-48">
          <SearchableSelect
            value={statusFilter}
            onChange={(label) => setStatusFilter(label)}
            options={statusFilterOptions}
            getOptionLabel={(o) => o.label}
            getOptionValue={(o) => o.value}
            placeholder="Todos"
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
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Nº Placa</th>
                <th className="px-4 py-3 font-medium">Nº Barril</th>
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Produto</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Volume (L)</th>
                <th className="px-4 py-3 font-medium">Massa (kg)</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Data Saída</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">
                    Carregando vasilhames...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">
                    Nenhum vasilhame encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((v, i) => {
                  const status = v.status || (v.data_saida ? "Expedido" : "No Pátio");
                  const isExpedido = status === "Expedido";
                  return (
                    <tr
                      key={v.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                        i % 2 === 1 ? "bg-muted/40/30" : ""
                      } ${isExpedido ? "opacity-50" : ""}`}
                    >
                      <td className="px-4 py-3 font-medium text-primary">{v.codigo || "-"}</td>
                      <td className="px-4 py-3 text-foreground">{v.placa || "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{v.barril || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{v.produto_codigo || "-"}</td>
                      <td className="px-4 py-3 text-foreground">{v.produto_nome || "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{v.cliente_nome || "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {(() => {
                          const dominant =
                            getDominantLote(v.composicao) || v.lote || "-";
                          const uniqueLotes = new Set(
                            (v.composicao || [])
                              .map((c) => (c.lote || "").trim())
                              .filter(
                                (l) => l && l !== LOTE_APORTE_ANTERIOR
                              )
                          ).size;
                          return (
                            <span className="inline-flex items-center gap-1.5">
                              <span>{dominant}</span>
                              {uniqueLotes > 1 && (
                                <span
                                  className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700"
                                  title="Vários lotes — veja o detalhe"
                                >
                                  +{uniqueLotes - 1}
                                </span>
                              )}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-foreground font-medium whitespace-nowrap">
                        {formatVolume(v.volume, { empty: "-" })}
                        {v.fracionado &&
                          new Set(
                            (v.composicao || [])
                              .map((c) => (c.lote || "").trim())
                              .filter(Boolean)
                          ).size <= 1 && (
                          <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-blue-800">
                            Fracionado
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-foreground font-medium">{formatMass(v.peso_liquido, { empty: "-" })}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                            status === "No Pátio" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"
                          }`}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(v.data_saida)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleView(v)} className="text-muted-foreground hover:text-muted-foreground transition-colors" title="Visualizar">
                            <Eye className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleEdit(v)} className="text-muted-foreground hover:text-muted-foreground transition-colors" title="Editar">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => setDeleteId(v.id)} className="text-red-400 hover:text-red-600 transition-colors" title="Excluir">
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleSaida(v)} className="text-muted-foreground hover:text-primary transition-colors" title="Lançar Saída">
                            <Truck className="w-4 h-4" />
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
        <div className="flex items-center justify-between gap-6 px-4 py-3 border-t border-border text-sm flex-wrap shrink-0">
          <span className="text-muted-foreground">
            Vasilhames no pátio: <span className="font-medium text-foreground">{noPatio.length}</span>
          </span>
          <span className="text-muted-foreground">
            Volume total no pátio: <span className="font-medium text-foreground">{formatVolume(volumePatio)} L</span>
          </span>
          <span className="text-muted-foreground">
            Total exibido: <span className="font-medium text-foreground">{filtered.length}</span>
          </span>
        </div>
      </div>

      {/* Modal */}
      <VasilhameModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingVasilhame(null);
          setReadOnly(false);
        }}
        onSave={handleSave}
        editingVasilhame={editingVasilhame}
        readOnly={readOnly}
        clientes={clientes}
        produtos={produtos}
      />

      {/* View Dialog */}
      <VasilhameViewDialog
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewVasilhame(null);
        }}
        vasilhame={viewVasilhame}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este vasilhame? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Saída Dialog */}
      <Dialog
        open={!!saidaVasilhame}
        onOpenChange={(v) => {
          if (!v) {
            setSaidaVasilhame(null);
            setSaidaError("");
            setSaidaQtdEmbalagens("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lançar Saída</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {saidaError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {saidaError}
              </p>
            )}
            {saidaVasilhame && isDestinoEmbalagemUnitaria(saidaVasilhame.tipo) && (
              <div className="space-y-1.5">
                <Label>Quantidade de embalagens *</Label>
                <NumberInputBr
                  decimals={0}
                  min={1}
                  max={
                    getQuantidadeEmbalagensFromVasilhame(saidaVasilhame) ||
                    undefined
                  }
                  value={saidaQtdEmbalagens}
                  onChange={(v) =>
                    setSaidaQtdEmbalagens(v === "" ? "" : String(v))
                  }
                  placeholder="0"
                  className="bg-white"
                />
                <p className="text-xs text-muted-foreground">
                  Disponível:{" "}
                  {getQuantidadeEmbalagensFromVasilhame(saidaVasilhame) || "—"}{" "}
                  · {saidaVasilhame.placa || saidaVasilhame.tipo}
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Data de Saída</Label>
              <Input
                type="date"
                value={saidaData}
                onChange={(e) => setSaidaData(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {saidaVasilhame &&
                isDestinoEmbalagemUnitaria(saidaVasilhame.tipo)
                  ? "Informe quantas embalagens sairão. Se for a quantidade total, o status muda para Expedido."
                  : "Ao definir uma data, o status muda para 'Expedido'. Remova a data para reverter para 'No Pátio'."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSaidaVasilhame(null);
                setSaidaError("");
                setSaidaQtdEmbalagens("");
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-primary hover:bg-primary/90"
              onClick={handleSaidaSave}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}