import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Switch } from "@shared/components/ui/switch";
import { Check, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import {
  formatVolume,
  formatMass,
  roundVolume,
  roundMass,
} from "@transbordo/lib/format";
import {
  TIPOS_EMBALAGEM_DESTINO,
  VOLUME_PADRAO_EMBALAGEM,
  isDestinoEstoqueEmbalado,
  labelTipoEmbalagem,
} from "@transbordo/lib/tiposEmbalagem";

const INPUT_EDITABLE = "bg-white";

/**
 * Critérios alinhados à validação por destino em TransbordoModal.handleSubmit:
 * - tipo obrigatório
 * - IBC/Bombona/Tambor: qtd e volume por embalagem > 0
 * - demais: volume_total > 0 (necessário para a conferência fechar)
 */
function isDestinoPreenchido(destino, volumeExcedido) {
  const tipo = destino.tipo_embalagem || "";
  if (!tipo) return false;
  if (volumeExcedido) return false;
  if (isDestinoEstoqueEmbalado(tipo)) {
    return (
      Number(destino.quantidade_embalagens) > 0 &&
      Number(destino.volume_por_embalagem) > 0
    );
  }
  return roundVolume(destino.volume_total || destino.volume || 0) > 0;
}

function buildDestinoResumo(destino, tipoLabel, index) {
  const tipo = destino.tipo_embalagem || "";
  const fallback = `DESTINO ${String(index + 1).padStart(2, "0")}`;

  if (tipo === "Tankagem") {
    return {
      title: destino.tanka_codigo || fallback,
      subtitle: tipoLabel || "Tankagem",
    };
  }
  if (tipo === "Vasilhame") {
    const parts = [];
    if (destino.placa) parts.push(destino.placa);
    if (destino.barril) parts.push(`Barril ${destino.barril}`);
    return {
      title: parts.length ? parts.join(" • ") : fallback,
      subtitle: destino.fracionado
        ? `${tipoLabel || "Vasilhames"} · Fracionado`
        : tipoLabel || "Vasilhames",
    };
  }
  if (isDestinoEstoqueEmbalado(tipo)) {
    const qtd = Math.round(destino.quantidade_embalagens || 0);
    return {
      title:
        qtd > 0
          ? `${tipoLabel} · ${qtd} ${qtd === 1 ? "unidade" : "unidades"}`
          : tipoLabel || fallback,
      subtitle: tipoLabel || "",
    };
  }
  return {
    title: fallback,
    subtitle: tipoLabel || "Selecione o tipo de destino",
  };
}

function FieldGroup({ title, children }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {children}
      </div>
    </div>
  );
}

export default function DestinoCard({
  index,
  destino,
  isotanques,
  vasilhames = [],
  produtoId,
  produtoNome,
  densidade,
  preserveEntryMass = false,
  unidadeEntrada = "L",
  onChange,
  onRemove,
  readOnly,
  collapsed = false,
  onToggleCollapse,
}) {
  const tipo = destino.tipo_embalagem || "";
  const tipoLabel = labelTipoEmbalagem(tipo) || tipo;

  const fracionadoVasilhames = vasilhames.filter(
    (v) =>
      v.fracionado === true &&
      (v.status || "No Pátio") === "No Pátio" &&
      (v.produto_id === produtoId ||
        (produtoNome &&
          v.produto_nome?.toLowerCase() === produtoNome.toLowerCase()))
  );

  const selectedFracionado =
    fracionadoVasilhames.find(
      (v) =>
        (destino.vasilhame_existente_id &&
          v.id === destino.vasilhame_existente_id) ||
        (v.placa &&
          v.placa === destino.placa &&
          String(v.barril || "") === String(destino.barril || ""))
    ) ||
    fracionadoVasilhames.find((v) => v.placa && v.placa === destino.placa);

  // Lista suspensa: somente tanques fracionados no pátio do produto selecionado
  const vasilhameCadastrados = (() => {
    const unique = fracionadoVasilhames.filter(
      (v, i, arr) =>
        v.placa &&
        arr.findIndex((x) => x.placa === v.placa && x.barril === v.barril) === i
    );
    return unique;
  })();

  const volumeEnvasado = roundVolume(destino.volume_total || destino.volume || 0);
  const unidadeLabel =
    String(unidadeEntrada || "L").trim().toLowerCase() === "kg"
      ? "kg"
      : String(unidadeEntrada || "L").trim().toLowerCase() === "lb"
        ? "lb"
        : "L";

  const recalc = (d) => {
    const pesoFromQty = (qty) =>
      preserveEntryMass ? roundMass(qty) : roundMass(qty * densidade);

    if (d.tipo_embalagem === "Vasilhame") {
      d.volume = roundVolume(d.volume);
      d.volume_total = d.volume;
      d.peso_liquido = pesoFromQty(d.volume);
      d.peso_bruto = roundMass((d.tara || 0) + (d.peso_liquido || 0));
    } else if (d.tipo_embalagem === "Tankagem") {
      d.volume = roundVolume(d.volume);
      d.volume_total = d.volume;
      d.peso_liquido = pesoFromQty(d.volume);
    } else {
      d.quantidade_embalagens = Math.round(d.quantidade_embalagens || 0);
      d.volume_por_embalagem = roundVolume(d.volume_por_embalagem);
      d.volume_total = roundVolume(
        (d.quantidade_embalagens || 0) * (d.volume_por_embalagem || 0)
      );
      d.peso_liquido = pesoFromQty(d.volume_total);
    }
  };

  const updateField = (field, value) => {
    const updated = { ...destino, [field]: value };
    recalc(updated);
    onChange(updated);
  };

  const handleTipoChange = (label, item) => {
    const tipoValue = item?.value || label;
    const volumePadrao = VOLUME_PADRAO_EMBALAGEM[tipoValue];
    const updated = {
      ...destino,
      tipo_embalagem: tipoValue,
      volume: 0,
      quantidade_embalagens: 0,
      volume_por_embalagem: volumePadrao ?? 0,
      peso_liquido: 0,
      peso_bruto: 0,
      tara: 0,
      volume_total: 0,
    };
    recalc(updated);
    onChange(updated);
  };

  const handleTankaChange = (label, item) => {
    if (item) {
      const updated = {
        ...destino,
        tanka_id: item.id,
        tanka_codigo: label,
      };
      recalc(updated);
      onChange(updated);
    }
  };

  const selectedTanka = isotanques.find((i) => i.id === destino.tanka_id);
  const tankaCapacidade = roundVolume(selectedTanka?.capacidade || 0);
  const volumeExcedido =
    tipo === "Tankagem" &&
    tankaCapacidade > 0 &&
    roundVolume(destino.volume || 0) > tankaCapacidade;

  const destinoPreenchido = isDestinoPreenchido(destino, volumeExcedido);
  const { title: destinoTitulo, subtitle: destinoSubtitulo } = buildDestinoResumo(
    destino,
    tipoLabel,
    index
  );

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
          title={collapsed ? "Expandir destino" : "Recolher destino"}
          aria-label={collapsed ? "Expandir destino" : "Recolher destino"}
        >
          {collapsed ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronUp className="w-4 h-4" />
          )}
        </button>
      )}
      {!readOnly && (
        <button
          type="button"
          onClick={onRemove}
          className="text-red-400 hover:text-red-600 transition-colors p-1"
          title="Excluir destino"
          aria-label="Excluir destino"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  const destinoHeader = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {destinoPreenchido && (
            <Check className="w-3.5 h-3.5 text-green-600 shrink-0" aria-hidden />
          )}
          <span className="text-sm font-semibold text-foreground truncate">
            {destinoTitulo}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate pl-5">
          {destinoSubtitulo}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-sm font-semibold text-foreground tabular-nums">
          {preserveEntryMass
            ? `${formatMass(volumeEnvasado)} ${unidadeLabel}`
            : `${formatVolume(volumeEnvasado)} L`}
        </span>
        {collapseControls}
      </div>
    </div>
  );

  if (collapsed) {
    return (
      <div
        className={`rounded-lg border-2 border-border bg-card px-3.5 py-3 shadow-sm ${
          onToggleCollapse ? "cursor-pointer hover:border-primary/30 hover:bg-muted/20 transition-colors" : ""
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
        {destinoHeader}
      </div>
    );
  }

  return (
    <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4 shadow-sm">
      {destinoHeader}

      <div className="space-y-1.5 max-w-md">
        <Label>Tipo de Destino *</Label>
        <SearchableSelect
          value={labelTipoEmbalagem(tipo) || tipo}
          onChange={handleTipoChange}
          options={TIPOS_EMBALAGEM_DESTINO}
          getOptionLabel={(o) => o.label}
          getOptionValue={(o) => o.value}
          placeholder="Selecione..."
          disabled={readOnly}
          inputClassName={INPUT_EDITABLE}
        />
      </div>

      {tipo === "Vasilhame" && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Nº da Placa</Label>
              <SearchableSelect
                value={destino.placa || ""}
                onChange={(label, item) => {
                  if (item) {
                    const isFracionadoPatio =
                      item.fracionado === true &&
                      (item.status || "No Pátio") === "No Pátio";
                    const sameTank = destino.vasilhame_existente_id === item.id;
                    const updated = {
                      ...destino,
                      placa: item.placa,
                      barril: item.barril || destino.barril || "",
                      tara: item.tara != null ? roundMass(item.tara) : destino.tara,
                      vasilhame_existente_id: isFracionadoPatio ? item.id : null,
                      fracionado: isFracionadoPatio
                        ? sameTank
                          ? !!destino.fracionado
                          : false
                        : false,
                    };
                    recalc(updated);
                    onChange(updated);
                  } else {
                    updateField("placa", label);
                    onChange({
                      ...destino,
                      placa: label,
                      vasilhame_existente_id: null,
                    });
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
                  será somado a este registro. Deixe &quot;Destino fracionado&quot;
                  desmarcado se o tanque estiver sendo completado.
                </p>
              )}
            </div>
            <Field
              label="Nº do Barril"
              value={destino.barril}
              onChange={(v) => updateField("barril", v)}
              placeholder="Nº barril"
              readOnly={readOnly}
            />
            <IntegerField
              label={
                preserveEntryMass
                  ? `Quantidade (${unidadeLabel}) *`
                  : "Volume (L) *"
              }
              value={destino.volume}
              onChange={(v) => updateField("volume", v)}
              readOnly={readOnly}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <IntegerField
              label="Tara (kg)"
              value={destino.tara}
              onChange={(v) => updateField("tara", v)}
              readOnly={readOnly}
            />
            <div className="sm:col-span-2">
              <Field
                label="Lacres"
                value={destino.lacres}
                onChange={(v) => updateField("lacres", v)}
                placeholder="Nº lacres"
                readOnly={readOnly}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field
              label="Eslinga"
              value={destino.eslinga}
              onChange={(v) => updateField("eslinga", v)}
              placeholder="Eslinga"
              readOnly={readOnly}
            />
            <Field
              label="GPS"
              value={destino.gps}
              onChange={(v) => updateField("gps", v)}
              placeholder="GPS"
              readOnly={readOnly}
            />
            <div className="space-y-1.5">
              <Label>Menor Teste</Label>
              <Input
                type="date"
                value={destino.menor_teste || ""}
                onChange={(e) => updateField("menor_teste", e.target.value)}
                disabled={readOnly}
                className={INPUT_EDITABLE}
              />
            </div>
          </div>

          <div className="rounded-md border border-border/80 bg-background/60 px-3 py-3 space-y-1">
            <div className="flex items-center gap-2">
              <Switch
                checked={destino.fracionado || false}
                onCheckedChange={(checked) => updateField("fracionado", checked)}
                disabled={readOnly}
              />
              <Label
                className="cursor-pointer font-medium"
                onClick={() =>
                  !readOnly && updateField("fracionado", !destino.fracionado)
                }
              >
                Destino fracionado
              </Label>
            </div>
            <p className="text-xs text-muted-foreground pl-0 sm:pl-[2.25rem]">
              Permite registrar o destino antes de completar sua capacidade.
              Desmarque ao completar o tanque.
            </p>
          </div>
        </div>
      )}

      {tipo === "Tankagem" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
          <div className="space-y-1.5">
            <Label>Tanka *</Label>
            <SearchableSelect
              value={destino.tanka_codigo || ""}
              onChange={handleTankaChange}
              options={isotanques}
              getOptionLabel={(i) => i.tanka || i.codigo_itku || ""}
              getOptionValue={(i) => i.id}
              placeholder="Selecionar tanka"
              disabled={readOnly}
              inputClassName={INPUT_EDITABLE}
            />
            {tankaCapacidade > 0 && (
              <p className="text-xs text-muted-foreground">
                Capacidade: {formatVolume(tankaCapacidade)} L
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Volume (L) *</Label>
            <NumberInputBr
              decimals={0}
              value={destino.volume || ""}
              onChange={(v) => updateField("volume", v === "" ? "" : roundVolume(v))}
              placeholder="0"
              disabled={readOnly}
              className={INPUT_EDITABLE}
            />
            {volumeExcedido && (
              <p className="text-xs text-red-600">
                ⚠ Capacidade do tanka excedida!
              </p>
            )}
          </div>
        </div>
      )}

      {isDestinoEstoqueEmbalado(tipo) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl">
          <IntegerField
            label="Qtd. Embalagens"
            value={destino.quantidade_embalagens}
            onChange={(v) => updateField("quantidade_embalagens", v)}
            readOnly={readOnly}
          />
          <IntegerField
            label={
              preserveEntryMass
                ? `Quantidade por Embalagem (${unidadeLabel})`
                : "Volume por Embalagem (L)"
            }
            value={destino.volume_por_embalagem}
            onChange={(v) => updateField("volume_por_embalagem", v)}
            readOnly={readOnly}
          />
          <div className="space-y-1.5">
            <Label>
              {preserveEntryMass
                ? `Quantidade Total (${unidadeLabel}) - auto`
                : "Volume Total (L) - auto"}
            </Label>
            <Input
              value={
                preserveEntryMass
                  ? formatMass(destino.volume_total || 0)
                  : formatVolume(destino.volume_total || 0)
              }
              disabled
              className="bg-card font-medium"
            />
          </div>
        </div>
      )}

      {tipo && (
        <div className="flex justify-end pt-1 border-t border-border/60">
          <span className="text-xs text-muted-foreground">
            {preserveEntryMass ? "Quantidade deste destino:" : "Volume deste destino:"}{" "}
            <span className="font-medium text-primary">
              {preserveEntryMass
                ? `${formatMass(destino.volume_total || 0)} ${unidadeLabel}`
                : `${formatVolume(destino.volume_total || 0)} L`}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, readOnly }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={readOnly}
        className={INPUT_EDITABLE}
      />
    </div>
  );
}

function IntegerField({ label, value, onChange, readOnly }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <NumberInputBr
        decimals={0}
        value={value ?? ""}
        onChange={(v) => onChange(v === "" ? "" : roundVolume(v))}
        placeholder="0"
        disabled={readOnly}
        className={INPUT_EDITABLE}
      />
    </div>
  );
}
