import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Switch } from "@shared/components/ui/switch";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
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

export default function DestinoCard({
  index,
  destino,
  isotanques,
  vasilhames = [],
  produtoId,
  produtoNome,
  densidade,
  onChange,
  onRemove,
  readOnly,
  collapsed = false,
  onToggleCollapse,
}) {
  const tipo = destino.tipo_embalagem || "";

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
  const massaEnvasada = roundMass(
    destino.peso_liquido ||
      (densidade > 0 ? volumeEnvasado * densidade : 0)
  );

  const recalc = (d) => {
    if (d.tipo_embalagem === "Vasilhame") {
      d.volume = roundVolume(d.volume);
      d.volume_total = d.volume;
      d.peso_liquido = roundMass(d.volume * densidade);
      d.peso_bruto = roundMass((d.tara || 0) + (d.peso_liquido || 0));
    } else if (d.tipo_embalagem === "Tankagem") {
      d.volume = roundVolume(d.volume);
      d.volume_total = d.volume;
      d.peso_liquido = roundMass(d.volume * densidade);
    } else {
      d.quantidade_embalagens = Math.round(d.quantidade_embalagens || 0);
      d.volume_por_embalagem = roundVolume(d.volume_por_embalagem);
      d.volume_total = roundVolume(
        (d.quantidade_embalagens || 0) * (d.volume_por_embalagem || 0)
      );
      d.peso_liquido = roundMass(d.volume_total * densidade);
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

  if (collapsed) {
    return (
      <div className="rounded-lg border border-border bg-muted/40/50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0 flex-1">
            <span className="text-sm font-semibold text-primary shrink-0">
              Destino {String(index + 1).padStart(2, "0")}
            </span>
            <span className="text-sm text-foreground/80">
              <span className="text-muted-foreground">Tipo:</span>{" "}
              {labelTipoEmbalagem(tipo) || tipo || "—"}
            </span>
            <span className="text-sm text-foreground/80">
              <span className="text-muted-foreground">Volume:</span>{" "}
              {formatVolume(volumeEnvasado)} L
            </span>
            <span className="text-sm text-foreground/80">
              <span className="text-muted-foreground">Massa:</span>{" "}
              {formatMass(massaEnvasada)} kg
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                title="Maximizar destino"
                aria-label="Maximizar destino"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={onRemove}
                className="text-red-400 hover:text-red-600 transition-colors"
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
    <div className="rounded-lg border border-border bg-muted/40/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-primary">
          Destino {String(index + 1).padStart(2, "0")}
        </span>
        <div className="flex items-center gap-2">
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
              title="Minimizar destino"
              aria-label="Minimizar destino"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              onClick={onRemove}
              className="text-red-400 hover:text-red-600 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Tipo de Embalagem *</Label>
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
        <div className="grid grid-cols-3 gap-3">
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
                será somado a este registro. Deixe &quot;Fracionado&quot;
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
            label="Volume (L) *"
            value={destino.volume}
            onChange={(v) => updateField("volume", v)}
            readOnly={readOnly}
          />
          <IntegerField
            label="Tara (kg)"
            value={destino.tara}
            onChange={(v) => updateField("tara", v)}
            readOnly={readOnly}
          />
          <Field
            label="Lacres"
            value={destino.lacres}
            onChange={(v) => updateField("lacres", v)}
            placeholder="Nº lacres"
            readOnly={readOnly}
          />
          <div className="space-y-1.5">
            <Label>Peso Líquido (kg) - auto</Label>
            <Input
              value={formatMass(destino.peso_liquido || 0)}
              disabled
              className="bg-card font-medium"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Peso Bruto (kg) - auto</Label>
            <Input
              value={formatMass(destino.peso_bruto || 0)}
              disabled
              className="bg-card font-medium"
            />
          </div>
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
          <div className="col-span-3 flex items-center gap-2 pt-1">
            <Switch
              checked={destino.fracionado || false}
              onCheckedChange={(checked) => updateField("fracionado", checked)}
              disabled={readOnly}
            />
            <Label
              className="cursor-pointer"
              onClick={() =>
                !readOnly && updateField("fracionado", !destino.fracionado)
              }
            >
              Fracionado (desmarque ao completar o tanque)
            </Label>
          </div>
        </div>
      )}

      {tipo === "Tankagem" && (
        <div className="grid grid-cols-2 gap-3">
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
        <div className="grid grid-cols-3 gap-3">
          <IntegerField
            label="Qtd. Embalagens"
            value={destino.quantidade_embalagens}
            onChange={(v) => updateField("quantidade_embalagens", v)}
            readOnly={readOnly}
          />
          <IntegerField
            label="Volume por Embalagem (L)"
            value={destino.volume_por_embalagem}
            onChange={(v) => updateField("volume_por_embalagem", v)}
            readOnly={readOnly}
          />
          <div className="space-y-1.5">
            <Label>Volume Total (L) - auto</Label>
            <Input
              value={formatVolume(destino.volume_total || 0)}
              disabled
              className="bg-card font-medium"
            />
          </div>
        </div>
      )}

      {tipo && (
        <div className="flex justify-end">
          <span className="text-xs text-muted-foreground">
            Volume deste destino:{" "}
            <span className="font-medium text-primary">
              {formatVolume(destino.volume_total || 0)} L
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
