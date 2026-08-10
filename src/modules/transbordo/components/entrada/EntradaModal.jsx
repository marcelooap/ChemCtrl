import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
import { Switch } from "@shared/components/ui/switch";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import LoteBlock, { emptyLote } from "@transbordo/components/entrada/LoteBlock";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import { AlertCircle, ArrowRight, CheckCircle, Plus } from "lucide-react";
import { formatMass, formatNum } from "@transbordo/lib/format";
import { loteToKg } from "@transbordo/lib/conversao";
import { resolveTipoRecebimento } from "@transbordo/lib/tipoRecebimento";
import { entities } from "@transbordo/services/entities";
import {
  findLinkedTransbordo,
  findAllLinkedTransbordos,
  multipleTransbordosMessage,
} from "@transbordo/lib/findLinkedTransbordo";

function mapLoteFromEntrada(l, entrada = {}) {
  const embalado =
    l.embalado != null ? l.embalado : entrada.embalado || false;
  const tipo = resolveTipoRecebimento({
    ...l,
    embalado,
    tipo_recebimento: l.tipo_recebimento || entrada.tipo_recebimento,
  });

  return {
    produto_id: l.produto_id || entrada.produto_id || "",
    produto_nome: l.produto_nome || entrada.produto_nome || "",
    produto_codigo: l.produto_codigo || entrada.produto_codigo || "",
    nota_fiscal: l.nota_fiscal || "",
    lote: l.lote || "",
    densidade: l.densidade || "",
    quantidade: l.quantidade != null ? String(l.quantidade) : "",
    unidade_medida: l.unidade_medida || "",
    data_fabricacao: l.data_fabricacao || "",
    data_validade: l.data_validade || "",
    preco_unitario:
      l.preco_unitario != null
        ? String(l.preco_unitario)
        : entrada.preco_unitario != null
          ? String(entrada.preco_unitario)
          : "",
    tipo_recebimento: tipo,
    embalado: tipo === "embalado",
    peso_liquido:
      l.peso_liquido != null
        ? String(l.peso_liquido)
        : entrada.peso_liquido != null
          ? String(entrada.peso_liquido)
          : "",
    quantidade_embalagens:
      l.quantidade_embalagens != null
        ? String(l.quantidade_embalagens)
        : entrada.quantidade_embalagens != null
          ? String(entrada.quantidade_embalagens)
          : "",
    placa: l.placa || "",
    barril: l.barril || "",
    volume: l.volume != null && l.volume !== "" ? String(l.volume) : "",
    tara: l.tara != null && l.tara !== "" ? String(l.tara) : "",
    lacres: l.lacres || "",
    eslinga: l.eslinga || "",
    gps: l.gps || "",
    menor_teste: l.menor_teste || "",
    fracionado: l.fracionado || false,
    vasilhame_existente_id: l.vasilhame_existente_id || null,
    vasilhame_id: l.vasilhame_id || null,
    peso_bruto:
      l.peso_bruto != null && l.peso_bruto !== "" ? String(l.peso_bruto) : "",
  };
}

const INPUT_EDITABLE = "bg-white";

const todayISO = () => {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

function resolveEntradaData(entrada) {
  if (!entrada) return todayISO();
  if (entrada.data) return String(entrada.data).slice(0, 10);
  const raw = entrada.created_at || entrada.created_date;
  if (!raw) return todayISO();
  return String(raw).slice(0, 10);
}

export default function EntradaModal({
  open,
  onClose,
  onSave,
  editingEntrada,
  readOnly,
  clientes,
  produtos,
  transbordos: transbordosProp = [],
  estoque: estoqueProp = [],
}) {
  const [dataEntrada, setDataEntrada] = useState(todayISO);
  const [clienteId, setClienteId] = useState("");
  const [clienteNome, setClienteNome] = useState("");
  const [lotes, setLotes] = useState([emptyLote()]);
  const [statusWms, setStatusWms] = useState(false);
  const [granelPesagem, setGranelPesagem] = useState(false);
  const [granelTicket, setGranelTicket] = useState("");
  const [granelPesoBruto, setGranelPesoBruto] = useState("");
  const [granelPesoLiquido, setGranelPesoLiquido] = useState("");
  const [error, setError] = useState("");
  const [collapsedLotes, setCollapsedLotes] = useState({});
  const [transbordoBlockMessage, setTransbordoBlockMessage] = useState("");
  const [checkingTransbordos, setCheckingTransbordos] = useState(false);
  const [vasilhames, setVasilhames] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    entities.vasilhames
      .list()
      .then((list) => {
        if (!cancelled) setVasilhames(list || []);
      })
      .catch(() => {
        if (!cancelled) setVasilhames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Bloqueia "Ir para Transbordo" quando há cadeia com 2+ OPs
  useEffect(() => {
    if (!open || !editingEntrada?.id || readOnly) {
      setTransbordoBlockMessage("");
      return;
    }

    let cancelled = false;
    const check = async () => {
      setCheckingTransbordos(true);
      try {
        const [allTransbordos, estoqueDaEntrada, vasilhamesList] =
          await Promise.all([
            transbordosProp?.length
              ? Promise.resolve(transbordosProp)
              : entities.transbordos.list("-created_date"),
            entities.estoque.filter({ entrada_id: editingEntrada.id }),
            entities.vasilhames.list(),
          ]);

        const prefill = {
          id: editingEntrada.id,
          produto_id: editingEntrada.produto_id,
          produto_nome: editingEntrada.produto_nome,
          lote: editingEntrada.lote,
          lotes: editingEntrada.lotes,
          savedEstoques: estoqueDaEntrada,
        };

        const linked = findAllLinkedTransbordos(
          allTransbordos,
          prefill,
          estoqueDaEntrada.length ? estoqueDaEntrada : estoqueProp,
          vasilhamesList
        );

        if (!cancelled) {
          setTransbordoBlockMessage(
            linked.length > 1 ? multipleTransbordosMessage(linked) : ""
          );
        }
      } catch {
        if (!cancelled) setTransbordoBlockMessage("");
      } finally {
        if (!cancelled) setCheckingTransbordos(false);
      }
    };

    check();
    return () => {
      cancelled = true;
    };
  }, [open, editingEntrada, readOnly, transbordosProp, estoqueProp]);

  useEffect(() => {
    if (!open) return;
    if (editingEntrada) {
      setDataEntrada(resolveEntradaData(editingEntrada));
      setClienteId(editingEntrada.cliente_id || "");
      setClienteNome(editingEntrada.cliente_nome || "");
      const lotesCarregados =
        editingEntrada.lotes && editingEntrada.lotes.length > 0
          ? editingEntrada.lotes.map((l) => mapLoteFromEntrada(l, editingEntrada))
          : [
              mapLoteFromEntrada(
                {
                  produto_id: editingEntrada.produto_id || "",
                  produto_nome: editingEntrada.produto_nome || "",
                  produto_codigo: editingEntrada.produto_codigo || "",
                  nota_fiscal: editingEntrada.nota_fiscal || "",
                  lote: editingEntrada.lote || "",
                  densidade: editingEntrada.densidade || "",
                  quantidade: editingEntrada.quantidade,
                  unidade_medida: editingEntrada.unidade_medida || "",
                  data_fabricacao: editingEntrada.data_fabricacao || "",
                  data_validade: editingEntrada.data_validade || "",
                  preco_unitario: editingEntrada.preco_unitario,
                  embalado: editingEntrada.embalado || false,
                  tipo_recebimento: editingEntrada.tipo_recebimento,
                  peso_liquido: editingEntrada.peso_liquido,
                  quantidade_embalagens: editingEntrada.quantidade_embalagens,
                  placa: editingEntrada.placa,
                  barril: editingEntrada.barril,
                  volume: editingEntrada.volume,
                  tara: editingEntrada.tara,
                  lacres: editingEntrada.lacres,
                  eslinga: editingEntrada.eslinga,
                  gps: editingEntrada.gps,
                  menor_teste: editingEntrada.menor_teste,
                  fracionado: editingEntrada.fracionado,
                  vasilhame_existente_id: editingEntrada.vasilhame_existente_id,
                  peso_bruto: editingEntrada.peso_bruto,
                },
                editingEntrada
              ),
            ];
      setLotes(lotesCarregados);
      setCollapsedLotes(
        Object.fromEntries(lotesCarregados.map((_, i) => [i, true]))
      );
      setStatusWms(editingEntrada.status_wms || false);
      setGranelPesagem(editingEntrada.granel_pesagem || false);
      setGranelTicket(editingEntrada.granel_ticket || "");
      setGranelPesoBruto(
        editingEntrada.granel_peso_bruto != null
          ? String(editingEntrada.granel_peso_bruto)
          : ""
      );
      setGranelPesoLiquido(
        editingEntrada.granel_peso_liquido != null
          ? String(editingEntrada.granel_peso_liquido)
          : ""
      );
    } else {
      setDataEntrada(todayISO());
      setClienteId("");
      setClienteNome("");
      setLotes([emptyLote()]);
      setCollapsedLotes({});
      setStatusWms(false);
      setGranelPesagem(false);
      setGranelTicket("");
      setGranelPesoBruto("");
      setGranelPesoLiquido("");
    }
    setError("");
  }, [editingEntrada, open]);

  const clientesComProdutos = (() => {
    const byNome = new Map();

    for (const c of clientes) {
      const nome = c.nome?.trim();
      if (!nome) continue;
      const key = nome.toLowerCase();
      if (!byNome.has(key)) {
        byNome.set(key, { id: c.id || "", nome });
      }
    }

    for (const p of produtos) {
      const nome = p.cliente_nome?.trim();
      if (!nome) continue;
      const key = nome.toLowerCase();
      if (!byNome.has(key)) {
        byNome.set(key, {
          id: p.cliente_id || "",
          nome,
        });
      }
    }

    return [...byNome.values()].sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR")
    );
  })();

  const filteredProdutos = !clienteNome
    ? []
    : produtos.filter((p) => {
        if (clienteId && p.cliente_id) {
          return p.cliente_id === clienteId;
        }
        return (
          p.cliente_nome?.toLowerCase() === clienteNome.toLowerCase()
        );
      });

  // ── Totais derivados dos lotes ──
  const qtd = lotes.reduce(
    (sum, l) => sum + (parseFloat(l.quantidade) || 0),
    0
  );

  // ── Quantidade operacional somando todos os lotes ──
  const qtdKg = lotes.reduce((sum, l) => sum + loteToKg(l), 0);

  // ── Verifica se todos os lotes têm o mesmo produto ──
  const allSameProduct =
    lotes.length > 0 &&
    lotes.every((l) => l.produto_id && l.produto_id === lotes[0].produto_id);

  const hasGranel = lotes.some(
    (l) => resolveTipoRecebimento(l) === "granel"
  );
  const blockIrParaTransbordo = lotes.some(
    (l) => resolveTipoRecebimento(l) !== "granel"
  );
  const showPesagemGranel = hasGranel;
  const granelPesagemAtiva = showPesagemGranel && granelPesagem;

  // ── Custo total somando todos os lotes ──
  const custoTotal = lotes.reduce((sum, l) => {
    const lQtd = parseFloat(l.quantidade) || 0;
    const lPreco = parseFloat(l.preco_unitario) || 0;
    return sum + lQtd * lPreco;
  }, 0);

  // ── Pesagem Granel ──
  const gPb = parseFloat(granelPesoBruto) || 0;
  const gPl = parseFloat(granelPesoLiquido) || 0;
  const valBruto = gPb >= 10000 && gPb <= 40000 ? 60 : 80;
  const valLiquido = gPl >= 10000 && gPl <= 40000 ? 60 : 80;
  const erroAdmissivel = granelPesagemAtiva ? valBruto + valLiquido : 0;
  const pesoMinimo = qtdKg - erroAdmissivel;
  const pesoMaximo = qtdKg + erroAdmissivel;
  const dentroMargem =
    granelPesagemAtiva && gPl > 0 && gPl >= pesoMinimo && gPl <= pesoMaximo;
  const foraMargem = granelPesagemAtiva && gPl > 0 && !dentroMargem;

  // ── Handlers dos lotes ──
  const addLote = () => {
    setCollapsedLotes(
      Object.fromEntries(lotes.map((_, i) => [i, true]))
    );
    setLotes((prev) => [
      ...prev,
      {
        ...emptyLote(),
        unidade_medida: prev[0]?.unidade_medida || "",
      },
    ]);
  };

  const removeLote = (index) => {
    setLotes((prev) => prev.filter((_, i) => i !== index));
    setCollapsedLotes((prev) => {
      const next = {};
      Object.keys(prev).forEach((key) => {
        const i = Number(key);
        if (i < index) next[i] = prev[i];
        else if (i > index) next[i - 1] = prev[i];
      });
      return next;
    });
  };

  const updateLote = (index, data) =>
    setLotes((prev) => prev.map((l, i) => (i === index ? data : l)));

  const toggleLoteCollapse = (index) => {
    setCollapsedLotes((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const validateAndBuildData = () => {
    if (!dataEntrada) {
      setError("Data da entrada é obrigatória.");
      return null;
    }
    if (!clienteNome) {
      setError("Cliente é obrigatório.");
      return null;
    }
    if (lotes.length === 0) {
      setError("Adicione pelo menos um bloco de lote.");
      return null;
    }

    for (let i = 0; i < lotes.length; i++) {
      const l = lotes[i];
      const tipo = resolveTipoRecebimento(l);
      if (!l.produto_id) {
        setError(`Produto é obrigatório no bloco ${i + 1}.`);
        return null;
      }
      if (!l.nota_fiscal) {
        setError(`Nota Fiscal é obrigatória no bloco ${i + 1}.`);
        return null;
      }
      if (!l.lote) {
        setError(`Lote é obrigatório no bloco ${i + 1}.`);
        return null;
      }

      if (tipo === "vasilhame") {
        const lProduto = produtos.find((p) => p.id === l.produto_id);
        const lDensidadeTabelada = lProduto?.densidade_tabelada || false;
        if (!lDensidadeTabelada && !l.densidade) {
          setError(`Densidade é obrigatória no bloco ${i + 1}.`);
          return null;
        }
        if (!l.placa?.trim()) {
          setError(`Nº da Placa é obrigatório no bloco ${i + 1}.`);
          return null;
        }
        const vol = parseFloat(l.volume) || 0;
        if (!l.volume || vol <= 0) {
          setError(`Volume deve ser positivo no bloco ${i + 1}.`);
          return null;
        }
        continue;
      }

      const lQtd = parseFloat(l.quantidade) || 0;
      if (!l.quantidade || lQtd <= 0) {
        setError(`Quantidade deve ser positiva no bloco ${i + 1}.`);
        return null;
      }
      if (!l.unidade_medida) {
        setError(`Unidade de Medida é obrigatória no bloco ${i + 1}.`);
        return null;
      }
      if (tipo !== "embalado") {
        const lProduto = produtos.find((p) => p.id === l.produto_id);
        const lDensidadeTabelada = lProduto?.densidade_tabelada || false;
        if (!lDensidadeTabelada && !l.densidade) {
          setError(`Densidade é obrigatória no bloco ${i + 1}.`);
          return null;
        }
      }
      if (tipo === "embalado") {
        const lPeso = parseFloat(l.peso_liquido) || 0;
        const lQtdEmb = parseFloat(l.quantidade_embalagens) || 0;
        const lTotalCalc = lPeso * lQtdEmb;
        if (Math.abs(lTotalCalc - lQtd) > 0.001) {
          setError(
            `A soma do peso líquido das embalagens deve ser igual à quantidade no bloco ${i + 1}.`
          );
          return null;
        }
      }
    }

    const parsedLotes = lotes.map((l) => {
      const tipo = resolveTipoRecebimento(l);
      const isEmbalado = tipo === "embalado";
      const isVasilhame = tipo === "vasilhame";
      const volume = isVasilhame ? parseFloat(l.volume) || 0 : null;
      const tara = isVasilhame ? parseFloat(l.tara) || 0 : null;
      const pesoLiquido = isEmbalado || isVasilhame
        ? parseFloat(l.peso_liquido) || 0
        : null;
      const pesoBruto = isVasilhame ? parseFloat(l.peso_bruto) || 0 : null;

      return {
        produto_id: l.produto_id,
        produto_nome: l.produto_nome,
        produto_codigo: l.produto_codigo,
        nota_fiscal: l.nota_fiscal,
        lote: l.lote,
        densidade: isEmbalado ? null : l.densidade,
        quantidade: isVasilhame
          ? volume
          : parseFloat(l.quantidade) || 0,
        unidade_medida: isVasilhame ? "L" : l.unidade_medida,
        data_fabricacao: l.data_fabricacao,
        data_validade: l.data_validade,
        preco_unitario: parseFloat(l.preco_unitario) || 0,
        tipo_recebimento: tipo,
        embalado: isEmbalado,
        peso_liquido: pesoLiquido,
        quantidade_embalagens: isEmbalado
          ? parseFloat(l.quantidade_embalagens) || 0
          : null,
        ...(isVasilhame
          ? {
              placa: l.placa || "",
              barril: l.barril || "",
              volume,
              tara,
              lacres: l.lacres || "",
              eslinga: l.eslinga || "",
              gps: l.gps || "",
              menor_teste: l.menor_teste || "",
              fracionado: l.fracionado || false,
              vasilhame_existente_id: l.vasilhame_existente_id || null,
              vasilhame_id: l.vasilhame_id || null,
              peso_bruto: pesoBruto,
            }
          : {}),
      };
    });

    const firstLote = parsedLotes[0];

    return {
      data: dataEntrada || todayISO(),
      cliente_id: clienteId,
      cliente_nome: clienteNome,
      produto_id: firstLote.produto_id,
      produto_nome: firstLote.produto_nome,
      produto_codigo: firstLote.produto_codigo,
      nota_fiscal: firstLote.nota_fiscal,
      lote: firstLote.lote,
      densidade: firstLote.densidade,
      data_fabricacao: firstLote.data_fabricacao,
      data_validade: firstLote.data_validade,
      quantidade: qtdKg,
      unidade_medida: "kg",
      preco_unitario: firstLote.preco_unitario,
      custo_total: custoTotal,
      saldo_atual: editingEntrada?.saldo_atual ?? qtdKg,
      embalado: firstLote.embalado,
      peso_liquido:
        firstLote.embalado || firstLote.tipo_recebimento === "vasilhame"
          ? firstLote.peso_liquido
          : null,
      quantidade_embalagens: firstLote.embalado
        ? firstLote.quantidade_embalagens
        : null,
      status_wms: statusWms,
      granel_pesagem: granelPesagemAtiva,
      granel_ticket: granelPesagemAtiva ? granelTicket : null,
      granel_peso_bruto: granelPesagemAtiva ? gPb : null,
      granel_validacao_bruto: granelPesagemAtiva ? valBruto : null,
      granel_peso_liquido: granelPesagemAtiva ? gPl : null,
      granel_validacao_liquido: granelPesagemAtiva ? valLiquido : null,
      granel_erro_admissivel: granelPesagemAtiva ? erroAdmissivel : null,
      granel_peso_minimo: granelPesagemAtiva ? pesoMinimo : null,
      granel_peso_maximo: granelPesagemAtiva ? pesoMaximo : null,
      granel_margem:
        granelPesagemAtiva && gPl > 0 ? (dentroMargem ? "dentro" : "fora") : null,
      grupo_entrada: editingEntrada?.grupo_entrada || `GRP-${Date.now()}`,
      origem: editingEntrada?.origem || "convencional",
      lotes: parsedLotes,
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const data = validateAndBuildData();
    if (!data) return;
    try {
      await onSave(data);
    } catch (err) {
      setError(err?.message || "Não foi possível salvar. Tente novamente.");
    }
  };

  const handleSaveAndTransbordo = async () => {
    const data = validateAndBuildData();
    if (!data) return;

    if (transbordoBlockMessage) {
      setError(transbordoBlockMessage);
      return;
    }

    let saved;
    try {
      saved = await onSave(data);
    } catch (err) {
      setError(err?.message || "Não foi possível salvar. Tente novamente.");
      return;
    }
    if (saved) {
      const savedEstoques = Array.isArray(saved)
        ? saved
        : saved.savedEstoques || [];
      const savedEntrada = Array.isArray(saved) ? null : saved.savedEntrada;
      const prefillEntrada = {
        ...data,
        id: savedEntrada?.id,
        entrada_codigo: saved.entrada_codigo,
        savedEstoques,
      };

      // Revalida cadeia após salvar (pode ter OPs posteriores)
      let linkedTransbordo = null;
      try {
        const [allTransbordos, estoqueDaEntrada, vasilhamesList] =
          await Promise.all([
            entities.transbordos.list("-created_date"),
            savedEntrada?.id
              ? entities.estoque.filter({ entrada_id: savedEntrada.id })
              : Promise.resolve(savedEstoques),
            entities.vasilhames.list(),
          ]);

        const linked = findAllLinkedTransbordos(
          allTransbordos,
          prefillEntrada,
          estoqueDaEntrada,
          vasilhamesList
        );

        if (linked.length > 1) {
          const msg = multipleTransbordosMessage(linked);
          setTransbordoBlockMessage(msg);
          setError(msg);
          return;
        }

        linkedTransbordo = findLinkedTransbordo(
          allTransbordos,
          prefillEntrada,
          estoqueDaEntrada,
          vasilhamesList
        );
      } catch {
        linkedTransbordo = null;
      }

      navigate("/chemflow/transbordo", {
        state: {
          prefillEntrada,
          linkedTransbordoId: linkedTransbordo?.id || null,
          linkedTransbordo: linkedTransbordo || null,
        },
      });
    }
  };

  const title = readOnly
    ? "Visualizar Entrada"
    : editingEntrada
    ? "Editar Entrada"
    : "Nova Entrada";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Data + Cliente */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Data *</Label>
              <Input
                type="date"
                value={dataEntrada}
                onChange={(e) => setDataEntrada(e.target.value)}
                disabled={readOnly}
                className={INPUT_EDITABLE}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cliente *</Label>
              <SearchableSelect
                value={clienteNome}
                onChange={(label, item) => {
                  setClienteNome(label);
                  setClienteId(item?.id || "");
                  setLotes((prev) =>
                    prev.map((l) => ({
                      ...l,
                      produto_id: "",
                      produto_nome: "",
                      produto_codigo: "",
                      densidade: "",
                    }))
                  );
                }}
                options={clientesComProdutos}
                getOptionLabel={(c) => c.nome}
                getOptionValue={(c) => c.id}
                placeholder="Selecione um cliente"
                disabled={readOnly}
                inputClassName={INPUT_EDITABLE}
              />
            </div>
          </div>

          {/* Blocos de Lotes */}
          <div className="space-y-3">
            {lotes.map((lote, i) => (
              <LoteBlock
                key={i}
                index={i}
                lote={lote}
                onChange={(data) => updateLote(i, data)}
                onRemove={() => removeLote(i)}
                readOnly={readOnly}
                produtos={filteredProdutos}
                vasilhames={vasilhames}
                clienteSelected={!!clienteNome}
                canRemove={lotes.length > 1}
                collapsed={!!collapsedLotes[i]}
                onToggleCollapse={() => toggleLoteCollapse(i)}
              />
            ))}
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                onClick={addLote}
                className="w-full border-dashed gap-2"
              >
                <Plus className="w-4 h-4" />
                Adicionar Bloco
              </Button>
            )}
          </div>

          {/* Total da Entrada */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-blue-200">
            <span className="text-sm text-muted-foreground">
              Quantidade Total ({lotes.length}{" "}
              {lotes.length === 1 ? "bloco" : "blocos"}):
            </span>
            <span className="text-lg font-bold text-primary">
              {formatMass(qtdKg)} kg
            </span>
          </div>

          {/* Dados de Pesagem Granel — só para tipo Granel */}
          {showPesagemGranel && (
            <>
              <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/40/50">
                <div>
                  <Label>Dados de Pesagem Granel</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Ativa os campos de pesagem para produtos a granel
                  </p>
                </div>
                <Switch
                  checked={granelPesagem}
                  onCheckedChange={setGranelPesagem}
                  disabled={readOnly}
                />
              </div>

              {granelPesagem && (
                <div className="space-y-4 p-4 rounded-lg border border-border">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label>Ticket</Label>
                      <Input
                        value={granelTicket}
                        onChange={(e) => setGranelTicket(e.target.value)}
                        placeholder="Nº do ticket"
                        disabled={readOnly}
                        className={INPUT_EDITABLE}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Peso Bruto (kg)</Label>
                      <NumberInputBr
                        decimals={0}
                        min={0}
                        value={granelPesoBruto}
                        onChange={(v) => setGranelPesoBruto(v === "" ? "" : v)}
                        placeholder="0"
                        disabled={readOnly}
                        className={INPUT_EDITABLE}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Peso Líquido (kg)</Label>
                      <NumberInputBr
                        decimals={0}
                        min={0}
                        value={granelPesoLiquido}
                        onChange={(v) => setGranelPesoLiquido(v === "" ? "" : v)}
                        placeholder="0"
                        disabled={readOnly}
                        className={INPUT_EDITABLE}
                      />
                    </div>
                  </div>

                  {qtdKg > 0 && (
                    <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-blue-200">
                      <span className="text-sm text-muted-foreground">
                        Peso Esperado (kg)
                        {lotes[0]?.unidade_medida &&
                          lotes[0]?.unidade_medida !== "kg" &&
                          ` — convertido de ${formatNum(qtd, 0)} ${lotes[0]?.unidade_medida}`}
                        :
                      </span>
                      <span className="text-lg font-bold text-primary">
                        {formatMass(qtdKg)} kg
                      </span>
                    </div>
                  )}

                  {gPl > 0 && (
                    <>
                      <div
                        className={`flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium ${
                          dentroMargem
                            ? "bg-green-50 text-green-700 border border-green-200"
                            : "bg-red-50 text-red-700 border border-red-200"
                        }`}
                      >
                        {dentroMargem ? (
                          <CheckCircle className="w-5 h-5" />
                        ) : (
                          <AlertCircle className="w-5 h-5" />
                        )}
                        {dentroMargem ? "Dentro da margem" : "Fora da margem"}
                      </div>
                      {foraMargem && (
                        <div className="flex items-center justify-center gap-2 py-3 rounded-lg bg-amber-50 border-2 border-amber-400 text-amber-800">
                          <span className="text-sm font-semibold">
                            Valor a considerar: Peso Líquido ={" "}
                            {formatMass(gPl)} kg
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* Status WMS Switch */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/40/50">
            <div>
              <Label>Status WMS</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Indica se o saldo está sincronizado com o WMS
              </p>
            </div>
            <Switch
              checked={statusWms}
              onCheckedChange={setStatusWms}
              disabled={readOnly}
            />
          </div>

          {!readOnly && (
            <DialogFooter className="sm:justify-between flex-col sm:flex-row gap-3">
              {!blockIrParaTransbordo ? (
                <div className="flex flex-col gap-2 max-w-md">
                  <Button
                    type="button"
                    onClick={handleSaveAndTransbordo}
                    disabled={
                      !allSameProduct ||
                      !!transbordoBlockMessage ||
                      checkingTransbordos
                    }
                    className="bg-orange-500 hover:bg-orange-600 gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={
                      transbordoBlockMessage
                        ? transbordoBlockMessage
                        : !allSameProduct
                        ? "Todos os lotes devem ter o mesmo produto para ir ao transbordo"
                        : ""
                    }
                  >
                    <ArrowRight className="w-4 h-4" />
                    Ir para Transbordo
                  </Button>
                  {transbordoBlockMessage && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-relaxed">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{transbordoBlockMessage}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancelar
                </Button>
                <Button type="submit">
                  {editingEntrada ? "Salvar Alterações" : "Cadastrar Entrada"}
                </Button>
              </div>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}