import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import SearchableSelect from "@chemflow/components/cadastro/SearchableSelect";
import { formatVolume, formatMass, formatNum } from "@chemflow/lib/format";

const TIPO_OPTIONS = [
  { value: "embalado", label: "Embalado" },
  { value: "convencional", label: "Convencional" },
];

function vasilhameLabel(v) {
  return `${v.placa || "—"} - ${v.barril || "—"}`;
}

function loteLabel(lote, saldo, unidade) {
  return `${lote || "—"} - ${formatMass(saldo)} - ${unidade || "kg"}`;
}

function tipoLabel(tipo) {
  return tipo === "convencional" ? "Convencional" : "Embalado";
}

export default function SaidaItemRow({
  index,
  item,
  itens = [],
  entradas,
  vasilhames,
  clienteId,
  onChange,
  onRemove,
  getAvailableSaldo,
  getAvailableVolume,
  collapsed = false,
  onToggleCollapse,
}) {
  const hasCliente = Boolean(clienteId);

  const handleTipoChange = (newTipo) => {
    onChange({
      tipo: newTipo,
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
  };

  // ── Embalado: produtos do cliente com saldo disponível (após outras linhas) ──
  const embaladoEntradas = hasCliente
    ? entradas.filter(
        (e) => e.embalado && e.cliente_id === clienteId
      )
    : [];

  const uniqueProdutos = [];
  const seen = new Set();
  embaladoEntradas.forEach((e) => {
    const key = e.produto_id || e.produto_nome;
    if (!key || seen.has(key)) return;
    const isCurrent =
      (item.produto_id || item.produto_nome) === key;
    const hasSaldoDisponivel = embaladoEntradas.some(
      (x) =>
        (x.produto_id || x.produto_nome) === key &&
        getAvailableSaldo(x.id, index) > 0
    );
    if (!hasSaldoDisponivel && !isCurrent) return;
    seen.add(key);
    uniqueProdutos.push({
      id: e.produto_id,
      nome: e.produto_nome,
      codigo: e.produto_codigo,
      peso_liquido: e.peso_liquido,
    });
  });

  const lotesForProduct = embaladoEntradas.filter((e) => {
    const sameProduct =
      (e.produto_id || e.produto_nome) === (item.produto_id || item.produto_nome);
    if (!sameProduct) return false;
    const saldoDisponivel = getAvailableSaldo(e.id, index);
    // Mantém o lote já selecionado nesta linha; demais só com saldo futuro > 0
    return saldoDisponivel > 0 || e.id === item.entrada_id;
  });

  // ── Convencional: vasilhames No Pátio do cliente, excluindo já usados em outras linhas ──
  const vasilhamesUsados = new Set(
    (itens || [])
      .filter(
        (it, i) =>
          i !== index &&
          it.tipo === "convencional" &&
          it.vasilhame_id
      )
      .map((it) => it.vasilhame_id)
  );

  const vasilhamesDisponiveis = hasCliente
    ? vasilhames.filter(
        (v) =>
          v.cliente_id === clienteId &&
          (v.status || "No Pátio") === "No Pátio" &&
          (v.volume || 0) > 0 &&
          (!vasilhamesUsados.has(v.id) || v.id === item.vasilhame_id)
      )
    : [];

  // ── Valores dinâmicos (consideram outros itens do formulário) ──
  const displayEstoqueAtual =
    item.entrada_id && item.tipo === "embalado"
      ? getAvailableSaldo(item.entrada_id, index)
      : 0;
  const displayEstoqueFinal = displayEstoqueAtual - (item.quantidade_solicitada || 0);
  const estoqueInsuficiente =
    item.tipo === "embalado" &&
    item.entrada_id &&
    (item.quantidade_solicitada || 0) > displayEstoqueAtual;

  const displayVolumeDisponivel =
    item.vasilhame_id && item.tipo === "convencional"
      ? getAvailableVolume(item.vasilhame_id, index)
      : 0;
  const displaySaldoFinal = displayVolumeDisponivel - (item.volume_solicitado || 0);
  const volumeInsuficiente =
    item.tipo === "convencional" &&
    item.vasilhame_id &&
    (item.volume_solicitado || 0) > displayVolumeDisponivel;

  // ── Handlers Embalado ──
  const handleProdutoChange = (label, option) => {
    if (!option) return;
    onChange({
      ...item,
      produto_id: option.id,
      produto_nome: option.nome,
      produto_codigo: option.codigo || "",
      peso_liquido_embalagem: option.peso_liquido || 0,
      entrada_id: "",
      lote: "",
      quantidade_solicitada: 0,
      quantidade_embalagens: 0,
    });
  };

  const handleLoteChange = (label, option) => {
    if (!option) return;
    onChange({
      ...item,
      entrada_id: option.id,
      lote: option.lote || "",
    });
  };

  const handleQuantidadeChange = (v) => {
    const qtd = v || 0;
    const pesoLiq = item.peso_liquido_embalagem || 0;
    const qtdEmbalagens = pesoLiq > 0 ? qtd / pesoLiq : 0;
    onChange({
      ...item,
      quantidade_solicitada: qtd,
      quantidade_embalagens: qtdEmbalagens,
    });
  };

  // ── Handlers Convencional ──
  const handleVasilhameChange = (label, option) => {
    if (!option) return;
    const volumeAtual = option.volume || 0;
    onChange({
      ...item,
      vasilhame_id: option.id,
      vasilhame_placa: option.placa || "",
      vasilhame_barril: option.barril || "",
      produto_id: option.produto_id || "",
      produto_nome: option.produto_nome || "",
      produto_codigo: option.produto_codigo || "",
      lote: option.lote || "",
      peso_liquido: option.peso_liquido || 0,
      peso_bruto: option.peso_bruto || 0,
      volume_solicitado: volumeAtual,
    });
  };

  const loteSelectValue = (() => {
    if (!item.entrada_id) return "";
    const entrada =
      lotesForProduct.find((e) => e.id === item.entrada_id) ||
      entradas.find((e) => e.id === item.entrada_id);
    if (!entrada) return item.lote || "";
    return loteLabel(
      entrada.lote,
      getAvailableSaldo(entrada.id, index),
      entrada.unidade_medida
    );
  })();

  const vasilhameSelectValue = item.vasilhame_id
    ? vasilhameLabel({
        placa: item.vasilhame_placa,
        barril: item.vasilhame_barril,
      })
    : "";

  const resumoProduto =
    item.produto_nome ||
    (item.tipo === "convencional" && item.vasilhame_placa
      ? vasilhameLabel({ placa: item.vasilhame_placa, barril: item.vasilhame_barril })
      : "—");

  const resumoQuantidade =
    item.tipo === "convencional"
      ? `${formatVolume(item.volume_solicitado)} L`
      : `${formatMass(item.quantidade_solicitada)} kg`;

  return (
    <div className="rounded-lg border border-border bg-muted/40/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-primary shrink-0">
            Produto {String(index + 1).padStart(2, "0")}
          </span>
          {collapsed && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground min-w-0">
              <span className="inline-flex items-center rounded-md bg-primary/10 text-primary px-2 py-0.5 font-medium">
                {tipoLabel(item.tipo)}
              </span>
              <span className="truncate font-medium text-foreground" title={resumoProduto}>
                {resumoProduto}
              </span>
              <span className="shrink-0 font-semibold text-foreground">
                {resumoQuantidade}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title={collapsed ? "Expandir" : "Minimizar"}
            aria-label={collapsed ? "Expandir produto" : "Minimizar produto"}
          >
            {collapsed ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 rounded-md text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            title="Remover"
            aria-label="Remover produto"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
      <div className="space-y-1.5">
        <Label>Tipo *</Label>
        <div className="flex gap-2">
          {TIPO_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleTipoChange(opt.value)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                item.tipo === opt.value
                  ? "bg-primary text-white"
                  : "bg-card border border-border text-muted-foreground hover:bg-muted/40"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── EMBALADO ── */}
      {item.tipo === "embalado" && (
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5 col-span-2">
            <Label>Produto *</Label>
            <SearchableSelect
              value={item.produto_nome || ""}
              onChange={handleProdutoChange}
              options={uniqueProdutos}
              getOptionLabel={(o) => o.nome || ""}
              getOptionValue={(o) => o.id}
              placeholder={
                hasCliente
                  ? "Selecione um produto embalado..."
                  : "Selecione o cliente primeiro..."
              }
              disabled={!hasCliente}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Lote *</Label>
            <SearchableSelect
              value={loteSelectValue}
              onChange={handleLoteChange}
              options={lotesForProduct}
              getOptionLabel={(o) =>
                loteLabel(
                  o.lote,
                  getAvailableSaldo(o.id, index),
                  o.unidade_medida
                )
              }
              getOptionValue={(o) => o.id}
              placeholder="Selecione o lote..."
              disabled={!hasCliente || !item.produto_id}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Quantidade Solicitada (kg) *</Label>
            <Input
              type="number"
              step="0.001"
              value={item.quantidade_solicitada || ""}
              onChange={(e) => handleQuantidadeChange(parseFloat(e.target.value) || 0)}
              placeholder="0"
              disabled={!item.entrada_id}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Peso Líq. Embalagem (kg)</Label>
            <Input value={formatMass(item.peso_liquido_embalagem)} disabled className="bg-card font-medium" />
          </div>
          <div className="space-y-1.5">
            <Label>Qtd. Embalagens (auto)</Label>
            <Input value={formatNum(item.quantidade_embalagens, 1)} disabled className="bg-card font-medium" />
          </div>
          <div className="space-y-1.5">
            <Label>Estoque Atual (kg)</Label>
            <Input value={formatMass(displayEstoqueAtual)} disabled className="bg-card font-medium" />
          </div>
          <div className="space-y-1.5">
            <Label>Estoque Final (kg)</Label>
            <Input
              value={formatMass(displayEstoqueFinal)}
              disabled
              className={`bg-card font-medium ${estoqueInsuficiente ? "text-red-600" : "text-green-600"}`}
            />
          </div>
          {estoqueInsuficiente && (
            <p className="col-span-3 text-xs text-red-600 font-medium">
              ⚠ Quantidade solicitada maior que o saldo disponível ({formatMass(displayEstoqueAtual)} kg)!
            </p>
          )}
        </div>
      )}

      {/* ── CONVENCIONAL ── */}
      {item.tipo === "convencional" && (
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5 col-span-2">
            <Label>Vasilhame *</Label>
            <SearchableSelect
              value={vasilhameSelectValue}
              onChange={handleVasilhameChange}
              options={vasilhamesDisponiveis}
              getOptionLabel={vasilhameLabel}
              getOptionValue={(v) => v.id}
              placeholder={
                hasCliente
                  ? "Selecione um vasilhame (placa - barril)..."
                  : "Selecione o cliente primeiro..."
              }
              disabled={!hasCliente}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Produto</Label>
            <Input value={item.produto_nome || ""} disabled className="bg-card font-medium" />
          </div>
          <div className="space-y-1.5">
            <Label>Volume Disponível (L)</Label>
            <Input value={formatVolume(displayVolumeDisponivel)} disabled className="bg-card font-medium" />
          </div>
          <div className="space-y-1.5">
            <Label>Volume Solicitado (L) *</Label>
            <Input
              value={formatVolume(item.volume_solicitado)}
              disabled
              className="bg-card font-medium"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Saldo Final (L)</Label>
            <Input
              value={formatVolume(displaySaldoFinal)}
              disabled
              className={`bg-card font-medium ${volumeInsuficiente ? "text-red-600" : "text-green-600"}`}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Peso Líquido (kg)</Label>
            <Input value={formatMass(item.peso_liquido)} disabled className="bg-card font-medium" />
          </div>
          <div className="space-y-1.5">
            <Label>Peso Bruto (kg)</Label>
            <Input value={formatMass(item.peso_bruto)} disabled className="bg-card font-medium" />
          </div>
          <div className="space-y-1.5">
            <Label>Lote</Label>
            <Input value={item.lote || ""} disabled className="bg-card font-medium" />
          </div>
          {volumeInsuficiente && (
            <p className="col-span-3 text-xs text-red-600 font-medium">
              ⚠ Volume solicitado maior que o disponível ({formatVolume(displayVolumeDisponivel)} L)!
            </p>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}