import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Button } from "@shared/components/ui/button";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
} from "lucide-react";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import {
  formatVolume,
  formatMass,
  roundVolume,
  roundMass,
} from "@transbordo/lib/format";
import { saldoKgToLitros } from "@transbordo/lib/conversao";
import {
  isEstoqueEmbalado,
  isUnidadeMassaEntrada,
  normalizeUnidadeEntrada,
} from "@transbordo/lib/estoqueSaldo";

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

function formatQtd(valor, unidade) {
  const um = normalizeUnidadeEntrada(unidade);
  if (um === "kg" || um === "lb") return formatMass(valor);
  return formatVolume(valor);
}

function labelUnidade(unidade) {
  const um = normalizeUnidadeEntrada(unidade);
  if (um === "kg") return "kg";
  if (um === "lb") return "lb";
  if (um === "gal") return "gal";
  return "L";
}

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
  volumeDestinado = 0,
  destinosCount = 0,
  onAddDestino,
  children,
  lockOrigem = false,
  lockOrigemTipo = false,
}) {
  const tipoOrigem = origem.tipo_origem || "";
  const origemLocked = readOnly || lockOrigem;
  const origemTipoLocked = origemLocked || lockOrigemTipo;
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

  const isEmbaladoOrigem =
    tipoOrigem === "embalado" ||
    isEstoqueEmbalado(selectedSource) ||
    Boolean(origem.embalado);

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
  const unidadeMedida =
    (isEmbaladoOrigem
      ? selectedSource?.unidade_medida ||
        origem.unidade_medida ||
        "kg"
      : selectedSource?.unidade_medida || "L") || "L";
  const unidadeLabel = labelUnidade(unidadeMedida);
  const keepEntryUom = isEmbaladoOrigem;
  const volumeRetirado = roundVolume(
    isMultiLote
      ? lotesRetirados.reduce((s, l) => s + (l.volume_retirado || 0), 0)
      : origem.volume_retirado || 0
  );

  const massaRetirada = (() => {
    if (keepEntryUom && isUnidadeMassaEntrada(unidadeMedida)) {
      const um = normalizeUnidadeEntrada(unidadeMedida);
      return um === "lb"
        ? roundMass(volumeRetirado * 0.453592)
        : roundMass(volumeRetirado);
    }
    return roundMass(volumeRetirado * densidade);
  })();

  // Embalado: saldo e retirada na UOM da entrada (sem kg→L)
  const saldoOperacional =
    keepEntryUom
      ? Math.round(Number(saldoDisponivel) || 0)
      : unidadeMedida === "kg" && densidade > 0
        ? saldoKgToLitros(saldoDisponivel, densidade, selectedSource)
        : roundVolume(saldoDisponivel);

  const saldoRestanteOp = Math.max(0, saldoOperacional - volumeRetirado);
  const saldoRestanteKg = keepEntryUom && isUnidadeMassaEntrada(unidadeMedida)
    ? roundMass(
        normalizeUnidadeEntrada(unidadeMedida) === "lb"
          ? saldoRestanteOp * 0.453592
          : saldoRestanteOp
      )
    : roundMass(saldoRestanteOp * densidade);

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
      unidade_medida: undefined,
      embalado: item?.value === "embalado",
      lotes_disponiveis: undefined,
      lotes_retirados: undefined,
    });
  };

  const handleSourceChange = (label, item) => {
    if (item) {
      const emb = isEstoqueEmbalado(item) || tipoOrigem === "embalado";
      const unid = item.unidade_medida || (emb ? "kg" : "L");
      const saldo = item.saldo_atual || 0;
      const saldoOp = emb
        ? Math.round(Number(saldo) || 0)
        : unid === "kg" && densidade > 0
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
        saldo_disponivel: saldoOp,
        unidade_medida: unid,
        embalado: emb,
        lotes_disponiveis: multi ? lotes : undefined,
        lotes_retirados: lotesRet,
        volume_retirado: 0,
        massa_retirada: 0,
        saldo_restante: saldoOp,
      });
    }
  };

  const handleVolumeChange = (val) => {
    const v = roundVolume(val);
    const massa =
      keepEntryUom && isUnidadeMassaEntrada(unidadeMedida)
        ? normalizeUnidadeEntrada(unidadeMedida) === "lb"
          ? roundMass(v * 0.453592)
          : roundMass(v)
        : roundMass(v * densidade);
    onChange({
      ...origem,
      volume_retirado: v,
      massa_retirada: massa,
      saldo_restante: Math.max(0, saldoOperacional - v),
      unidade_medida: unidadeMedida,
      embalado: keepEntryUom,
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
    const massa =
      keepEntryUom && isUnidadeMassaEntrada(unidadeMedida)
        ? roundMass(total)
        : roundMass(total * densidade);
    onChange({
      ...origem,
      lotes_disponiveis: lotesDisponiveis,
      lotes_retirados: next,
      volume_retirado: total,
      massa_retirada: massa,
      lote: firstWithVol?.lote || next[0]?.lote || origem.lote || "",
      saldo_restante: Math.max(0, saldoOperacional - total),
      unidade_medida: unidadeMedida,
      embalado: keepEntryUom,
    });
  };

  const excedeuSaldo = volumeRetirado > saldoOperacional;
  const excedeuLote = lotesRetirados.some(
    (l) => roundVolume(l.volume_retirado) > roundVolume(l.saldo_disponivel)
  );
  const tipoValue = TIPOS_ORIGEM.find((t) => t.value === tipoOrigem)?.label || "";

  const volumeDestinadoL = roundVolume(volumeDestinado);
  const volumeDiffOrigem = Math.abs(volumeRetirado - volumeDestinadoL);
  const origemBalanceada =
    volumeRetirado > 0 && volumeDiffOrigem === 0 && destinosCount > 0;
  const volumePendenteOrigem = roundVolume(volumeRetirado - volumeDestinadoL);

  // Critérios alinhados à validação de submit em TransbordoModal.
  const origemPreenchida =
    !!tipoOrigem &&
    !!origem.entrada_id &&
    volumeRetirado > 0 &&
    !excedeuSaldo &&
    !excedeuLote;

  const origemNumero = `ORIGEM ${String(index + 1).padStart(2, "0")}`;
  const origemTitulo =
    origem.entrada_codigo || origemNumero;

  const loteResumo = isMultiLote
    ? lotesRetirados
        .filter((l) => (l.volume_retirado || 0) > 0)
        .map((l) => l.lote || "—")
        .join(", ") || "—"
    : origem.lote || "—";

  const collapseControls = (
    <div
      className="flex items-center gap-2 shrink-0"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          title={collapsed ? "Expandir origem" : "Recolher origem"}
          aria-label={collapsed ? "Expandir origem" : "Recolher origem"}
        >
          {collapsed ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronUp className="w-4 h-4" />
          )}
        </button>
      )}
      {!readOnly && !lockOrigem && !lockOrigemTipo && !isEntradaLocked && (
        <button
          type="button"
          onClick={onRemove}
          className="text-red-400 hover:text-red-600 transition-colors p-1"
          title="Excluir origem"
          aria-label="Excluir origem"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  const origemHeaderCollapsed = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5">
          {origemPreenchida && origemBalanceada && (
            <Check className="w-3.5 h-3.5 text-green-600 shrink-0" aria-hidden />
          )}
          <span className="text-sm font-semibold text-primary">{origemNumero}</span>
        </div>
        <p className="text-sm text-foreground/90 truncate">
          {[
            origem.entrada_codigo || null,
            loteResumo !== "—" ? loteResumo : null,
          ]
            .filter(Boolean)
            .join(" • ") || "Origem não configurada"}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatQtd(volumeRetirado, unidadeMedida)} {unidadeLabel} retirados •{" "}
          {formatQtd(volumeDestinadoL, unidadeMedida)} {unidadeLabel} destinados
          {destinosCount > 0
            ? ` • ${destinosCount} destino${destinosCount === 1 ? "" : "s"}`
            : ""}
          {volumePendenteOrigem > 0
            ? ` • ${formatQtd(volumePendenteOrigem, unidadeMedida)} ${unidadeLabel} pendentes`
            : ""}
        </p>
      </div>
      {collapseControls}
    </div>
  );

  const origemHeaderExpanded = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
            {origemPreenchida && origemBalanceada && (
              <Check className="w-3.5 h-3.5 text-green-600 shrink-0" aria-hidden />
            )}
            {origemNumero}
          </span>
          {origem.entrada_codigo && (
            <span className="text-xs text-muted-foreground truncate">
              {origemTitulo}
              {tipoValue ? ` · ${tipoValue}` : ""}
            </span>
          )}
        </div>
      </div>
      {collapseControls}
    </div>
  );

  const multiLoteFields = isMultiLote && (
    <div className="col-span-full space-y-2">
      <Label>Lotes disponíveis</Label>
      <div className="rounded-md border border-border bg-card divide-y divide-border">
        {lotesRetirados.map((l, i) => {
          const excedeu =
            roundVolume(l.volume_retirado) > roundVolume(l.saldo_disponivel);
          return (
            <div
              key={`${l.lote || "lote"}-${i}`}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3"
            >
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Lote — Quantidade
                </Label>
                <Input
                  value={`${l.lote || "—"} — ${formatQtd(l.saldo_disponivel, unidadeMedida)} ${unidadeLabel}`}
                  disabled
                  className="bg-muted/40 font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Quantidade Retirada ({unidadeLabel}) *
                </Label>
                <NumberInputBr
                  decimals={0}
                  min={0}
                  max={l.saldo_disponivel || 0}
                  value={l.volume_retirado || ""}
                  onChange={(v) => handleLoteVolumeChange(i, v)}
                  placeholder="0"
                  disabled={origemLocked}
                  className="bg-white"
                />
                {excedeu && (
                  <p className="text-xs text-red-600">
                    ⚠ Superior ao saldo do lote (
                    {formatQtd(l.saldo_disponivel, unidadeMedida)} {unidadeLabel})
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
            {formatQtd(volumeRetirado, unidadeMedida)} {unidadeLabel}
          </span>
        </span>
        <span className="text-muted-foreground">
          Saldo restante:{" "}
          <span className="font-medium text-green-700">
            {formatQtd(saldoRestanteOp, unidadeMedida)} {unidadeLabel}
          </span>
        </span>
      </div>
    </div>
  );

  const destinosSection = (
    <div className="space-y-3 pt-4 mt-1 border-t border-primary/15">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-primary/80">
          Destinos
        </h4>
        {!readOnly && onAddDestino && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddDestino}
            className="h-8"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Adicionar destino
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-dashed border-primary/25 bg-muted/30 p-3 space-y-2.5">
        {destinosCount === 0 ? (
          <p className="text-sm text-muted-foreground py-3 px-2 text-center">
            Nenhum destino nesta origem.
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );

  const resumoOrigem = volumeRetirado > 0 || destinosCount > 0 ? (
    <div
      className={`rounded-md border px-3 py-3 space-y-2 ${
        volumeRetirado > 0 && destinosCount > 0
          ? origemBalanceada
            ? "border-green-200 bg-green-50/40"
            : "border-amber-200 bg-amber-50/40"
          : "border-border/70 bg-muted/20"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Resumo da origem
      </p>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground">Retirado</p>
          <p className="font-semibold tabular-nums">
            {formatQtd(volumeRetirado, unidadeMedida)} {unidadeLabel}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Destinado</p>
          <p className="font-semibold tabular-nums">
            {formatQtd(volumeDestinadoL, unidadeMedida)} {unidadeLabel}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Diferença</p>
          <p
            className={`font-semibold tabular-nums ${
              volumeRetirado > 0 && destinosCount > 0
                ? origemBalanceada
                  ? "text-green-700"
                  : "text-amber-700"
                : ""
            }`}
          >
            {formatQtd(volumeDiffOrigem, unidadeMedida)} {unidadeLabel}
          </p>
        </div>
      </div>
      {volumeRetirado > 0 && destinosCount > 0 && (
        <div className="pt-1">
          {origemBalanceada ? (
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Origem balanceada
            </div>
          ) : (
            <div className="space-y-0.5">
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                <AlertCircle className="w-3.5 h-3.5" />
                Divergência
              </div>
              <p className="text-xs text-muted-foreground">
                {volumePendenteOrigem > 0
                  ? `${formatQtd(volumePendenteOrigem, unidadeMedida)} ${unidadeLabel} ainda não destinados`
                  : `${formatQtd(Math.abs(volumePendenteOrigem), unidadeMedida)} ${unidadeLabel} destinados a mais`}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  ) : null;

  if (collapsed) {
    return (
      <div
        className={`rounded-xl border-2 border-primary/20 bg-card px-4 py-3.5 shadow-sm ${
          onToggleCollapse ? "cursor-pointer hover:border-primary/35 hover:bg-muted/20 transition-colors" : ""
        }`}
        onClick={onToggleCollapse}
        role={onToggleCollapse ? "button" : undefined}
        tabIndex={onToggleCollapse ? 0 : undefined}
        onKeyDown={
          onToggleCollapse
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggleCollapse();
                }
              }
            : undefined
        }
      >
        {origemHeaderCollapsed}
      </div>
    );
  }

  const fieldsLocked = isEntradaLocked && (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <div className="space-y-1.5">
        <Label>Tipo de Origem</Label>
        <Input
          value="Entrada (Estoque)"
          disabled
          className="bg-card font-medium text-primary"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Origem</Label>
        <Input
          value={origem.entrada_codigo || ""}
          disabled
          className="bg-card font-medium"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Lote</Label>
        <Input value={origem.lote || ""} disabled className="bg-card" />
      </div>
      <div className="space-y-1.5">
        <Label>Saldo Disponível ({unidadeLabel})</Label>
        <Input
          value={formatQtd(origem.saldo_disponivel || 0, unidadeMedida)}
          disabled
          className="bg-muted/40"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Quantidade Retirada ({unidadeLabel})</Label>
        <NumberInputBr
          decimals={0}
          min={0}
          value={origem.volume_retirado ?? ""}
          onChange={(v) => handleVolumeChange(v)}
          disabled={origemLocked}
          className="bg-white font-medium text-primary"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Saldo Restante ({unidadeLabel})</Label>
        <Input
          value={formatQtd(origem.saldo_restante ?? saldoRestanteOp, unidadeMedida)}
          disabled
          className="bg-card font-medium text-green-600"
        />
      </div>
      {!keepEntryUom || !isUnidadeMassaEntrada(unidadeMedida) ? (
        <div className="space-y-1.5">
          <Label>Massa Correspondente (kg)</Label>
          <Input
            value={formatMass(massaRetirada)}
            disabled
            className="bg-card font-medium"
          />
        </div>
      ) : null}
    </div>
  );

  const labelOrigemSource =
    tipoOrigem === "tanka"
      ? "Tanka *"
      : tipoOrigem === "vasilhame"
      ? "Vasilhame *"
      : tipoOrigem === "embalado"
      ? "Embalado *"
      : "Origem *";

  const placeholderOrigemSource =
    tipoOrigem === "tanka"
      ? "Selecionar tanka"
      : tipoOrigem === "vasilhame"
      ? "Selecionar vasilhame"
      : tipoOrigem === "embalado"
      ? "Selecionar embalado"
      : tipoOrigem
      ? "Selecionar origem"
      : "Selecione um tipo primeiro";

  const fieldsNormal = !isEntradaLocked && (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Tipo de Origem *</Label>
          <SearchableSelect
            value={tipoValue}
            onChange={handleTipoChange}
            options={TIPOS_ORIGEM_SELECIONAVEIS}
            getOptionLabel={(t) => t.label}
            getOptionValue={(t) => t.value}
            placeholder="Selecionar tipo"
            disabled={origemTipoLocked}
            inputClassName="bg-white"
          />
        </div>
        <div className="space-y-1.5">
          <Label>{labelOrigemSource}</Label>
          <SearchableSelect
            value={origem.entrada_codigo || ""}
            onChange={handleSourceChange}
            options={sourceOptions}
            getOptionLabel={(s) => s.display_label || ""}
            getOptionValue={(s) => s.id}
            placeholder={placeholderOrigemSource}
            disabled={origemLocked || !tipoOrigem}
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
              <Label>Quantidade Retirada ({unidadeLabel}) *</Label>
              <NumberInputBr
                decimals={0}
                min={0}
                value={origem.volume_retirado || ""}
                onChange={(v) => handleVolumeChange(v)}
                placeholder="0"
                disabled={origemLocked}
                className="bg-white"
              />
              {(excedeuSaldo || excedeuLote) && (
                <p className="text-xs text-red-600">
                  ⚠ Quantidade superior ao saldo disponível (
                  {formatQtd(saldoOperacional, unidadeMedida)} {unidadeLabel})
                </p>
              )}
            </div>
          </>
        )}

        {(!keepEntryUom || !isUnidadeMassaEntrada(unidadeMedida)) && (
          <div className="space-y-1.5">
            <Label>Massa Correspondente (kg)</Label>
            <Input
              value={formatMass(massaRetirada)}
              disabled
              className="bg-card font-medium"
            />
          </div>
        )}
      </div>
      {!isMultiLote && (
        <div className="flex items-center gap-4 text-xs">
          <span className="text-muted-foreground">
            Saldo restante:{" "}
            <span className="font-medium text-green-700">
              {formatQtd(saldoRestanteOp, unidadeMedida)} {unidadeLabel}
            </span>
          </span>
          {!keepEntryUom && unidadeMedida !== "L" && (
            <span className="text-muted-foreground">
              /{" "}
              <span className="font-medium text-green-700">
                {formatMass(saldoRestanteKg)} {unidadeMedida}
              </span>
            </span>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="rounded-xl border-2 border-primary/25 bg-card p-5 space-y-4 shadow-sm ring-1 ring-primary/5">
      {origemHeaderExpanded}
      {fieldsLocked}
      {fieldsNormal}
      {destinosSection}
      {resumoOrigem}
    </div>
  );
}
