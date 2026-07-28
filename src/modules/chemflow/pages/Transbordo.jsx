import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { entities } from '@chemflow/services/entities';
import { syncEstoqueSaldos } from "@chemflow/lib/estoqueSaldo";
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
import TransbordoModal from "@chemflow/components/transbordo/TransbordoModal";
import TransbordoViewDialog from "@chemflow/components/transbordo/TransbordoViewDialog";
import {
  formatVolume,
  formatMass,
  roundVolume,
  roundMass,
  parseDensidade,
  distributeInteger,
} from "@chemflow/lib/format";
import {
  calculateFIFOAllocation,
  splitEmbalagensUnitarias,
} from "@chemflow/lib/fifo";
import {
  findFracionadoNoPatio,
  mergeComposicao,
  getDominantLote,
  removeComposicaoByTransbordo,
  unifyDuplicateVasilhames,
  seedComposicaoFromVasilhame,
} from "@chemflow/lib/vasilhameComposicao";
import { syncEmptyTankaVasilhames } from "@chemflow/lib/tankaVolume";
import {
  buildFiltracaoFromVasilhame,
  getFiltroEmUso,
  isFiltracaoElegivel,
  upsertFiltracaoForVasilhame,
} from "@chemflow/lib/filtracao";

const TIPOS_VASILHAME = new Set([
  "Vasilhame",
  "Tankagem",
  "One Way (IBC)",
  "Bombona 200 L",
  "Tambor 200 L",
]);

const TIPOS_EMBALAGEM_UNITARIA = new Set([
  "One Way (IBC)",
  "Bombona 200 L",
  "Tambor 200 L",
]);

/** Converte string vazia em null (evita erro de UUID/date no Postgres). */
const nullIfEmpty = (v) => (v === "" || v === undefined ? null : v);

function buildVasilhameBase(data, codigo, savedTransbordo, d, destinoIndex, comp) {
  const isTankagem = d.tipo_embalagem === "Tankagem";
  const isUnitaria = TIPOS_EMBALAGEM_UNITARIA.has(d.tipo_embalagem);
  const dens = parseDensidade(data.densidade);
  const volume = roundVolume(
    isUnitaria
      ? d.volume_por_embalagem || d.volume || 0
      : d.volume || d.volume_total || 0
  );
  const pesoLiquido =
    d.peso_liquido != null && d.peso_liquido !== ""
      ? roundMass(d.peso_liquido)
      : dens > 0
      ? roundMass(volume * dens)
      : 0;
  const composicao = mergeComposicao([], comp, {
    transbordo_codigo: codigo,
    data: data.data || null,
  });
  const lote = getDominantLote(composicao);

  return {
    codigo,
    transbordo_id: savedTransbordo.id,
    origem: "transbordo",
    numero_op: codigo,
    placa: isTankagem ? (d.tanka_codigo || "") : (d.placa || ""),
    barril: isTankagem || isUnitaria ? "" : (d.barril || ""),
    tipo: d.tipo_embalagem,
    produto_id: nullIfEmpty(data.produto_id),
    produto_nome: data.produto_nome || "",
    produto_codigo: data.produto_codigo || "",
    cliente_id: nullIfEmpty(data.cliente_id),
    cliente_nome: data.cliente_nome || "",
    lote,
    densidade: data.densidade || "",
    volume,
    tara: roundMass(d.tara || 0),
    peso_liquido: pesoLiquido,
    peso_bruto: roundMass((d.tara || 0) + pesoLiquido),
    lacres: d.lacres || "",
    eslinga: d.eslinga || "",
    gps: d.gps || "",
    menor_teste: nullIfEmpty(d.menor_teste),
    status: "No Pátio",
    responsavel: (data.operadores || []).join(", "),
    fracionado: d.fracionado || false,
    composicao,
    destino_index: destinoIndex,
  };
}

export default function Transbordo() {
  const [transbordos, setTransbordos] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [entradas, setEntradas] = useState([]);
  const [isotanques, setIsotanques] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [search, setSearch] = useState("");
  const [clienteFilter, setClienteFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTransbordo, setEditingTransbordo] = useState(null);
  const [readOnly, setReadOnly] = useState(false);
  const [viewTransbordo, setViewTransbordo] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [prefillConsumed, setPrefillConsumed] = useState(false);
  const location = useLocation();
  const prefillEntrada = location.state?.prefillEntrada;

  const loadData = async () => {
    setLoading(true);
    try {
      const [trans, prods, cliens, ents, isos, vascs] = await Promise.all([
        entities.transbordos.list("-created_date"),
        entities.produtos.list(),
        entities.clientes.list(),
        entities.estoque.list(),
        entities.isotanques.list(),
        entities.vasilhames.list(),
      ]);
      setTransbordos(trans);
      setProdutos(prods);
      setClientes(cliens);
      setEntradas(ents);
      setIsotanques(isos);
      setVasilhames(vascs);
    } catch {
      setTransbordos([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (prefillEntrada && !loading && !prefillConsumed) {
      setEditingTransbordo(null);
      setReadOnly(false);
      setSaveError("");
      setModalOpen(true);
      setPrefillConsumed(true);
    }
  }, [prefillEntrada, loading, prefillConsumed]);

  const filtered = transbordos.filter((t) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      t.codigo_transbordo?.toLowerCase().includes(q) ||
      t.produto_nome?.toLowerCase().includes(q) ||
      t.cliente_nome?.toLowerCase().includes(q) ||
      (t.operadores || []).some((op) => op.toLowerCase().includes(q));

    const matchCliente =
      !clienteFilter ||
      clienteFilter === "Todos os clientes" ||
      t.cliente_nome === clienteFilter;

    return matchSearch && matchCliente;
  });

  const formatDate = (d) => {
    if (!d) return "-";
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("pt-BR");
  };

  const generateCodigo = () => {
    const existing = transbordos
      .map((t) => t.codigo_transbordo)
      .filter(Boolean)
      .map((c) => parseInt(c.replace(/\D/g, "")))
      .filter((n) => !isNaN(n));
    const max = existing.length > 0 ? Math.max(...existing) : 0;
    return `T${String(max + 1).padStart(3, "0")}`;
  };

  const handleNew = () => {
    setEditingTransbordo(null);
    setReadOnly(false);
    setSaveError("");
    setModalOpen(true);
  };

  const handleEdit = (t) => {
    setEditingTransbordo(t);
    setReadOnly(false);
    setSaveError("");
    setModalOpen(true);
  };

  const handleView = (t) => {
    setViewTransbordo(t);
    setViewOpen(true);
  };

  const handleSave = async (data) => {
    setSaveError("");
    try {
      const affectedEstoqueIds = [
        ...(editingTransbordo?.origens || []).map((o) => o.entrada_id),
        ...(data.origens || []).map((o) => o.entrada_id),
      ];

      // Normaliza volumes para litros inteiros (soma destino = soma origem)
      const dens = parseDensidade(data.densidade);
      const origens = (data.origens || []).map((o) => ({
        ...o,
        volume_retirado: roundVolume(o.volume_retirado),
        massa_retirada: roundMass(
          o.massa_retirada ?? roundVolume(o.volume_retirado) * dens
        ),
      }));
      const destinos = (data.destinos || []).map((d) => {
        const volume_total = roundVolume(d.volume_total || d.volume || 0);
        return {
          ...d,
          volume: d.tipo_embalagem === "Vasilhame" || d.tipo_embalagem === "Tankagem"
            ? volume_total
            : roundVolume(d.volume || 0),
          volume_total,
          volume_por_embalagem: roundVolume(d.volume_por_embalagem || 0),
          quantidade_embalagens: Math.round(d.quantidade_embalagens || 0),
          tara: roundMass(d.tara || 0),
          peso_liquido: roundMass(d.peso_liquido || (dens > 0 ? volume_total * dens : 0)),
          peso_bruto: roundMass(d.peso_bruto || 0),
        };
      });

      // Ajuste fino: residual de arredondamento absorvido no último destino
      const sumOrig = origens.reduce((s, o) => s + o.volume_retirado, 0);
      const sumDest = destinos.reduce((s, d) => s + d.volume_total, 0);
      if (destinos.length > 0 && sumOrig !== sumDest) {
        const diff = sumOrig - sumDest;
        const last = destinos[destinos.length - 1];
        last.volume_total = Math.max(0, last.volume_total + diff);
        if (last.tipo_embalagem === "Vasilhame" || last.tipo_embalagem === "Tankagem") {
          last.volume = last.volume_total;
        }
        last.peso_liquido =
          dens > 0 ? roundMass(last.volume_total * dens) : last.peso_liquido;
      }

      const volume_total = origens.reduce((s, o) => s + o.volume_retirado, 0);
      const massa_total = roundMass(volume_total * dens);
      const payload = {
        ...data,
        cliente_id: nullIfEmpty(data.cliente_id),
        produto_id: nullIfEmpty(data.produto_id),
        volume_total,
        massa_total,
        origens,
        destinos,
      };

      const produtoFiltrado = !!produtos.find(
        (p) => p.id === payload.produto_id
      )?.filtrado;

      const filtroEmUso = produtoFiltrado ? await getFiltroEmUso(entities) : null;
      const filtroExtras = filtroEmUso
        ? { filtro_id: filtroEmUso.id, filtro_codigo: filtroEmUso.codigo || "" }
        : {};

      let savedTransbordo;
      let codigo;
      if (editingTransbordo) {
        codigo = editingTransbordo.codigo_transbordo;
        // Reverte top-ups de fracionados feitos por este transbordo antes de reaplicar
        const oldCodigo = codigo;
        for (const d of editingTransbordo.destinos || []) {
          if (d.tipo_embalagem !== "Vasilhame" || !d.placa) continue;
          const existing = findFracionadoNoPatio(vasilhames, {
            placa: d.placa,
            barril: d.barril,
            id: d.vasilhame_existente_id,
          });
          // Também busca qualquer No Pátio com a placa (pode ter deixado de ser fracionado)
          const candidate =
            existing ||
            vasilhames.find(
              (v) =>
                (v.status || "No Pátio") === "No Pátio" &&
                String(v.placa || "").trim().toUpperCase() ===
                  String(d.placa || "").trim().toUpperCase() &&
                (v.composicao || []).some((c) => c.transbordo_codigo === oldCodigo)
            );
          if (!candidate) continue;

          const cleaned = removeComposicaoByTransbordo(
            candidate.composicao || [],
            oldCodigo
          );
          const removedVol = roundVolume(
            (candidate.composicao || [])
              .filter((c) => c.transbordo_codigo === oldCodigo)
              .reduce((s, c) => s + (c.quantidade_l || 0), 0)
          );
          // Fallback: se não havia tag no histórico, subtrai volume do destino antigo
          const subtractVol =
            removedVol > 0 ? removedVol : roundVolume(d.volume_total || d.volume || 0);
          const newVol = Math.max(0, roundVolume(candidate.volume || 0) - subtractVol);
          const densCand =
            parseDensidade(candidate.densidade) || dens;
          const peso = densCand > 0 ? roundMass(newVol * densCand) : 0;
          const reverted = await entities.vasilhames.update(candidate.id, {
            volume: newVol,
            peso_liquido: peso,
            peso_bruto: roundMass((candidate.tara || 0) + peso),
            composicao: cleaned,
            lote: getDominantLote(cleaned) || candidate.lote || "",
            fracionado: newVol > 0 ? true : candidate.fracionado,
          });
          if (produtoFiltrado) {
            await upsertFiltracaoForVasilhame(
              entities,
              reverted || {
                ...candidate,
                volume: newVol,
                composicao: cleaned,
                lote: getDominantLote(cleaned) || candidate.lote || "",
              },
              filtroExtras
            );
          }
        }

        savedTransbordo = await entities.transbordos.update(editingTransbordo.id, payload);
        // Remove apenas registros CRIADOS por este transbordo (não os top-ups)
        // Filtrações ligadas caem via ON DELETE CASCADE em vasilhame_id
        await entities.vasilhames.deleteMany({ transbordo_id: editingTransbordo.id });
        await entities.filtracoes.deleteMany({ transbordo_id: editingTransbordo.id });
      } else {
        codigo = generateCodigo();
        savedTransbordo = await entities.transbordos.create({
          ...payload,
          codigo_transbordo: codigo,
        });
      }

      // FIFO: composição por destino → cria ou atualiza vasilhames
      const { destinoCompositions } = calculateFIFOAllocation(
        origens,
        destinos,
        dens
      );

      // Recarrega vasilhames atuais (após possível revert)
      const vasilhamesAtuais = await entities.vasilhames.list();

      const vasilhameRecords = [];
      for (let destinoIndex = 0; destinoIndex < destinos.length; destinoIndex++) {
        const d = destinos[destinoIndex];
        if (!TIPOS_VASILHAME.has(d.tipo_embalagem)) continue;

        const comp = destinoCompositions[destinoIndex] || [];

        // Top-up: vasilhame fracionado já no pátio → atualiza (não cria)
        if (d.tipo_embalagem === "Vasilhame" && d.placa) {
          const existing = findFracionadoNoPatio(vasilhamesAtuais, {
            placa: d.placa,
            barril: d.barril,
            id: d.vasilhame_existente_id,
          });

          if (existing) {
            const addVol = roundVolume(d.volume_total || d.volume || 0);
            const newVol = roundVolume((existing.volume || 0) + addVol);
            // Preserva aporte inicial mesmo se composicao estiver vazia/incompleta
            const baseComp = seedComposicaoFromVasilhame(existing);
            const merged = mergeComposicao(baseComp, comp, {
              transbordo_codigo: codigo,
              data: payload.data || null,
            });
            const densV =
              parseDensidade(existing.densidade) || dens;
            const peso = densV > 0 ? roundMass(newVol * densV) : roundMass(
              (existing.peso_liquido || 0) + (d.peso_liquido || addVol * densV)
            );
            const tara = roundMass(d.tara != null && d.tara !== "" ? d.tara : existing.tara || 0);
            // Top-up: se o usuário não marcou fracionado, ou já há múltiplos lotes → completado
            const lotesPosMerge = new Set(
              merged.map((c) => (c.lote || "").trim()).filter(Boolean)
            );
            const aindaFracionado =
              !!d.fracionado && lotesPosMerge.size <= 1;

            const updatedTopUp = await entities.vasilhames.update(existing.id, {
              volume: newVol,
              peso_liquido: peso,
              peso_bruto: roundMass(tara + peso),
              tara,
              composicao: merged,
              lote: getDominantLote(merged),
              fracionado: aindaFracionado,
              numero_op: codigo,
              produto_id: nullIfEmpty(payload.produto_id) || existing.produto_id,
              produto_nome: payload.produto_nome || existing.produto_nome,
              produto_codigo: payload.produto_codigo || existing.produto_codigo,
              cliente_id: nullIfEmpty(payload.cliente_id) || existing.cliente_id,
              cliente_nome: payload.cliente_nome || existing.cliente_nome,
              densidade: payload.densidade || existing.densidade,
              lacres: d.lacres || existing.lacres || "",
              eslinga: d.eslinga || existing.eslinga || "",
              gps: d.gps || existing.gps || "",
              menor_teste: nullIfEmpty(d.menor_teste) || existing.menor_teste,
              responsavel:
                (payload.operadores || []).join(", ") || existing.responsavel,
              status: "No Pátio",
            });
            if (produtoFiltrado) {
              await upsertFiltracaoForVasilhame(
                entities,
                updatedTopUp || {
                  ...existing,
                  volume: newVol,
                  composicao: merged,
                  lote: getDominantLote(merged),
                  produto_id: nullIfEmpty(payload.produto_id) || existing.produto_id,
                  produto_nome: payload.produto_nome || existing.produto_nome,
                  produto_codigo: payload.produto_codigo || existing.produto_codigo,
                  cliente_id: nullIfEmpty(payload.cliente_id) || existing.cliente_id,
                  cliente_nome: payload.cliente_nome || existing.cliente_nome,
                  codigo: existing.codigo || codigo,
                  transbordo_id: existing.transbordo_id || savedTransbordo.id,
                },
                { codigo, transbordo_id: savedTransbordo.id, ...filtroExtras }
              );
            }
            continue;
          }
        }

        const base = buildVasilhameBase(
          payload,
          codigo,
          savedTransbordo,
          d,
          destinoIndex,
          comp
        );

        if (TIPOS_EMBALAGEM_UNITARIA.has(d.tipo_embalagem)) {
          const qtd = Math.max(1, Math.round(d.quantidade_embalagens || 1));
          const volParts = splitEmbalagensUnitarias(d.volume_total, qtd);
          const compPartsByLine = comp.map((c) =>
            distributeInteger(c.quantidade_l, qtd)
          );

          for (let u = 0; u < qtd; u++) {
            const volUnit = volParts[u];
            const unitComp = mergeComposicao(
              [],
              comp.map((c, ci) => {
                const qL = compPartsByLine[ci][u];
                return {
                  ...c,
                  quantidade_l: qL,
                  quantidade_kg: dens > 0 ? roundMass(qL * dens) : 0,
                };
              }),
              { transbordo_codigo: codigo, data: payload.data || null }
            );
            const pesoUnit = dens > 0 ? roundMass(volUnit * dens) : 0;
            vasilhameRecords.push({
              ...base,
              volume: volUnit,
              peso_liquido: pesoUnit,
              peso_bruto: roundMass((d.tara || 0) + pesoUnit),
              composicao: unitComp,
              lote: getDominantLote(unitComp),
              barril: qtd > 1 ? `${u + 1}/${qtd}` : "",
            });
          }
        } else {
          vasilhameRecords.push(base);
        }
      }

      if (vasilhameRecords.length > 0) {
        const createdVasilhames = await entities.vasilhames.bulkCreate(vasilhameRecords);
        if (produtoFiltrado && createdVasilhames.length > 0) {
          const filtracaoRecords = createdVasilhames
            .filter(isFiltracaoElegivel)
            .map((v) =>
              buildFiltracaoFromVasilhame(v, {
                codigo,
                transbordo_id: savedTransbordo.id,
                ...filtroExtras,
              })
            );
          if (filtracaoRecords.length > 0) {
            await entities.filtracoes.bulkCreate(filtracaoRecords);
          }
        }
      }

      // Unifica tanques duplicados no pátio (mesma placa)
      const afterSave = await entities.vasilhames.list();
      await unifyDuplicateVasilhames(afterSave, entities);

      // Origem tankagem esvaziada → volume 0 + data_saida no vasilhame
      await syncEmptyTankaVasilhames({
        origens,
        destinos,
        dataSaida: payload.data,
        isotanques,
        transbordos,
        editingTransbordoId: editingTransbordo?.id || null,
        entities,
        vasilhamesList: afterSave,
      });

      await syncEstoqueSaldos(affectedEstoqueIds);

      await loadData();
      setModalOpen(false);
      setEditingTransbordo(null);
    } catch (err) {
      console.error("[ChemFlow] Erro ao registrar transbordo:", err);
      setSaveError(
        err?.message ||
          "Não foi possível registrar o transbordo. Verifique os dados e tente novamente."
      );
    }
  };

  const handleDelete = async () => {
    try {
      const toDelete = transbordos.find((t) => t.id === deleteId);
      const affectedIds = (toDelete?.origens || []).map((o) => o.entrada_id);

      await entities.vasilhames.deleteMany({ transbordo_id: deleteId });
      await entities.filtracoes.deleteMany({ transbordo_id: deleteId });
      await entities.transbordos.delete(deleteId);
      await syncEstoqueSaldos(affectedIds);
      await loadData();
    } catch {
      // ignore
    }
    setDeleteId(null);
  };

  const clienteFilterOptions = [
    { id: "all", nome: "Todos os clientes" },
    ...clientes,
  ];

  const totalVolume = filtered.reduce((sum, t) => sum + (t.volume_total || 0), 0);
  const totalMassa = filtered.reduce((sum, t) => sum + (t.massa_total || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Transbordos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {transbordos.length} registro(s) cadastrado(s)
          </p>
        </div>
        <Button onClick={handleNew} className="bg-primary hover:bg-primary/90 gap-2">
          <Plus className="w-4 h-4" />
          Novo Transbordo
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código, produto, cliente ou operador..."
            className="pl-10"
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
                <th className="px-5 py-3 font-medium">Data</th>
                <th className="px-5 py-3 font-medium">Produto</th>
                <th className="px-5 py-3 font-medium">Cliente</th>
                <th className="px-5 py-3 font-medium">Volume Transbordado</th>
                <th className="px-5 py-3 font-medium">Massa Transbordada</th>
                <th className="px-5 py-3 font-medium">Operadores</th>
                <th className="px-5 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando transbordos...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum transbordo encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((t, i) => (
                  <tr
                    key={t.id}
                    className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                      i % 2 === 1 ? "bg-muted/40/30" : ""
                    }`}
                  >
                    <td className="px-5 py-3 font-medium text-primary">
                      {t.codigo_transbordo || "-"}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(t.data)}</td>
                    <td className="px-5 py-3 text-foreground">
                      {t.produto_codigo ? `${t.produto_codigo} - ` : ""}
                      {t.produto_nome || "-"}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{t.cliente_nome || "-"}</td>
                    <td className="px-5 py-3 text-foreground font-medium">
                      {formatVolume(t.volume_total, { empty: "-" })} L
                    </td>
                    <td className="px-5 py-3 text-foreground font-medium">
                      {formatMass(t.massa_total, { empty: "-" })} kg
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(t.operadores || []).slice(0, 2).map((op) => (
                          <span key={op} className="inline-flex px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                            {op.split(" ")[0]}
                          </span>
                        ))}
                        {(t.operadores || []).length > 2 && (
                          <span className="text-xs text-muted-foreground">
                            +{t.operadores.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleView(t)} className="text-muted-foreground hover:text-muted-foreground transition-colors" title="Visualizar">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleEdit(t)} className="text-muted-foreground hover:text-muted-foreground transition-colors" title="Editar">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteId(t.id)} className="text-red-400 hover:text-red-600 transition-colors" title="Excluir">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary */}
        <div className="flex items-center justify-between gap-6 px-5 py-3 border-t border-border text-sm flex-wrap shrink-0">
          <span className="text-muted-foreground">
            Itens exibidos: <span className="font-medium text-foreground">{filtered.length}</span>
          </span>
          <span className="text-muted-foreground">
            Volume total: <span className="font-medium text-foreground">{formatVolume(totalVolume)} L</span>
          </span>
          <span className="text-muted-foreground">
            Massa total: <span className="font-medium text-foreground">{formatMass(totalMassa)} kg</span>
          </span>
        </div>
      </div>

      {/* Modal */}
      <TransbordoModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingTransbordo(null);
          setReadOnly(false);
          setSaveError("");
        }}
        onSave={handleSave}
        editingTransbordo={editingTransbordo}
        readOnly={readOnly}
        clientes={clientes}
        produtos={produtos}
        entradas={entradas}
        isotanques={isotanques}
        vasilhames={vasilhames}
        transbordos={transbordos}
        prefillEntrada={prefillEntrada}
        externalError={saveError}
      />

      {/* View Dialog */}
      <TransbordoViewDialog
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewTransbordo(null);
        }}
        transbordo={viewTransbordo}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este transbordo? Esta ação não pode ser desfeita.
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
    </div>
  );
}
