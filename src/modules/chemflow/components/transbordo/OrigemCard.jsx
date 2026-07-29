import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import SearchableSelect from "@chemflow/components/cadastro/SearchableSelect";
import {
  formatVolume,
  formatMass,
  roundVolume,
  roundMass,
} from "@chemflow/lib/format";

const TIPOS_ORIGEM = [
  { value: "entrada", label: "Entrada (Estoque)" },
  { value: "tanka", label: "Tanka" },
  { value: "vasilhame", label: "Vasilhame" },
  { value: "embalado", label: "Embalado" },
];

export default function OrigemCard({
  index,
  origem,
  entradaOptions = [],
  tankaOptions = [],
  vasilhameOptions = [],
  embaladoOptions = [],
  densidade,
  onChange,
  onRemove,
  readOnly,
  collapsed = false,
  onToggleCollapse,
}) {
  const tipoOrigem = origem.tipo_origem || "";
  const sourceOptions =
    tipoOrigem === "entrada"
      ? entradaOptions
      : tipoOrigem === "tanka"
      ? tankaOptions
      : tipoOrigem === "vasilhame"
      ? vasilhameOptions
      : tipoOrigem === "embalado"
      ? embaladoOptions
      : [];

  const selectedSource = sourceOptions.find((s) => s.id === origem.entrada_id);
  const isEntradaLocked =
    tipoOrigem === "entrada" &&
    !!origem.entrada_id &&
    !selectedSource;

  const saldoDisponivel =
    selectedSource?.saldo_atual ?? origem.saldo_disponivel ?? 0;
  const unidadeMedida =
    selectedSource?.unidade_medida ||
    (tipoOrigem === "entrada" ? "kg" : "L");
  const volumeRetirado = roundVolume(origem.volume_retirado || 0);
  const massaRetirada = roundMass(volumeRetirado * densidade);

  const saldoEmLitros =
    unidadeMedida === "kg" && densidade > 0
      ? roundVolume(saldoDisponivel / densidade)
      : roundVolume(saldoDisponivel);

  const saldoRestanteL = Math.max(0, saldoEmLitros - volumeRetirado);
  const saldoRestanteKg = roundMass(saldoRestanteL * densidade);

  const handleTipoChange = (label, item) => {
    onChange({
      ...origem,
      tipo_origem: item?.value || "",
      entrada_id: "",
      entrada_codigo: "",
      lote: "",
      volume_retirado: 0,
      massa_retirada: 0,
      saldo_restante: 0,
      saldo_disponivel: 0,
    });
  };

  const handleSourceChange = (label, item) => {
    if (item) {
      const unid = item.unidade_medida || "L";
      const saldo = item.saldo_atual || 0;
      const saldoL =
        unid === "kg" && densidade > 0
          ? roundVolume(saldo / densidade)
          : roundVolume(saldo);
      onChange({
        ...origem,
        entrada_id: item.id,
        entrada_codigo: label,
        lote: item.lote || "",
        saldo_disponivel: saldoL,
      });
    }
  };

  const handleVolumeChange = (val) => {
    const v = roundVolume(val);
    onChange({
      ...origem,
      volume_retirado: v,
      saldo_restante: Math.max(0, saldoEmLitros - v),
    });
  };

  const excedeuSaldo = volumeRetirado > saldoEmLitros;
  const tipoValue = TIPOS_ORIGEM.find((t) => t.value === tipoOrigem)?.label || "";

  const collapseControls = (
    <div className="flex items-center gap-2 shrink-0">
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          title={collapsed ? "Maximizar origem" : "Minimizar origem"}
          aria-label={collapsed ? "Maximizar origem" : "Minimizar origem"}
        >
          {collapsed ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronUp className="w-4 h-4" />
          )}
        </button>
      )}
      {!readOnly && !isEntradaLocked && (
        <button
          type="button"
          onClick={onRemove}
          className="text-red-400 hover:text-red-600 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  if (collapsed) {
    return (
      <div className="rounded-lg border border-border bg-muted/40/50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0 flex-1">
            <span className="text-sm font-semibold text-primary shrink-0">
              Origem {String(index + 1).padStart(2, "0")}
            </span>
            <span className="text-sm text-foreground/80 truncate">
              <span className="text-muted-foreground">Origem:</span>{" "}
              {origem.entrada_codigo || "—"}
            </span>
            <span className="text-sm text-foreground/80 shrink-0">
              <span className="text-muted-foreground">Volume:</span>{" "}
              {formatVolume(volumeRetirado)} L
            </span>
          </div>
          {collapseControls}
        </div>
      </div>
    );
  }

  if (isEntradaLocked) {
    return (
      <div className="rounded-lg border border-border bg-muted/40/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-primary">
            Origem {String(index + 1).padStart(2, "0")}
          </span>
          {collapseControls}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Tipo de Origem</Label>
            <Input value="Entrada (Estoque)" disabled className="bg-card font-medium text-primary" />
          </div>
          <div className="space-y-1.5">
            <Label>Origem</Label>
            <Input value={origem.entrada_codigo || ""} disabled className="bg-card font-medium" />
          </div>
          <div className="space-y-1.5">
            <Label>Lote</Label>
            <Input value={origem.lote || ""} disabled className="bg-card" />
          </div>
          <div className="space-y-1.5">
            <Label>Saldo Disponível (L)</Label>
            <Input
              value={formatVolume(origem.saldo_disponivel || 0)}
              disabled
              className="bg-muted/40"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Volume Retirado (L)</Label>
            <Input
              type="number"
              step="1"
              min="0"
              value={origem.volume_retirado ?? ""}
              onChange={(e) => handleVolumeChange(e.target.value)}
              disabled={readOnly}
              className="bg-white font-medium text-primary"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Saldo Restante (L)</Label>
            <Input
              value={formatVolume(origem.saldo_restante ?? saldoRestanteL)}
              disabled
              className="bg-card font-medium text-green-600"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Massa Correspondente (kg)</Label>
            <Input value={formatMass(massaRetirada)} disabled className="bg-card font-medium" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/40/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-primary">
          Origem {String(index + 1).padStart(2, "0")}
        </span>
        {collapseControls}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Tipo de Origem *</Label>
          <SearchableSelect
            value={tipoValue}
            onChange={handleTipoChange}
            options={TIPOS_ORIGEM}
            getOptionLabel={(t) => t.label}
            getOptionValue={(t) => t.value}
            placeholder="Selecionar tipo"
            disabled={readOnly}
            inputClassName="bg-white"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Origem *</Label>
          <SearchableSelect
            value={origem.entrada_codigo || ""}
            onChange={handleSourceChange}
            options={sourceOptions}
            getOptionLabel={(s) => s.display_label || ""}
            getOptionValue={(s) => s.id}
            placeholder={
              tipoOrigem ? "Selecionar origem" : "Selecione um tipo primeiro"
            }
            disabled={readOnly || !tipoOrigem}
            inputClassName="bg-white"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Lote (auto)</Label>
          <Input value={origem.lote || ""} disabled className="bg-card" />
        </div>
        <div className="space-y-1.5">
          <Label>Volume Retirado (L) *</Label>
          <Input
            type="number"
            step="1"
            min="0"
            value={origem.volume_retirado || ""}
            onChange={(e) => handleVolumeChange(e.target.value)}
            placeholder="0"
            disabled={readOnly}
            className="bg-white"
          />
          {excedeuSaldo && (
            <p className="text-xs text-red-600">
              ⚠ Volume superior ao saldo disponível ({formatVolume(saldoEmLitros)} L)
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Massa Correspondente (kg)</Label>
          <Input
            value={formatMass(massaRetirada)}
            disabled
            className="bg-card font-medium"
          />
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs">
        <span className="text-muted-foreground">
          Saldo restante:{" "}
          <span className="font-medium text-green-700">
            {formatVolume(saldoRestanteL)} L
          </span>
        </span>
        {unidadeMedida !== "L" && (
          <span className="text-muted-foreground">
            /{" "}
            <span className="font-medium text-green-700">
              {formatMass(saldoRestanteKg)} {unidadeMedida}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
