import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Button } from "@shared/components/ui/button";
import { Switch } from "@shared/components/ui/switch";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { formatCurrency, formatNum } from "@transbordo/lib/format";

const UNIDADES = ["kg", "L", "lb", "gal", "unid."];
const INPUT_EDITABLE = "bg-white";

const emptyLote = () => ({
  produto_id: "",
  produto_nome: "",
  produto_codigo: "",
  nota_fiscal: "",
  lote: "",
  densidade: "",
  quantidade: "",
  unidade_medida: "",
  data_fabricacao: "",
  data_validade: "",
  preco_unitario: "",
  embalado: false,
  peso_liquido: "",
  quantidade_embalagens: "",
});

export { emptyLote, UNIDADES };

const formatMoeda = (v) => formatCurrency(v);

function SummaryItem({ label, value }) {
  return (
    <span className="text-sm text-foreground/80 min-w-0 truncate">
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span title={value && value !== "—" ? String(value) : undefined}>
        {value || "—"}
      </span>
    </span>
  );
}

export default function LoteBlock({
  index,
  lote,
  onChange,
  onRemove,
  readOnly,
  produtos,
  canRemove,
  collapsed = false,
  onToggleCollapse,
}) {
  const update = (field, value) => {
    onChange({ ...lote, [field]: value });
  };

  const produtoSelecionado = produtos.find((p) => p.id === lote.produto_id);
  const densidadeTabelada = produtoSelecionado?.densidade_tabelada || false;

  const handleProdutoChange = (label, item) => {
    if (item) {
      const updates = {
        produto_id: item.id,
        produto_nome: item.produto,
        produto_codigo: item.codigo || "",
      };
      if (item.densidade_tabelada) {
        updates.densidade = item.densidade || "";
      }
      onChange({ ...lote, ...updates });
    } else {
      onChange({ ...lote, produto_id: "", produto_nome: "", produto_codigo: "" });
    }
  };

  const produtoDisplay =
    lote.produto_codigo && lote.produto_nome
      ? `${lote.produto_codigo} - ${lote.produto_nome}`
      : lote.produto_nome || "";

  // ── Cálculos do bloco ──
  const lQtd = parseFloat(lote.quantidade) || 0;
  const lPreco = parseFloat(lote.preco_unitario) || 0;
  const lCustoTotal = lQtd * lPreco;

  const lPeso = parseFloat(lote.peso_liquido) || 0;
  const lQtdEmb = parseFloat(lote.quantidade_embalagens) || 0;
  const lTotalCalculado = lPeso * lQtdEmb;

  const embalagemDiverge =
    lote.embalado && lQtd > 0 && Math.abs(lTotalCalculado - lQtd) > 0.001;

  const qtdDisplay =
    lote.quantidade !== "" && lote.quantidade != null
      ? formatNum(lQtd, 3)
      : "";

  if (collapsed) {
    return (
      <div className="rounded-lg border border-border bg-muted/40/40 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-primary/10 text-primary">
              Bloco {index + 1}
            </span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <SummaryItem label="Produto" value={produtoDisplay} />
              <SummaryItem label="Nota" value={lote.nota_fiscal} />
              <SummaryItem label="Lote" value={lote.lote} />
              <SummaryItem label="Quantidade" value={qtdDisplay} />
              <SummaryItem label="Unidade" value={lote.unidade_medida} />
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                title="Expandir bloco"
                aria-label="Expandir bloco"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            )}
            {canRemove && !readOnly && (
              <button
                type="button"
                onClick={onRemove}
                className="text-red-400 hover:text-red-600 transition-colors p-1"
                title="Remover bloco"
                aria-label="Remover bloco"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg border border-border bg-muted/40/40 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-primary/10 text-primary shrink-0">
            Bloco {index + 1}
          </span>
          <div className="flex items-center gap-2">
            <Label
              htmlFor={`embalado-${index}`}
              className="text-xs text-muted-foreground whitespace-nowrap cursor-pointer"
            >
              Produto embalado
            </Label>
            <Switch
              id={`embalado-${index}`}
              checked={lote.embalado || false}
              onCheckedChange={(v) =>
                onChange({
                  ...lote,
                  embalado: v,
                  ...(v ? { densidade: "" } : {}),
                })
              }
              disabled={readOnly}
            />
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
              title="Minimizar bloco"
              aria-label="Minimizar bloco"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          )}
          {canRemove && !readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              className="text-red-500 hover:text-red-700 h-7 px-2"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remover
            </Button>
          )}
        </div>
      </div>

      {/* Produto */}
      <div className="space-y-1.5">
        <Label>Produto *</Label>
        <SearchableSelect
          value={produtoDisplay}
          onChange={handleProdutoChange}
          options={produtos}
          getOptionLabel={(p) => `${p.codigo || ""} - ${p.produto}`}
          getOptionValue={(p) => p.id}
          placeholder="Selecione um produto"
          disabled={readOnly}
          inputClassName={INPUT_EDITABLE}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Nota Fiscal *</Label>
          <Input
            value={lote.nota_fiscal || ""}
            onChange={(e) => update("nota_fiscal", e.target.value)}
            placeholder="Ex: NF-001234"
            disabled={readOnly}
            className={INPUT_EDITABLE}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Lote *</Label>
          <Input
            value={lote.lote || ""}
            onChange={(e) => update("lote", e.target.value)}
            placeholder="Ex: L-2026-001"
            disabled={readOnly}
            className={INPUT_EDITABLE}
          />
        </div>
      </div>

      <div
        className={`grid gap-3 ${lote.embalado ? "grid-cols-2" : "grid-cols-3"}`}
      >
        {!lote.embalado && (
          <div className="space-y-1.5">
            <Label>
              Densidade {densidadeTabelada ? "(Tabelada)" : "*"}
            </Label>
            <NumberInputBr
              decimals={3}
              value={lote.densidade || ""}
              onChange={(v) => update("densidade", v === "" ? "" : v)}
              placeholder={densidadeTabelada ? "Automático" : "Ex: 1,025"}
              disabled={readOnly || densidadeTabelada}
              className={densidadeTabelada ? "bg-muted/40" : INPUT_EDITABLE}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Quantidade *</Label>
          <NumberInputBr
            decimals={3}
            min={0}
            value={lote.quantidade || ""}
            onChange={(v) => update("quantidade", v === "" ? "" : v)}
            placeholder="0"
            disabled={readOnly}
            className={INPUT_EDITABLE}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Unidade *</Label>
          <SearchableSelect
            value={lote.unidade_medida || ""}
            onChange={(label) => update("unidade_medida", label)}
            options={UNIDADES.map((u) => ({ value: u }))}
            getOptionLabel={(u) => u.value}
            getOptionValue={(u) => u.value}
            placeholder="Selecione"
            disabled={readOnly}
            inputClassName={INPUT_EDITABLE}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Data de Fabricação</Label>
          <Input
            type="date"
            value={lote.data_fabricacao || ""}
            onChange={(e) => update("data_fabricacao", e.target.value)}
            disabled={readOnly}
            className={INPUT_EDITABLE}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Data de Validade</Label>
          <Input
            type="date"
            value={lote.data_validade || ""}
            onChange={(e) => update("data_validade", e.target.value)}
            disabled={readOnly}
            className={INPUT_EDITABLE}
          />
        </div>
      </div>

      {/* Preço Unitário + Custo Total */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Preço Unitário (R$)</Label>
          <NumberInputBr
            decimals={4}
            min={0}
            value={lote.preco_unitario || ""}
            onChange={(v) => update("preco_unitario", v === "" ? "" : v)}
            placeholder="0,0000"
            disabled={readOnly}
            className={INPUT_EDITABLE}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Custo Total (R$)</Label>
          <Input
            value={formatMoeda(lCustoTotal)}
            disabled
            className="bg-muted/40 font-medium"
          />
        </div>
      </div>

      {/* Embalagem Fields */}
      {lote.embalado && (
        <div className="grid grid-cols-3 gap-3 p-3 rounded-lg border border-border">
          <div className="space-y-1.5">
            <Label>Peso Líquido</Label>
            <NumberInputBr
              decimals={3}
              min={0}
              value={lote.peso_liquido || ""}
              onChange={(v) => update("peso_liquido", v === "" ? "" : v)}
              placeholder="0"
              disabled={readOnly}
              className={INPUT_EDITABLE}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Qtd. Embalagens</Label>
            <NumberInputBr
              decimals={0}
              min={0}
              value={lote.quantidade_embalagens || ""}
              onChange={(v) => update("quantidade_embalagens", v === "" ? "" : v)}
              placeholder="0"
              disabled={readOnly}
              className={INPUT_EDITABLE}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Total Calculado</Label>
            <Input
              value={formatNum(lTotalCalculado, 0)}
              disabled
              className="bg-muted/40 font-medium"
            />
          </div>
          {embalagemDiverge && (
            <p className="col-span-3 text-xs text-red-600">
              ⚠ Divergência: O total calculado ({formatNum(lTotalCalculado, 0)}) não
              corresponde à quantidade do bloco ({formatNum(lQtd, 0)}).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
