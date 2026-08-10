import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import {
  formatVolume,
  formatMass,
  roundVolume,
  roundMass,
} from "@transbordo/lib/format";
import { saldoKgToLitros } from "@transbordo/lib/conversao";

const TIPOS_ORIGEM = [
  { value: "entrada", label: "Entrada (Estoque)" },
  { value: "tanka", label: "Tanka" },
  { value: "vasilhame", label: "Vasilhame" },
  { value: "embalado", label: "Embalado" },
];

/** Tipos disponíveis na lista suspensa (entrada só via fluxo travado da entrada). */
const TIPOS_ORIGEM_SELECIONAVEIS = TIPOS_ORIGEM.filter(
  (t) => t.value !== "entrada"
);

function buildLotesRetirados(
  lotesDisponiveis = [],
  previous = [],
  { fallbackVolume = 0, fallbackLote = "" } = {}
) {
  const prevByLote = new Map(
    (previous || []).map((l) => [(l.lote || "").trim(), l])
  );
  const hasPrev = (previous || []).some(
    (l) => roundVolume(l.volume_retirado || 0) > 0
  );
  const fallbackKey = (fallbackLote || "").trim();
  const fbVol = roundVolume(fallbackVolume);

  return (lotesDisponiveis || []).map((l, i) => {
    const key = (l.lote || "").trim();
    const prev = prevByLote.get(key);
    const saldo = roundVolume(l.quantidade_l || l.saldo_disponivel || 0);
    let volume = roundVolume(prev?.volume_retirado || 0);
    if (!hasPrev && fbVol > 0) {
      if (fallbackKey ? key === fallbackKey : i === 0) {
        volume = fbVol;
      }
    }
    return {
      lote: l.lote || "",
      saldo_disponivel: saldo,
      volume_retirado: volume,
    };
  });
}

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

  const lotesDisponiveis =
    selectedSource?.lotes_disponiveis ||
    origem.lotes_disponiveis ||
    [];
  const isMultiLote = lotesDisponiveis.length > 1;

  const lotesRetirados = isMultiLote
    ? buildLotesRetirados(lotesDisponiveis, origem.lotes_retirados, {
        fallbackVolume: origem.volume_retirado || 0,
        fallbackLote: origem.lote || "",
      })
    : [];

  const saldoDisponivel =
    selectedSource?.saldo_atual ?? origem.saldo_disponivel ?? 0;
  // Opções já vêm de adjustOptionsForOrigem com saldo em litros (unidade_medida "L").
  // Prefill / saldo_disponivel da origem também já estão em L — não reconverter.
  const unidadeMedida = selectedSource?.unidade_medida || "L";
  const volumeRetirado = roundVolume(
    isMultiLote
      ? lotesRetirados.reduce((s, l) => s + (l.volume_retirado || 0), 0)
      : origem.volume_retirado || 0
  );
  const massaRetirada = roundMass(volumeRetirado * densidade);

  const saldoEmLitros =
    unidadeMedida === "kg" && densidade > 0
      ? saldoKgToLitros(saldoDisponivel, densidade, selectedSource)
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
      lotes_disponiveis: undefined,
      lotes_retirados: undefined,
    });
  };

  const handleSourceChange = (label, item) => {
    if (item) {
      const unid = item.unidade_medida || "L";
      const saldo = item.saldo_atual || 0;
      const saldoL =
        unid === "kg" && densidade > 0
          ? saldoKgToLitros(saldo, densidade, item)
          : roundVolume(saldo);
      const lotes = item.lotes_disponiveis || [];
      const multi = lotes.length > 1;
      const lotesRet = multi ? buildLotesRetirados(lotes) : undefined;
      onChange({
        ...origem,
        entrada_id: item.id,
        entrada_codigo: label,
        lote: multi ? lotes[0]?.lote || "" : item.lote || "",
        saldo_disponivel: saldoL,
        lotes_disponiveis: multi ? lotes : undefined,
        lotes_retirados: lotesRet,
        volume_retirado: 0,
        massa_retirada: 0,
        saldo_restante: saldoL,
      });
    }
  };

  const handleVolumeChange = (val) => {
    const v = roundVolume(val);
    onChange({
      ...origem,
      volume_retirado: v,
      saldo_restante: Math.max(0, saldoEmLitros - v),
      lotes_retirados: undefined,
    });
  };

  const handleLoteVolumeChange = (loteIdx, val) => {
    const v = roundVolume(val);
    const next = lotesRetirados.map((l, i) =>
      i === loteIdx ? { ...l, volume_retirado: v } : l
    );
    const total = roundVolume(
      next.reduce((s, l) => s + (l.volume_retirado || 0), 0)
    );
    const firstWithVol = next.find((l) => (l.volume_retirado || 0) > 0);
    onChange({
      ...origem,
      lotes_disponiveis: lotesDisponiveis,
      lotes_retirados: next,
      volume_retirado: total,
      lote: firstWithVol?.lote || next[0]?.lote || origem.lote || "",
      saldo_restante: Math.max(0, saldoEmLitros - total),
    });
  };

  const excedeuSaldo = volumeRetirado > saldoEmLitros;
  const excedeuLote = lotesRetirados.some(
    (l) => roundVolume(l.volume_retirado) > roundVolume(l.saldo_disponivel)
  );
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

  const multiLoteFields = isMultiLote && (
    <div className="col-span-2 space-y-2">
      <Label>Lotes disponíveis</Label>
      <div className="rounded-md border border-border bg-card divide-y divide-border">
        {lotesRetirados.map((l, i) => {
          const excedeu = roundVolume(l.volume_retirado) > roundVolume(l.saldo_disponivel);
          return (
            <div
              key={`${l.lote || "lote"}-${i}`}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3"
            >
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Lote — Volume</Label>
                <Input
                  value={`${l.lote || "—"} — ${formatVolume(l.saldo_disponivel)} L`}
                  disabled
                  className="bg-muted/40 font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Volume Retirado (L) *
                </Label>
                <NumberInputBr
                  decimals={0}
                  min={0}
                  max={l.saldo_disponivel || 0}
                  value={l.volume_retirado || ""}
                  onChange={(v) => handleLoteVolumeChange(i, v)}
                  placeholder="0"
                  disabled={readOnly}
                  className="bg-white"
                />
                {excedeu && (
                  <p className="text-xs text-red-600">
                    ⚠ Superior ao saldo do lote ({formatVolume(l.saldo_disponivel)} L)
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="text-muted-foreground">
          Total retirado:{" "}
          <span className="font-medium text-primary">
            {formatVolume(volumeRetirado)} L
          </span>
        </span>
        <span className="text-muted-foreground">
          Saldo restante:{" "}
          <span className="font-medium text-green-700">
            {formatVolume(saldoRestanteL)} L
          </span>
        </span>
      </div>
    </div>
  );

  if (collapsed) {
    const loteSummary = isMultiLote
      ? lotesRetirados
          .filter((l) => (l.volume_retirado || 0) > 0)
          .map((l) => `${l.lote || "—"} (${formatVolume(l.volume_retirado)} L)`)
          .join(", ") || "—"
      : null;

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
            {loteSummary ? (
              <span className="text-sm text-foreground/80 truncate">
                <span className="text-muted-foreground">Lotes:</span> {loteSummary}
              </span>
            ) : (
              <span className="text-sm text-foreground/80 shrink-0">
                <span className="text-muted-foreground">Volume:</span>{" "}
                {formatVolume(volumeRetirado)} L
              </span>
            )}
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
            <NumberInputBr
              decimals={0}
              min={0}
              value={origem.volume_retirado ?? ""}
              onChange={(v) => handleVolumeChange(v)}
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
            options={TIPOS_ORIGEM_SELECIONAVEIS}
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

        {isMultiLote ? (
          multiLoteFields
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Lote (auto)</Label>
              <Input value={origem.lote || ""} disabled className="bg-card" />
            </div>
            <div className="space-y-1.5">
              <Label>Volume Retirado (L) *</Label>
              <NumberInputBr
                decimals={0}
                min={0}
                value={origem.volume_retirado || ""}
                onChange={(v) => handleVolumeChange(v)}
                placeholder="0"
                disabled={readOnly}
                className="bg-white"
              />
              {(excedeuSaldo || excedeuLote) && (
                <p className="text-xs text-red-600">
                  ⚠ Volume superior ao saldo disponível ({formatVolume(saldoEmLitros)} L)
                </p>
              )}
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Label>Massa Correspondente (kg)</Label>
          <Input
            value={formatMass(massaRetirada)}
            disabled
            className="bg-card font-medium"
          />
        </div>
      </div>
      {!isMultiLote && (
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
      )}
    </div>
  );
}
