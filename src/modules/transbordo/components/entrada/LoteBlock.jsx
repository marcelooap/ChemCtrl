import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Button } from "@shared/components/ui/button";
import { Switch } from "@shared/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/components/ui/select";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import {
  formatCurrency,
  formatNum,
  formatMass,
  formatVolume,
  roundMass,
  roundVolume,
} from "@transbordo/lib/format";
import {
  TIPOS_RECEBIMENTO,
  resolveTipoRecebimento,
} from "@transbordo/lib/tipoRecebimento";

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
  quantidade_nf: "",
  unidade_medida: "",
  data_fabricacao: "",
  data_validade: "",
  preco_unitario: "",
  tipo_recebimento: "granel",
  embalado: false,
  peso_liquido: "",
  quantidade_embalagens: "",
  placa: "",
  barril: "",
  volume: "",
  tara: "",
  lacres: "",
  eslinga: "",
  gps: "",
  menor_teste: "",
  fracionado: false,
  vasilhame_existente_id: null,
  vasilhame_id: null,
  peso_bruto: "",
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

function applyTipoRecebimento(lote, tipo) {
  const base = {
    ...lote,
    tipo_recebimento: tipo,
    embalado: tipo === "embalado",
  };

  if (tipo === "embalado") {
    return {
      ...base,
      densidade: "",
      placa: "",
      barril: "",
      volume: "",
      tara: "",
      lacres: "",
      eslinga: "",
      gps: "",
      menor_teste: "",
      fracionado: false,
      vasilhame_existente_id: null,
      peso_bruto: "",
    };
  }

  if (tipo === "vasilhame") {
    return {
      ...base,
      quantidade_embalagens: "",
      unidade_medida: "L",
    };
  }

  return {
    ...base,
    peso_liquido: "",
    quantidade_embalagens: "",
    placa: "",
    barril: "",
    volume: "",
    tara: "",
    lacres: "",
    eslinga: "",
    gps: "",
    menor_teste: "",
    fracionado: false,
    vasilhame_existente_id: null,
    peso_bruto: "",
  };
}

function recalcVasilhame(lote, densOverride) {
  const dens =
    densOverride != null
      ? densOverride
      : parseFloat(String(lote.densidade || "0").replace(",", ".")) || 0;
  const volume = roundVolume(lote.volume || 0);
  const tara = roundMass(lote.tara || 0);
  const pesoLiquido = roundMass(volume * dens);
  const pesoBruto = roundMass(tara + pesoLiquido);

  const volumeValue =
    lote.volume === "" || lote.volume == null ? "" : volume;

  return {
    ...lote,
    volume: volumeValue,
    peso_liquido: dens > 0 && volume > 0 ? pesoLiquido : "",
    peso_bruto: dens > 0 && volume > 0 ? pesoBruto : "",
    quantidade: volume > 0 ? String(volume) : "",
    unidade_medida: "L",
  };
}

export default function LoteBlock({
  index,
  lote,
  onChange,
  onRemove,
  readOnly,
  produtos,
  vasilhames = [],
  clienteSelected = false,
  canRemove,
  collapsed = false,
  onToggleCollapse,
}) {
  const update = (field, value) => {
    onChange({ ...lote, [field]: value });
  };

  const tipo = resolveTipoRecebimento(lote);
  const isEmbalado = tipo === "embalado";
  const isVasilhame = tipo === "vasilhame";

  const produtoSelecionado = produtos.find((p) => p.id === lote.produto_id);
  const densidadeTabelada = produtoSelecionado?.densidade_tabelada || false;
  const densidadeNum =
    parseFloat(String(lote.densidade || "0").replace(",", ".")) || 0;

  const fracionadoVasilhames = vasilhames.filter(
    (v) =>
      v.fracionado === true &&
      (v.status || "No Pátio") === "No Pátio" &&
      (v.produto_id === lote.produto_id ||
        (lote.produto_nome &&
          v.produto_nome?.toLowerCase() === lote.produto_nome.toLowerCase()))
  );

  const selectedFracionado =
    fracionadoVasilhames.find(
      (v) =>
        (lote.vasilhame_existente_id &&
          v.id === lote.vasilhame_existente_id) ||
        (v.placa &&
          v.placa === lote.placa &&
          String(v.barril || "") === String(lote.barril || ""))
    ) ||
    fracionadoVasilhames.find((v) => v.placa && v.placa === lote.placa);

  const vasilhameCadastrados = (() => {
    const unique = fracionadoVasilhames.filter(
      (v, i, arr) =>
        v.placa &&
        arr.findIndex((x) => x.placa === v.placa && x.barril === v.barril) === i
    );
    return unique;
  })();

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
      let next = { ...lote, ...updates };
      if (isVasilhame) {
        next = recalcVasilhame(
          next,
          parseFloat(String(next.densidade || "0").replace(",", ".")) || 0
        );
      }
      onChange(next);
    } else {
      onChange({ ...lote, produto_id: "", produto_nome: "", produto_codigo: "" });
    }
  };

  const handleTipoChange = (value) => {
    let next = applyTipoRecebimento(lote, value);
    if (value === "vasilhame") {
      next = recalcVasilhame(next);
    }
    onChange(next);
  };

  const updateVasilhameField = (field, value) => {
    const updated = { ...lote, [field]: value };
    onChange(recalcVasilhame(updated));
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
    isEmbalado && lQtd > 0 && Math.abs(lTotalCalculado - lQtd) > 0.001;

  const qtdDisplay =
    lote.quantidade !== "" && lote.quantidade != null
      ? formatNum(lQtd, 3)
      : "";

  if (collapsed) {
    return (
      <div className="rounded-lg border border-border bg-muted/40/40 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-primary/10 text-primary">
                Bloco {index + 1}
              </span>
              <span className="text-xs text-muted-foreground">
                {TIPOS_RECEBIMENTO.find((t) => t.value === tipo)?.label || "Granel"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <SummaryItem label="Produto" value={produtoDisplay} />
              <SummaryItem label="Nota" value={lote.nota_fiscal} />
              <SummaryItem label="Lote" value={lote.lote} />
              <SummaryItem
                label={isVasilhame ? "Volume" : "Quantidade"}
                value={
                  isVasilhame
                    ? lote.volume
                      ? `${formatVolume(lote.volume)} L`
                      : ""
                    : qtdDisplay
                }
              />
              {!isVasilhame && (
                <SummaryItem label="Unidade" value={lote.unidade_medida} />
              )}
              {isVasilhame && (
                <SummaryItem label="Placa" value={lote.placa} />
              )}
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
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-primary/10 text-primary shrink-0">
            Bloco {index + 1}
          </span>
          <div className="flex items-center gap-2 min-w-0">
            <Label
              htmlFor={`tipo-recebimento-${index}`}
              className="text-xs text-muted-foreground whitespace-nowrap"
            >
              Tipo
            </Label>
            <Select
              value={tipo}
              onValueChange={handleTipoChange}
              disabled={readOnly}
            >
              <SelectTrigger
                id={`tipo-recebimento-${index}`}
                className={`h-8 w-[140px] text-xs ${INPUT_EDITABLE}`}
              >
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_RECEBIMENTO.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          placeholder={
            clienteSelected
              ? "Selecione um produto"
              : "Selecione um cliente primeiro"
          }
          disabled={readOnly || !clienteSelected}
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

      {!isVasilhame && (
        <div
          className={`grid gap-3 ${isEmbalado ? "grid-cols-2" : "grid-cols-3"}`}
        >
          {!isEmbalado && (
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
            {lote.quantidade_nf != null &&
              lote.quantidade_nf !== "" &&
              String(lote.quantidade_nf) !== String(lote.quantidade) && (
                <p className="text-xs text-amber-700">
                  Ajustado pela pesagem (NF: {formatNum(lote.quantidade_nf, 0)}{" "}
                  {lote.unidade_medida || ""})
                </p>
              )}
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
      )}

      {isVasilhame && (
        <div className="space-y-1.5">
          <Label>
            Densidade {densidadeTabelada ? "(Tabelada)" : "*"}
          </Label>
          <NumberInputBr
            decimals={3}
            value={lote.densidade || ""}
            onChange={(v) => {
              const dens =
                v === ""
                  ? 0
                  : parseFloat(String(v).replace(",", ".")) || 0;
              onChange(
                recalcVasilhame(
                  { ...lote, densidade: v === "" ? "" : v },
                  dens
                )
              );
            }}
            placeholder={densidadeTabelada ? "Automático" : "Ex: 1,025"}
            disabled={readOnly || densidadeTabelada}
            className={densidadeTabelada ? "bg-muted/40" : INPUT_EDITABLE}
          />
        </div>
      )}

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
      {isEmbalado && (
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

      {/* Vasilhame / Tanque Fields */}
      {isVasilhame && (
        <div className="grid grid-cols-3 gap-3 p-3 rounded-lg border border-border">
          <div className="space-y-1.5">
            <Label>Nº da Placa *</Label>
            <SearchableSelect
              value={lote.placa || ""}
              onChange={(label, item) => {
                if (item) {
                  const isFracionadoPatio =
                    item.fracionado === true &&
                    (item.status || "No Pátio") === "No Pátio";
                  const sameTank = lote.vasilhame_existente_id === item.id;
                  const updated = {
                    ...lote,
                    placa: item.placa,
                    barril: item.barril || lote.barril || "",
                    tara:
                      item.tara != null ? roundMass(item.tara) : lote.tara,
                    vasilhame_existente_id: isFracionadoPatio ? item.id : null,
                    fracionado: isFracionadoPatio
                      ? sameTank
                        ? !!lote.fracionado
                        : false
                      : false,
                  };
                  onChange(recalcVasilhame(updated));
                } else {
                  onChange(
                    recalcVasilhame({
                      ...lote,
                      placa: label,
                      vasilhame_existente_id: null,
                    })
                  );
                }
              }}
              options={vasilhameCadastrados}
              getOptionLabel={(v) => {
                const base = `${v.placa || ""} - ${v.barril || ""}`;
                return `${base} (Fracionado · ${formatVolume(v.volume)} L)`;
              }}
              getOptionValue={(v) => v.id}
              placeholder="Digite ou selecione fracionado..."
              disabled={readOnly}
              inputClassName={INPUT_EDITABLE}
            />
            {selectedFracionado && (
              <p className="text-xs text-primary font-medium">
                Tanque no pátio (fracionado) — volume atual:{" "}
                {formatVolume(selectedFracionado.volume)} L. O volume informado
                será somado a este registro. Deixe &quot;Fracionado&quot;
                desmarcado se o tanque estiver sendo completado.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Nº do Barril</Label>
            <Input
              value={lote.barril || ""}
              onChange={(e) => updateVasilhameField("barril", e.target.value)}
              placeholder="Nº barril"
              disabled={readOnly}
              className={INPUT_EDITABLE}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Volume (L) *</Label>
            <NumberInputBr
              decimals={0}
              value={lote.volume || ""}
              onChange={(v) =>
                updateVasilhameField(
                  "volume",
                  v === "" ? "" : roundVolume(v)
                )
              }
              placeholder="0"
              disabled={readOnly}
              className={INPUT_EDITABLE}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tara (kg)</Label>
            <NumberInputBr
              decimals={0}
              value={lote.tara || ""}
              onChange={(v) =>
                updateVasilhameField("tara", v === "" ? "" : roundMass(v))
              }
              placeholder="0"
              disabled={readOnly}
              className={INPUT_EDITABLE}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Lacres</Label>
            <Input
              value={lote.lacres || ""}
              onChange={(e) => update("lacres", e.target.value)}
              placeholder="Nº lacres"
              disabled={readOnly}
              className={INPUT_EDITABLE}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Peso Líquido (kg) - auto</Label>
            <Input
              value={
                densidadeNum > 0 && (parseFloat(lote.volume) || 0) > 0
                  ? formatMass(lote.peso_liquido || 0)
                  : ""
              }
              disabled
              className="bg-muted/40 font-medium"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Peso Bruto (kg) - auto</Label>
            <Input
              value={
                densidadeNum > 0 && (parseFloat(lote.volume) || 0) > 0
                  ? formatMass(lote.peso_bruto || 0)
                  : ""
              }
              disabled
              className="bg-muted/40 font-medium"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Eslinga</Label>
            <Input
              value={lote.eslinga || ""}
              onChange={(e) => update("eslinga", e.target.value)}
              placeholder="Eslinga"
              disabled={readOnly}
              className={INPUT_EDITABLE}
            />
          </div>
          <div className="space-y-1.5">
            <Label>GPS</Label>
            <Input
              value={lote.gps || ""}
              onChange={(e) => update("gps", e.target.value)}
              placeholder="GPS"
              disabled={readOnly}
              className={INPUT_EDITABLE}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Menor Teste</Label>
            <Input
              type="date"
              value={lote.menor_teste || ""}
              onChange={(e) => update("menor_teste", e.target.value)}
              disabled={readOnly}
              className={INPUT_EDITABLE}
            />
          </div>
          <div className="col-span-3 flex items-center gap-2 pt-1">
            <Switch
              checked={lote.fracionado || false}
              onCheckedChange={(checked) => update("fracionado", checked)}
              disabled={readOnly}
            />
            <Label
              className="cursor-pointer"
              onClick={() =>
                !readOnly && update("fracionado", !lote.fracionado)
              }
            >
              Fracionado (desmarque ao completar o tanque)
            </Label>
          </div>
        </div>
      )}
    </div>
  );
}
