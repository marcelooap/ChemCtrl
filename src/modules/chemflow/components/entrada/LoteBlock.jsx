import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Button } from "@shared/components/ui/button";
import { Switch } from "@shared/components/ui/switch";
import SearchableSelect from "@chemflow/components/cadastro/SearchableSelect";
import { Trash2 } from "lucide-react";
import { formatCurrency, formatNum } from "@chemflow/lib/format";

const UNIDADES = ["kg", "L", "lb", "gal", "unid."];

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

export default function LoteBlock({
  index,
  lote,
  onChange,
  onRemove,
  readOnly,
  produtos,
  canRemove,
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

  return (
    <div className="p-4 rounded-lg border border-border bg-muted/40/40 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-semibold text-foreground/80 shrink-0">
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
        {canRemove && !readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="text-red-500 hover:text-red-700 h-7 px-2 shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remover
          </Button>
        )}
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
          />
        </div>
        <div className="space-y-1.5">
          <Label>Lote *</Label>
          <Input
            value={lote.lote || ""}
            onChange={(e) => update("lote", e.target.value)}
            placeholder="Ex: L-2026-001"
            disabled={readOnly}
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
            <Input
              type="text"
              value={lote.densidade || ""}
              onChange={(e) => update("densidade", e.target.value)}
              placeholder={densidadeTabelada ? "Automático" : "Ex: 1,025"}
              disabled={readOnly || densidadeTabelada}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Quantidade *</Label>
          <Input
            type="number"
            step="0.001"
            min="0"
            value={lote.quantidade || ""}
            onChange={(e) => update("quantidade", e.target.value)}
            placeholder="0"
            disabled={readOnly}
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
          />
        </div>
        <div className="space-y-1.5">
          <Label>Data de Validade</Label>
          <Input
            type="date"
            value={lote.data_validade || ""}
            onChange={(e) => update("data_validade", e.target.value)}
            disabled={readOnly}
          />
        </div>
      </div>

      {/* Preço Unitário + Custo Total */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Preço Unitário (R$)</Label>
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={lote.preco_unitario || ""}
            onChange={(e) => update("preco_unitario", e.target.value)}
            placeholder="0,0000"
            disabled={readOnly}
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
            <Input
              type="number"
              step="0.001"
              min="0"
              value={lote.peso_liquido || ""}
              onChange={(e) => update("peso_liquido", e.target.value)}
              placeholder="0"
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Qtd. Embalagens</Label>
            <Input
              type="number"
              step="1"
              min="0"
              value={lote.quantidade_embalagens || ""}
              onChange={(e) => update("quantidade_embalagens", e.target.value)}
              placeholder="0"
              disabled={readOnly}
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