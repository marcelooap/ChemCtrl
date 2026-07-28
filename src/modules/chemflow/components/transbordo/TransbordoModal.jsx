import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
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
import { Plus, AlertCircle, CheckCircle2, X, ChevronDown } from "lucide-react";
import SearchableSelect from "@chemflow/components/cadastro/SearchableSelect";
import OrigemCard from "./OrigemCard";
import DestinoCard from "./DestinoCard";
import {
  formatVolume,
  formatMass,
  parseDensidade,
  roundVolume,
  roundMass,
  kgLotesToLitrosInteiros,
} from "@chemflow/lib/format";
import { loteToKg } from "@chemflow/lib/conversao";
import { computeDisponivelTransbordo } from "@chemflow/lib/estoqueSaldo";

const INPUT_EDITABLE = "bg-white";

function destinoItemLabel(d) {
  if (d.tipo_embalagem === "Vasilhame") {
    const parts = [d.placa, d.barril].filter(Boolean);
    return parts.length ? parts.join(" / ") : "vasilhame";
  }
  if (d.tipo_embalagem === "Tankagem") {
    return d.tanka_codigo || "tanka";
  }
  if (d.tipo_embalagem) {
    const qtd = d.quantidade_embalagens;
    return qtd > 0
      ? `${d.tipo_embalagem} (${qtd})`
      : d.tipo_embalagem;
  }
  return "item";
}

function destinoMassaKg(d, dens) {
  const vol = roundVolume(d.volume_total || d.volume || 0);
  if (d.peso_liquido != null && d.peso_liquido > 0) {
    return roundMass(d.peso_liquido);
  }
  return roundMass(dens > 0 ? vol * dens : 0);
}

const OPERADORES = [
  "Adriano Queiroz",
  "Leonardo Souza",
  "Rafael Novais",
  "Francisco Mariano",
  "Ezequiel",
  "Wandre Costa",
];

const createdAt = (row) => row?.created_at || row?.created_date || 0;

export default function TransbordoModal({
  open,
  onClose,
  onSave,
  editingTransbordo,
  readOnly,
  clientes,
  produtos,
  entradas,
  isotanques,
  vasilhames,
  transbordos,
  prefillEntrada,
  externalError = "",
}) {
  const [data, setData] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [clienteNome, setClienteNome] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [produtoNome, setProdutoNome] = useState("");
  const [produtoCodigo, setProdutoCodigo] = useState("");
  const [produtoDisplay, setProdutoDisplay] = useState("");
  const [densidade, setDensidade] = useState(0);
  const [operadores, setOperadores] = useState([]);
  const [observacoes, setObservacoes] = useState("");
  const [origens, setOrigens] = useState([]);
  const [destinos, setDestinos] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [operadoresOpen, setOperadoresOpen] = useState(false);
  const [collapsedDestinos, setCollapsedDestinos] = useState({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [pendingPayload, setPendingPayload] = useState(null);
  const operadoresRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    if (editingTransbordo) {
      setData(editingTransbordo.data || "");
      setClienteId(editingTransbordo.cliente_id || "");
      setClienteNome(editingTransbordo.cliente_nome || "");
      setProdutoId(editingTransbordo.produto_id || "");
      setProdutoNome(editingTransbordo.produto_nome || "");
      setProdutoCodigo(editingTransbordo.produto_codigo || "");
      setProdutoDisplay(
        editingTransbordo.produto_codigo
          ? `${editingTransbordo.produto_codigo} - ${editingTransbordo.produto_nome}`
          : editingTransbordo.produto_nome || ""
      );
      setDensidade(parseDensidade(editingTransbordo.densidade));
      setOperadores(editingTransbordo.operadores || []);
      setObservacoes(editingTransbordo.observacoes || "");
      setOrigens(
        (editingTransbordo.origens || []).map((o) =>
          o.entrada_id && !o.tipo_origem ? { ...o, tipo_origem: "entrada" } : o
        )
      );
      setDestinos(editingTransbordo.destinos || []);
    } else if (prefillEntrada) {
      const dens = parseDensidade(prefillEntrada.densidade);

      const sorted = [...entradas].sort(
        (a, b) => new Date(createdAt(a)) - new Date(createdAt(b))
      );
      const idMap = {};
      sorted.forEach((e, i) => {
        idMap[e.id] = `E${String(i + 1).padStart(3, "0")}`;
      });

      const savedEstoques = prefillEntrada.savedEstoques || prefillEntrada.savedEntradas || [];
      const entradaKey =
        prefillEntrada.id ||
        savedEstoques[0]?.entrada_id ||
        savedEstoques[0]?.id;
      const codigoEntrada =
        prefillEntrada.entrada_codigo ||
        savedEstoques[0]?.entrada_codigo ||
        idMap[entradaKey] ||
        "E000";
      const entradaCodigo = `${codigoEntrada} - ${prefillEntrada.produto_nome || ""}`;

      setData(new Date().toISOString().split("T")[0]);
      setClienteId(prefillEntrada.cliente_id || "");
      setClienteNome(prefillEntrada.cliente_nome || "");
      setProdutoId(prefillEntrada.produto_id || "");
      setProdutoNome(prefillEntrada.produto_nome || "");
      setProdutoCodigo(prefillEntrada.produto_codigo || "");
      setProdutoDisplay(
        prefillEntrada.produto_codigo
          ? `${prefillEntrada.produto_codigo} - ${prefillEntrada.produto_nome}`
          : prefillEntrada.produto_nome || ""
      );
      setDensidade(dens);
      setOperadores([]);
      setObservacoes("");
      const entradaLotes =
        prefillEntrada.lotes && prefillEntrada.lotes.length > 0
          ? prefillEntrada.lotes
          : [
              {
                lote: prefillEntrada.lote || "",
                densidade: prefillEntrada.densidade || "",
                quantidade: prefillEntrada.quantidade || 0,
                unidade_medida: prefillEntrada.unidade_medida || "L",
              },
            ];

      // kg por lote → litros inteiros com soma = volume total da entrada
      const lotesKg = entradaLotes.map((lt, i) => {
        const estoqueRow = savedEstoques[i];
        const lDens = parseDensidade(lt.densidade || estoqueRow?.densidade || dens);
        let quantidade_kg;
        if (estoqueRow) {
          quantidade_kg = estoqueRow.saldo_atual ?? estoqueRow.quantidade ?? 0;
        } else if ((lt.unidade_medida || "L") === "kg") {
          quantidade_kg = lt.quantidade || 0;
        } else {
          quantidade_kg = loteToKg(lt);
        }
        return {
          quantidade_kg,
          densidade: lDens || dens,
          lote: lt.lote || estoqueRow?.lote || "",
          estoqueRow,
          lt,
        };
      });

      const litrosPorLote = kgLotesToLitrosInteiros(lotesKg);

      const origensFromLotes = lotesKg.map((item, i) => {
        const volumeL = litrosPorLote[i] || 0;
        const lDens = item.densidade || dens;
        return {
          tipo_origem: "entrada",
          entrada_id: item.estoqueRow?.id || prefillEntrada.id,
          entrada_codigo: `${entradaCodigo} — Lote ${item.lote || i + 1}`,
          lote: item.lote,
          volume_retirado: volumeL,
          massa_retirada: roundMass(volumeL * lDens),
          saldo_restante: 0,
          saldo_disponivel: volumeL,
        };
      });
      setOrigens(origensFromLotes);
      setDestinos([]);
    } else {
      setData(new Date().toISOString().split("T")[0]);
      setClienteId("");
      setClienteNome("");
      setProdutoId("");
      setProdutoNome("");
      setProdutoCodigo("");
      setProdutoDisplay("");
      setDensidade(0);
      setOperadores([]);
      setObservacoes("");
      setOrigens([]);
      setDestinos([]);
    }
    setError("");
    setSaving(false);
    setCollapsedDestinos({});
    setConfirmOpen(false);
    setConfirmMessage("");
    setPendingPayload(null);
  }, [editingTransbordo, open, prefillEntrada, entradas]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (operadoresRef.current && !operadoresRef.current.contains(e.target)) {
        setOperadoresOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const clientesComProdutos = produtos
    .filter((p) => p.cliente_nome)
    .reduce((acc, p) => {
      if (!acc.find((c) => c.nome === p.cliente_nome)) {
        const matched = clientes.find(
          (c) => c.nome.toLowerCase() === p.cliente_nome.toLowerCase()
        );
        acc.push({ id: matched?.id || p.cliente_id || "", nome: p.cliente_nome });
      }
      return acc;
    }, []);

  const filteredProdutos = produtos.filter(
    (p) => !clienteNome || p.cliente_nome?.toLowerCase() === clienteNome.toLowerCase()
  );

  const produtosComSaldo = filteredProdutos.filter((p) =>
    entradas.some((e) => {
      if (!(e.produto_id === p.id || e.produto_nome === p.produto)) return false;
      const disponivel = computeDisponivelTransbordo(e, transbordos);
      return disponivel > 0 || (e.saldo_atual || 0) > 0;
    })
  );

  const sortedEntradas = [...entradas].sort(
    (a, b) => new Date(createdAt(a)) - new Date(createdAt(b))
  );
  const entradaIdMap = {};
  sortedEntradas.forEach((e, i) => {
    entradaIdMap[e.id] = e.entrada_codigo || `E${String(i + 1).padStart(3, "0")}`;
  });

  // Estoque por lote (granel) — disponível = quantidade − já transbordado
  const filteredEntradas = entradas
    .filter((e) => {
      if (e.embalado) return false;
      if (!(e.produto_id === produtoId || e.produto_nome === produtoNome)) {
        return false;
      }
      return computeDisponivelTransbordo(e, transbordos) > 0;
    })
    .map((e) => ({
      ...e,
      saldo_atual: computeDisponivelTransbordo(e, transbordos),
      display_codigo: entradaIdMap[e.id] || "E000",
      display_label: `${entradaIdMap[e.id] || "E000"} - ${e.produto_nome || ""}${
        e.lote ? ` (Lote ${e.lote})` : ""
      }`,
    }));

  const filteredIsotanques = isotanques.filter(
    (i) => i.produto_id === produtoId || i.produto_nome?.toLowerCase() === produtoNome?.toLowerCase()
  );

  // Tankas com saldo > 0 (entrada Tankagem − saída como origem tanka)
  const tankaVolumes = {};
  const tankaLotes = {};
  transbordos.forEach((t) => {
    (t.destinos || []).forEach((d) => {
      if (d.tipo_embalagem === "Tankagem" && d.tanka_id) {
        tankaVolumes[d.tanka_id] =
          (tankaVolumes[d.tanka_id] || 0) + roundVolume(d.volume_total || d.volume || 0);
        const lote = (t.origens || [])[0]?.lote || "";
        if (lote) tankaLotes[d.tanka_id] = lote;
      }
    });
    (t.origens || []).forEach((o) => {
      if (o.tipo_origem === "tanka" && o.entrada_id) {
        tankaVolumes[o.entrada_id] =
          (tankaVolumes[o.entrada_id] || 0) - roundVolume(o.volume_retirado || 0);
      }
    });
  });
  Object.keys(tankaVolumes).forEach((id) => {
    tankaVolumes[id] = roundVolume(tankaVolumes[id]);
  });

  const tankasComSaldo = isotanques
    .filter(
      (i) =>
        (i.produto_id === produtoId ||
          i.produto_nome?.toLowerCase() === produtoNome?.toLowerCase()) &&
        (tankaVolumes[i.id] || 0) > 0
    )
    .map((i) => ({
      ...i,
      saldo_atual: tankaVolumes[i.id] || 0,
      unidade_medida: "L",
      lote: tankaLotes[i.id] || "",
      display_label: `${i.tanka || i.codigo_itku || "Tanka"} - ${i.produto_nome || ""} (${formatVolume(tankaVolumes[i.id] || 0)} L)`,
    }));

  // Vasilhames No Pátio
  const vasilhamesNoPatio = vasilhames
    .filter(
      (v) =>
        v.status === "No Pátio" &&
        (v.produto_id === produtoId ||
          v.produto_nome?.toLowerCase() === produtoNome?.toLowerCase())
    )
    .map((v) => ({
      ...v,
      saldo_atual: v.volume || 0,
      unidade_medida: "L",
      display_label: `${v.placa || v.barril || v.codigo || "Vasilhame"} - ${v.produto_nome || ""} (${formatVolume(v.volume || 0)} L)`,
    }));

  // Entradas embaladas com saldo > 0 (saídas fiscais já descontadas no saldo_atual)
  const entradasEmbaladas = entradas
    .filter(
      (e) =>
        e.embalado === true &&
        (e.produto_id === produtoId || e.produto_nome === produtoNome) &&
        (e.saldo_atual || 0) > 0
    )
    .map((e) => ({
      ...e,
      display_label: `${entradaIdMap[e.id] || "E000"} - ${e.produto_nome || ""}`,
    }));

  // Saldo consumido por fonte (para excluir fontes esgotadas em origens subsequentes)
  const consumedBySource = {};
  origens.forEach((o) => {
    if (o.entrada_id) {
      consumedBySource[o.entrada_id] = (consumedBySource[o.entrada_id] || 0) + (o.volume_retirado || 0);
    }
  });

  const filterOptionsForOrigem = (options, currentOrigem) =>
    options.filter((opt) => {
      if (opt.id === currentOrigem.entrada_id) return true;
      const consumedL = roundVolume(consumedBySource[opt.id] || 0);
      const saldo = opt.saldo_atual || 0;
      const unid = opt.unidade_medida || "L";
      const saldoL =
        unid === "kg" && densidade > 0
          ? roundVolume(saldo / densidade)
          : roundVolume(saldo);
      return saldoL - consumedL > 0;
    });

  const volumeOrigens = roundVolume(
    origens.reduce((sum, o) => sum + (o.volume_retirado || 0), 0)
  );
  const volumeDestinos = roundVolume(
    destinos.reduce((sum, d) => sum + (d.volume_total || 0), 0)
  );
  const volumeDiff = Math.abs(volumeOrigens - volumeDestinos);
  const massaTotal = roundMass(volumeOrigens * densidade);
  const volumesMatch = volumeDiff === 0;

  const tankaExcedido = destinos.some((d) => {
    if (d.tipo_embalagem !== "Tankagem" || !d.tanka_id) return false;
    const tanka = isotanques.find((i) => i.id === d.tanka_id);
    return tanka && tanka.capacidade > 0 && (d.volume || 0) > tanka.capacidade;
  });

  const allOrigemOptions = [
    ...filteredEntradas,
    ...tankasComSaldo,
    ...vasilhamesNoPatio,
    ...entradasEmbaladas,
  ];

  const saldoExcedido = origens.some((o) => {
    const src = allOrigemOptions.find((opt) => opt.id === o.entrada_id);
    if (!src) {
      if (o.tipo_origem === "entrada" && o.saldo_disponivel != null) {
        return roundVolume(o.volume_retirado) > roundVolume(o.saldo_disponivel);
      }
      return false;
    }
    const saldo = src.saldo_atual || 0;
    const unid = src.unidade_medida || "L";
    const saldoL =
      unid === "kg" && densidade > 0
        ? roundVolume(saldo / densidade)
        : roundVolume(saldo);
    return roundVolume(o.volume_retirado) > saldoL;
  });

  const handleClienteChange = (label, item) => {
    setClienteNome(label);
    setClienteId(item?.id || "");
    setProdutoId("");
    setProdutoNome("");
    setProdutoCodigo("");
    setProdutoDisplay("");
    setDensidade(0);
    setOrigens([]);
  };

  const handleProdutoChange = (label, item) => {
    setProdutoDisplay(label);
    if (item) {
      setProdutoId(item.id);
      setProdutoNome(item.produto);
      setProdutoCodigo(item.codigo || "");
      setDensidade(parseDensidade(item.densidade));
    } else {
      setProdutoId("");
      setProdutoNome("");
      setProdutoCodigo("");
      setDensidade(0);
    }
    setOrigens([]);
  };

  const toggleOperador = (op) => {
    setOperadores((prev) =>
      prev.includes(op) ? prev.filter((o) => o !== op) : [...prev, op]
    );
  };

  const handleAddOrigem = () => {
    setOrigens((prev) => [
      ...prev,
      { tipo_origem: "", entrada_id: "", entrada_codigo: "", lote: "", volume_retirado: 0, massa_retirada: 0, saldo_restante: 0 },
    ]);
  };

  const handleUpdateOrigem = (idx, data) => {
    const vol = roundVolume(data.volume_retirado);
    const massa = roundMass(vol * densidade);
    setOrigens((prev) =>
      prev.map((o, i) =>
        i === idx ? { ...data, volume_retirado: vol, massa_retirada: massa } : o
      )
    );
  };

  const handleRemoveOrigem = (idx) => {
    setOrigens((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddDestino = () => {
    setCollapsedDestinos(
      Object.fromEntries(destinos.map((_, i) => [i, true]))
    );
    setDestinos((prev) => [...prev, { tipo_embalagem: "", volume_total: 0 }]);
  };

  const handleUpdateDestino = (idx, data) => {
    setDestinos((prev) => prev.map((d, i) => (i === idx ? data : d)));
  };

  const handleRemoveDestino = (idx) => {
    setDestinos((prev) => prev.filter((_, i) => i !== idx));
    setCollapsedDestinos((prev) => {
      const next = {};
      Object.keys(prev).forEach((key) => {
        const i = Number(key);
        if (i < idx) next[i] = prev[i];
        else if (i > idx) next[i - 1] = prev[i];
      });
      return next;
    });
  };

  const toggleDestinoCollapse = (idx) => {
    setCollapsedDestinos((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const buildPayload = () => {
    const origensNorm = origens.map((o) => ({
      ...o,
      volume_retirado: roundVolume(o.volume_retirado),
      massa_retirada: roundMass(roundVolume(o.volume_retirado) * densidade),
      saldo_disponivel: roundVolume(o.saldo_disponivel),
      saldo_restante: roundVolume(o.saldo_restante),
    }));
    const destinosNorm = destinos.map((d) => {
      const volume_total = roundVolume(d.volume_total || d.volume || 0);
      return {
        ...d,
        volume: roundVolume(d.volume || volume_total),
        volume_total,
        volume_por_embalagem: roundVolume(d.volume_por_embalagem || 0),
        quantidade_embalagens: Math.round(d.quantidade_embalagens || 0),
        tara: roundMass(d.tara || 0),
        peso_liquido: roundMass(
          d.peso_liquido || (densidade > 0 ? volume_total * densidade : 0)
        ),
        peso_bruto: roundMass(d.peso_bruto || 0),
      };
    });

    return {
      data,
      cliente_id: clienteId || null,
      cliente_nome: clienteNome,
      produto_id: produtoId || null,
      produto_nome: produtoNome,
      produto_codigo: produtoCodigo,
      densidade: String(densidade),
      volume_total: volumeOrigens,
      massa_total: massaTotal,
      operadores,
      observacoes,
      origens: origensNorm,
      destinos: destinosNorm,
    };
  };

  const buildConfirmMessage = (destinosNorm) => {
    const fracionados = destinosNorm.filter((d) => d.fracionado);
    if (fracionados.length === 0) {
      return "Para esta operação nenhuma embalagem ficou fracionada, confirma essa informação?";
    }
    return fracionados
      .map((d) => {
        const item = destinoItemLabel(d);
        let vol = roundVolume(d.volume_total || d.volume || 0);
        if (
          d.tipo_embalagem === "Vasilhame" &&
          d.vasilhame_existente_id
        ) {
          const existente = vasilhames.find(
            (v) => v.id === d.vasilhame_existente_id
          );
          if (existente?.fracionado) {
            vol = roundVolume((existente.volume || 0) + vol);
          }
        }
        const massa = roundMass(densidade > 0 ? vol * densidade : destinoMassaKg(d, densidade));
        return `Após confirmação o item ${item} ficará fracionado com ${formatVolume(vol)} L e ${formatMass(massa)} kg.`;
      })
      .join("\n");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!clienteNome) {
      setError("Cliente é obrigatório.");
      return;
    }
    if (!produtoId && !produtoNome) {
      setError("Produto é obrigatório.");
      return;
    }
    if (operadores.length === 0) {
      setError("Selecione ao menos um operador.");
      return;
    }
    if (origens.length === 0) {
      setError("Adicione ao menos uma origem.");
      return;
    }
    if (origens.some((o) => !o.tipo_origem)) {
      setError("Todas as origens devem ter um tipo selecionado.");
      return;
    }
    if (origens.some((o) => !o.entrada_id)) {
      setError("Todas as origens devem ter uma origem selecionada.");
      return;
    }
    if (origens.some((o) => !o.volume_retirado || o.volume_retirado <= 0)) {
      setError("Todas as origens devem ter um volume retirado maior que zero.");
      return;
    }
    if (saldoExcedido) {
      setError("Uma ou mais origens têm volume superior ao saldo disponível.");
      return;
    }
    if (destinos.length === 0) {
      setError("Adicione ao menos um destino.");
      return;
    }
    if (destinos.some((d) => !d.tipo_embalagem)) {
      setError("Todos os destinos devem ter um tipo de embalagem selecionado.");
      return;
    }
    if (
      destinos.some(
        (d) =>
          (d.tipo_embalagem === "One Way (IBC)" ||
            d.tipo_embalagem === "Bombona 200 L" ||
            d.tipo_embalagem === "Tambor 200 L") &&
          (!(d.quantidade_embalagens > 0) || !(d.volume_por_embalagem > 0))
      )
    ) {
      setError(
        "Informe quantidade de embalagens e volume por embalagem nos destinos IBC/Bombona/Tambor."
      );
      return;
    }
    if (tankaExcedido) {
      setError("Um ou mais destinos excedem a capacidade do tanka.");
      return;
    }
    if (!volumesMatch) {
      setError(
        "O volume total das origens deve ser exatamente igual ao volume total dos destinos. Verifique os valores informados."
      );
      return;
    }

    setError("");
    const payload = buildPayload();
    setPendingPayload(payload);
    setConfirmMessage(buildConfirmMessage(payload.destinos));
    setConfirmOpen(true);
  };

  const handleConfirmSave = async () => {
    if (!pendingPayload) return;
    setConfirmOpen(false);
    setSaving(true);
    setError("");
    try {
      await onSave(pendingPayload);
    } finally {
      setSaving(false);
      setPendingPayload(null);
    }
  };

  const title = readOnly
    ? "Visualizar Transbordo"
    : editingTransbordo
    ? "Editar Transbordo"
    : "Novo Transbordo";

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {(error || externalError) && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error || externalError}
            </div>
          )}

          {/* Dados Gerais */}
          <div>
            <h3 className="text-sm font-semibold text-primary mb-3">Dados Gerais</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Data *</Label>
                <Input
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                  disabled={readOnly}
                  className={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Cliente *</Label>
                <SearchableSelect
                  value={clienteNome}
                  onChange={handleClienteChange}
                  options={clientesComProdutos}
                  getOptionLabel={(c) => c.nome}
                  getOptionValue={(c) => c.id}
                  placeholder="Selecione um cliente"
                  disabled={readOnly}
                  inputClassName={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Produto *</Label>
                <SearchableSelect
                  value={produtoDisplay}
                  onChange={handleProdutoChange}
                  options={produtosComSaldo}
                  getOptionLabel={(p) => `${p.codigo || ""} - ${p.produto}`}
                  getOptionValue={(p) => p.id}
                  placeholder={clienteNome ? "Selecione um produto" : "Selecione um cliente primeiro"}
                  disabled={readOnly || !clienteNome}
                  inputClassName={INPUT_EDITABLE}
                />
              </div>
            </div>

            {/* Operadores Multi-Select */}
            <div className="mt-4 space-y-1.5">
              <Label>Operadores *</Label>
              <div className="relative" ref={operadoresRef}>
                <button
                  type="button"
                  onClick={() => !readOnly && setOperadoresOpen(!operadoresOpen)}
                  disabled={readOnly}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-md border border-border bg-white text-sm hover:border-slate-400 transition-colors disabled:bg-muted/40 disabled:cursor-not-allowed"
                >
                  <span className={operadores.length ? "text-foreground" : "text-muted-foreground"}>
                    {operadores.length
                      ? `${operadores.length} operador(es) selecionado(s)`
                      : "Selecionar operadores"}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${operadoresOpen ? "rotate-180" : ""}`} />
                </button>
                {operadoresOpen && !readOnly && (
                  <div className="absolute z-50 mt-1 w-full bg-card rounded-md border border-border shadow-lg overflow-hidden">
                    <div className="max-h-48 overflow-y-auto">
                      {OPERADORES.map((op) => (
                        <label
                          key={op}
                          className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40"
                        >
                          <input
                            type="checkbox"
                            checked={operadores.includes(op)}
                            onChange={() => toggleOperador(op)}
                            className="w-4 h-4 rounded border-border"
                          />
                          <span className="text-foreground/80">{op}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {operadores.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {operadores.map((op) => (
                    <span key={op} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                      {op}
                      {!readOnly && (
                        <button type="button" onClick={() => toggleOperador(op)} className="hover:text-blue-900">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 space-y-1.5">
              <Label>Observações</Label>
              <Input
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Observações..."
                disabled={readOnly}
                className={INPUT_EDITABLE}
              />
            </div>
          </div>

          {/* Origens */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-primary">Origens</h3>
              {!readOnly && (
                <Button type="button" variant="outline" size="sm" onClick={handleAddOrigem} disabled={!produtoId && !produtoNome}>
                  <Plus className="w-4 h-4 mr-1" />
                  Adicionar Origem
                </Button>
              )}
            </div>
            <div className="space-y-3">
              {origens.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4 border border-dashed border-border rounded-lg">
                  Nenhuma origem adicionada.
                </p>
              ) : (
                origens.map((origem, idx) => (
                  <OrigemCard
                    key={idx}
                    index={idx}
                    origem={origem}
                    entradaOptions={filterOptionsForOrigem(filteredEntradas, origem)}
                    tankaOptions={filterOptionsForOrigem(tankasComSaldo, origem)}
                    vasilhameOptions={filterOptionsForOrigem(vasilhamesNoPatio, origem)}
                    embaladoOptions={filterOptionsForOrigem(entradasEmbaladas, origem)}
                    densidade={densidade}
                    onChange={(data) => handleUpdateOrigem(idx, data)}
                    onRemove={() => handleRemoveOrigem(idx)}
                    readOnly={readOnly}
                  />
                ))
              )}
            </div>
          </div>

          {/* Destinos */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-primary">Destinos</h3>
              {!readOnly && (
                <Button type="button" variant="outline" size="sm" onClick={handleAddDestino}>
                  <Plus className="w-4 h-4 mr-1" />
                  Adicionar Destino
                </Button>
              )}
            </div>
            <div className="space-y-3">
              {destinos.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4 border border-dashed border-border rounded-lg">
                  Nenhum destino adicionado.
                </p>
              ) : (
                destinos.map((destino, idx) => (
                  <DestinoCard
                    key={idx}
                    index={idx}
                    destino={destino}
                    isotanques={filteredIsotanques}
                    vasilhames={vasilhames}
                    produtoId={produtoId}
                    produtoNome={produtoNome}
                    densidade={densidade}
                    onChange={(data) => handleUpdateDestino(idx, data)}
                    onRemove={() => handleRemoveDestino(idx)}
                    readOnly={readOnly}
                    collapsed={!!collapsedDestinos[idx]}
                    onToggleCollapse={() => toggleDestinoCollapse(idx)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Conferência de Volume */}
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <h3 className="text-sm font-semibold text-primary mb-3">Conferência de Volume</h3>
            <div className="grid grid-cols-3 gap-4 items-center">
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">Volume Total Origens</p>
                <p className="text-lg font-bold text-foreground">{formatVolume(volumeOrigens)} L</p>
              </div>
              <div className="text-center">
                {volumesMatch && volumeOrigens > 0 ? (
                  <div className="flex flex-col items-center">
                    <CheckCircle2 className="w-8 h-8 text-green-600 mb-1" />
                    <span className="text-xs text-green-600 font-medium">Conferência OK</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <AlertCircle className="w-8 h-8 text-red-500 mb-1" />
                    <span className="text-xs text-red-500 font-medium">Divergência</span>
                  </div>
                )}
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">Volume Total Destinos</p>
                <p className="text-lg font-bold text-foreground">{formatVolume(volumeDestinos)} L</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border flex justify-between text-sm">
              <span className="text-muted-foreground">
                Massa Total: <span className="font-medium text-foreground">{formatMass(massaTotal)} kg</span>
              </span>
              <span className="text-muted-foreground">
                Diferença: <span className={`font-medium ${volumesMatch ? "text-green-600" : "text-red-600"}`}>
                  {formatVolume(volumeDiff)} L
                </span>
              </span>
            </div>
          </div>

          {!readOnly && (
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                type="submit"
                className="bg-primary hover:bg-primary/90"
                disabled={saving}
              >
                {saving
                  ? "Salvando..."
                  : editingTransbordo
                  ? "Salvar Alterações"
                  : "Registrar Transbordo"}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(v) => {
          if (!v) {
            setConfirmOpen(false);
            setPendingPayload(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar transbordo</AlertDialogTitle>
            <AlertDialogDescription className="text-foreground/80 whitespace-pre-wrap">
              {confirmMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmSave();
              }}
              disabled={saving}
              className="bg-primary hover:bg-primary/90"
            >
              {saving ? "Salvando..." : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}