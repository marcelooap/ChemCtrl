import { useEffect } from "react";
import { Input } from "@shared/components/ui/input";
import { Textarea } from "@shared/components/ui/textarea";
import { Label } from "@shared/components/ui/label";
import { Switch } from "@shared/components/ui/switch";
import { AlertCircle, Check, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import {
  formatVolume,
  formatMass,
  formatQuantidade,
  roundVolume,
  roundMass,
  qtdEmbalagensFromVolume,
} from "@transbordo/lib/format";
import {
  TIPOS_EMBALAGEM_DESTINO,
  VOLUME_PADRAO_EMBALAGEM,
  isDestinoEstoqueEmbalado,
  isVasilhameLegadoEmbalado,
  labelTipoEmbalagem,
} from "@transbordo/lib/tiposEmbalagem";
import {
  VASILHAME_EM_ESTOQUE_MSG,
  destinoLancaTanqueDuplicado,
  tanqueEstaCheio,
  volumeAcumuladoDoTanque,
} from "@transbordo/lib/vasilhameComposicao";
import { resolveFracionadosParaEnvase } from "@transbordo/lib/validacaoTransbordo";

const INPUT_EDITABLE = "bg-card";

function isRealVasilhameId(id) {
  if (id == null || id === "") return false;
  return !String(id).startsWith("pending-fracionado:");
}

function findVasilhameCadastro(placa, vasilhames = []) {
  if (!placa) return null;
  const key = String(placa).trim().toUpperCase();
  if (!key) return null;
  const matches = (vasilhames || []).filter(
    (v) => String(v.placa || "").trim().toUpperCase() === key
  );
  if (matches.length === 0) return null;
  const withTara = matches.find((v) => Number(v.tara) > 0);
  return withTara || matches[0];
}

function formatMenorTesteInput(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function tanqueIdentityKey(placa, barril) {
  return `${String(placa || "").trim().toUpperCase()}|${String(barril || "")
    .trim()
    .toUpperCase()}`;
}

/** Próximo tanque fracionado livre (FIFO), ignorando os já usados em outras linhas. */
function pickNextFracionadoDisponivel(
  fracionadosSorted = [],
  todosDestinos = [],
  currentDestino = null
) {
  const usedIds = new Set();
  const usedKeys = new Set();

  (todosDestinos || []).forEach((d) => {
    // Referência (não índice): no TransbordoModal o index do card é local por origem.
    if (currentDestino && d === currentDestino) return;
    if ((d?.tipo_embalagem || "") !== "Vasilhame") return;
    if (d.vasilhame_existente_id) usedIds.add(String(d.vasilhame_existente_id));
    const placa = String(d.placa || "").trim();
    const barril = String(d.barril || "").trim();
    if (placa || barril) usedKeys.add(tanqueIdentityKey(placa, barril));
  });

  return (
    fracionadosSorted.find((v) => {
      if (v?.id && usedIds.has(String(v.id))) return false;
      const key = tanqueIdentityKey(v.placa, v.barril);
      if (!key || key === "|") return false;
      return !usedKeys.has(key);
    }) || null
  );
}

/** Preenche identidade + lacres/eslinga/gps/menor teste a partir do tanque fracionado. */
function applyFracionadoTanqueToDestino(destino, matched, { keepFracionadoFlag = false } = {}) {
  if (!matched) return { ...destino };

  const semPlaca =
    !String(matched.placa || "").trim() && String(matched.barril || "").trim();
  const placaText = semPlaca ? "" : String(matched.placa || "").trim();

  let novaTara = destino.tara;
  if (
    matched.tara != null &&
    matched.tara !== "" &&
    Number(matched.tara) >= 0
  ) {
    novaTara = roundMass(matched.tara);
  }

  return {
    ...destino,
    placa: placaText,
    barril: semPlaca
      ? matched.barril
      : matched.barril || destino.barril || "",
    tara: novaTara,
    vasilhame_existente_id: isRealVasilhameId(matched.id) ? matched.id : null,
    fracionado: keepFracionadoFlag ? !!destino.fracionado : false,
    lacres: matched.lacres != null ? String(matched.lacres) : "",
    eslinga: matched.eslinga != null ? String(matched.eslinga) : "",
    gps: matched.gps != null ? String(matched.gps) : "",
    menor_teste: formatMenorTesteInput(matched.menor_teste),
    observacao: String(matched.observacao || "").trim(),
  };
}

/**
 * Critérios alinhados à validação por destino em TransbordoModal.handleSubmit:
 * - tipo obrigatório
 * - IBC/Bombona/Tambor: volume total e volume por embalagem > 0 (qtd editável)
 * - Vasilhame: volume > 0 e tara > 0
 * - demais: volume_total > 0 (necessário para a conferência fechar)
 */
function isDestinoPreenchido(destino, volumeExcedido) {
  const tipo = destino.tipo_embalagem || "";
  if (!tipo) return false;
  if (volumeExcedido) return false;
  if (isDestinoEstoqueEmbalado(tipo)) {
    return (
      roundVolume(destino.volume_total || destino.volume || 0) > 0 &&
      roundVolume(destino.volume_por_embalagem || 0) > 0 &&
      Number(destino.quantidade_embalagens) > 0
    );
  }
  if (tipo === "Vasilhame") {
    return (
      roundVolume(destino.volume_total || destino.volume || 0) > 0 &&
      Number(destino.tara) > 0
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
    const qtd = roundVolume(destino.quantidade_embalagens || 0);
    const qtdLabel = formatQuantidade(qtd, { empty: "" });
    return {
      title:
        qtd > 0
          ? `${tipoLabel} · ${qtdLabel} ${qtd === 1 ? "embalagem" : "embalagens"}`
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
  exigeDensidade = false,
  onChange,
  onRemove,
  readOnly,
  collapsed = false,
  onToggleCollapse,
  excludeTransbordoId = null,
  excludeTransbordoCodigo = "",
  todosDestinos = [],
  /** Validações ainda pendentes (Ordem de Transbordo) — fracionados ainda não materializados. */
  validacoesPendentes = [],
  excludeValidacaoId = null,
}) {
  const tipo = destino.tipo_embalagem || "";
  const tipoLabel = labelTipoEmbalagem(tipo) || tipo;

  // Inclui tanques fracionados do pátio + destinos fracionados de OPs ainda não validados.
  const fracionadoVasilhames = resolveFracionadosParaEnvase({
    vasilhames,
    validacoesPendentes,
    produtoId,
    produtoNome,
    excludeValidacaoId,
  });

  const selectedFracionado =
    fracionadoVasilhames.find(
      (v) =>
        (destino.vasilhame_existente_id &&
          v.id === destino.vasilhame_existente_id) ||
        (v.placa &&
          v.placa === destino.placa &&
          String(v.barril || "") === String(destino.barril || ""))
    ) ||
    fracionadoVasilhames.find((v) => v.placa && v.placa === destino.placa) ||
    (!String(destino.placa || "").trim() && String(destino.barril || "").trim()
      ? fracionadoVasilhames.find(
          (v) =>
            !String(v.placa || "").trim() &&
            String(v.barril || "").trim().toUpperCase() ===
              String(destino.barril || "").trim().toUpperCase()
        )
      : null);

  // Lista suspensa: tanques fracionados no pátio com prioridade + todos os tanques cadastrados
  const vasilhameOpcoes = (() => {
    const fracionadosKeys = new Set();
    const result = [];

    // 1. Tanques fracionados no pátio do produto (placa ou só barril)
    for (const v of fracionadoVasilhames) {
      const placa = String(v.placa || "").trim();
      const barril = String(v.barril || "").trim();
      if (!placa && !barril) continue;
      const key = `${placa.toUpperCase()}|${barril.toUpperCase()}`;
      if (!fracionadosKeys.has(key)) {
        fracionadosKeys.add(key);
        result.push({
          ...v,
          _isFracionado: true,
          displayLabel: placa
            ? `${placa}${barril ? ` - ${barril}` : ""} (Fracionado · ${formatVolume(v.volume)} L)`
            : `${barril} (Fracionado · ${formatVolume(v.volume)} L)`,
        });
      }
    }

    // 2. Todos os demais tanques cadastrados em Vasilhames
    const allKeys = new Set(fracionadosKeys);
    for (const v of vasilhames || []) {
      if (!v.placa) continue;
      if (
        isDestinoEstoqueEmbalado(v.tipo) ||
        isVasilhameLegadoEmbalado(v.tipo) ||
        v.tipo === "Tankagem"
      ) {
        continue;
      }
      const key = `${String(v.placa).trim().toUpperCase()}|${String(v.barril || "").trim().toUpperCase()}`;
      if (!allKeys.has(key)) {
        allKeys.add(key);
        result.push({
          ...v,
          _isFracionado: false,
          displayLabel: `${v.placa}${v.barril ? ` - ${v.barril}` : ""}${
            Number(v.tara) > 0 ? ` (Tara: ${formatMass(v.tara)} kg)` : ""
          }`,
        });
      }
    }

    return result;
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
      d.volume_por_embalagem = roundVolume(d.volume_por_embalagem);
      d.volume_total = roundVolume(d.volume_total ?? d.volume ?? 0);
      d.volume = d.volume_total;
      d.quantidade_embalagens = qtdEmbalagensFromVolume(
        d.volume_total,
        d.volume_por_embalagem
      );
      d.peso_liquido = pesoFromQty(d.volume_total);
    }
  };

  const updateField = (field, value) => {
    const updated = { ...destino, [field]: value };
    recalc(updated);
    onChange(updated);
  };

  const volumeAcumulado =
    tipo === "Vasilhame"
      ? volumeAcumuladoDoTanque(
          todosDestinos.length > 0 ? todosDestinos : [destino],
          {
            placa: destino.placa,
            barril: destino.barril,
            vasilhames,
            codigoOp: excludeTransbordoCodigo,
          }
        )
      : 0;
  const cadastroTanque = findVasilhameCadastro(destino.placa, vasilhames);
  const capacidadeTanque =
    selectedFracionado?.capacidade ??
    (destino.vasilhame_existente_id
      ? vasilhames.find((v) => v.id === destino.vasilhame_existente_id)
          ?.capacidade
      : undefined) ??
    cadastroTanque?.capacidade;
  const tanqueCheio =
    tipo === "Vasilhame" && tanqueEstaCheio(volumeAcumulado, capacidadeTanque);

  useEffect(() => {
    if (readOnly || !tanqueCheio || !destino.fracionado) return;
    updateField("fracionado", false);
  }, [tanqueCheio, destino.fracionado, readOnly]);

  const handleTipoChange = (label, item) => {
    const tipoValue = item?.value || label;
    const volumePadrao = VOLUME_PADRAO_EMBALAGEM[tipoValue];
    let updated = {
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

    // Ao selecionar Vasilhame: sugere o tanque fracionado mais antigo ainda livre.
    if (tipoValue === "Vasilhame") {
      const nextFracionado = pickNextFracionadoDisponivel(
        fracionadoVasilhames,
        todosDestinos.length > 0 ? todosDestinos : [destino],
        destino
      );
      if (nextFracionado) {
        updated = applyFracionadoTanqueToDestino(updated, nextFracionado);
      } else {
        updated = {
          ...updated,
          placa: "",
          barril: "",
          vasilhame_existente_id: null,
          fracionado: false,
          lacres: "",
          eslinga: "",
          gps: "",
          menor_teste: "",
        };
      }
    }

    recalc(updated);
    onChange(updated);
  };

  const handleTankaChange = (label, item) => {
    if (item) {
      const codigo =
        item.nome || item.tanka || item.codigo_itku || label || "";
      const updated = {
        ...destino,
        tanka_id: item.id,
        tanka_codigo: codigo,
      };
      recalc(updated);
      onChange(updated);
    }
  };

  const selectedTanka =
    isotanques.find((i) => i.id === destino.tanka_id) ||
    isotanques.find((i) => {
      const nome = i.nome || i.tanka || i.name || "";
      return (
        (nome && nome === destino.tanka_codigo) ||
        (i.codigo_itku && i.codigo_itku === destino.tanka_codigo)
      );
    });
  const tankaCapacidade = roundVolume(selectedTanka?.capacidade || 0);
  const tankaSaldoAtual = roundVolume(selectedTanka?.saldo_atual || 0);
  const tankaVolumeDisponivelBruto =
    selectedTanka?.volume_disponivel != null
      ? roundVolume(selectedTanka.volume_disponivel)
      : Math.max(0, tankaCapacidade - tankaSaldoAtual);
  // Reserva o espaço já apontado em outras linhas deste envase para o mesmo tanka.
  const volumeOutrosDestinosMesmoTanka = (todosDestinos || []).reduce(
    (sum, other, i) => {
      if (i === index) return sum;
      if (other?.tipo_embalagem !== "Tankagem") return sum;
      const mesmoTanka =
        (destino.tanka_id && other.tanka_id === destino.tanka_id) ||
        (destino.tanka_codigo &&
          other.tanka_codigo === destino.tanka_codigo);
      if (!mesmoTanka) return sum;
      return sum + roundVolume(other.volume_total || other.volume || 0);
    },
    0
  );
  const tankaVolumeDisponivel = Math.max(
    0,
    roundVolume(tankaVolumeDisponivelBruto - volumeOutrosDestinosMesmoTanka)
  );

  const volumeExcedido =
    tipo === "Tankagem" &&
    tankaCapacidade > 0 &&
    roundVolume(destino.volume || 0) > tankaVolumeDisponivel;

  const tanqueDuplicadoNoPatio = destinoLancaTanqueDuplicado(destino, vasilhames, {
    excludeTransbordoId,
    excludeTransbordoCodigo,
  });
  const destinoPreenchido =
    isDestinoPreenchido(destino, volumeExcedido) && !tanqueDuplicadoNoPatio;
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

  const faltaDensidade = exigeDensidade && !(Number(densidade) > 0);

  return (
    <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4 shadow-sm">
      {destinoHeader}

      {faltaDensidade && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Cadastre a densidade do produto embalado para informar o volume em
            litros (L) neste destino e salvar o transbordo.
          </p>
        </div>
      )}

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
                  const semPlaca =
                    item && !String(item.placa || "").trim() && item.barril;
                  const placaText = semPlaca
                    ? ""
                    : String(item?.placa || label || "").trim();
                  const matched =
                    item || findVasilhameCadastro(placaText, vasilhames);

                  const isFracionadoPatio =
                    matched?.fracionado === true &&
                    (matched?.status || "No Pátio") === "No Pátio" &&
                    (matched?.produto_id === produtoId ||
                      matched?._fromValidacaoPendente ||
                      (produtoNome &&
                        String(matched?.produto_nome || "").toLowerCase() ===
                          String(produtoNome).toLowerCase()));

                  const sameTank =
                    destino.vasilhame_existente_id === matched?.id;

                  let updated;
                  if (isFracionadoPatio && matched) {
                    updated = applyFracionadoTanqueToDestino(destino, matched, {
                      keepFracionadoFlag: sameTank,
                    });
                    // Mantém a placa digitada quando o match veio só por texto.
                    if (!semPlaca && placaText) updated.placa = placaText;
                  } else {
                    let novaTara = destino.tara;
                    if (
                      matched &&
                      matched.tara != null &&
                      matched.tara !== "" &&
                      Number(matched.tara) >= 0
                    ) {
                      novaTara = roundMass(matched.tara);
                    }
                    updated = {
                      ...destino,
                      placa: placaText,
                      barril: semPlaca
                        ? item.barril
                        : matched?.barril || destino.barril || "",
                      tara: novaTara,
                      vasilhame_existente_id: null,
                      fracionado: false,
                      observacao: item
                        ? String(item.observacao || "").trim()
                        : destino.observacao || "",
                    };
                  }
                  recalc(updated);
                  onChange(updated);
                }}
                options={vasilhameOpcoes}
                getOptionLabel={(v) =>
                  v.displayLabel ||
                  `${v.placa || ""}${v.barril ? ` - ${v.barril}` : ""}`
                }
                getOptionValue={(v) => v.id || v.placa}
                placeholder="Digite ou selecione a placa..."
                disabled={readOnly}
                inputClassName={INPUT_EDITABLE}
              />
              {tanqueDuplicadoNoPatio ? (
                <p className="text-[11px] font-medium leading-tight text-red-600">
                  {VASILHAME_EM_ESTOQUE_MSG}
                </p>
              ) : null}
              {selectedFracionado && (
                <p className="text-xs text-primary font-medium">
                  {selectedFracionado._fromValidacaoPendente
                    ? "Tanque fracionado em OP pendente de validação"
                    : "Tanque no pátio (fracionado)"}{" "}
                  — volume atual: {formatVolume(selectedFracionado.volume)} L. O
                  volume informado será somado a este registro. Deixe &quot;Destino
                  fracionado&quot; desmarcado se o tanque estiver sendo completado.
                </p>
              )}
            </div>
            <Field
              label="Nº do Barril"
              value={destino.barril}
              hint={tanqueDuplicadoNoPatio ? VASILHAME_EM_ESTOQUE_MSG : ""}
              onChange={(v) => {
                const barril = String(v || "");
                const placa = String(destino.placa || "").trim();
                const matched = !placa
                  ? fracionadoVasilhames.find(
                      (row) =>
                        !String(row.placa || "").trim() &&
                        String(row.barril || "").trim().toUpperCase() ===
                          barril.trim().toUpperCase()
                    )
                  : null;
                let updated;
                if (matched) {
                  updated = applyFracionadoTanqueToDestino(destino, matched, {
                    keepFracionadoFlag:
                      destino.vasilhame_existente_id === matched.id,
                  });
                  updated.barril = barril;
                } else {
                  updated = {
                    ...destino,
                    barril,
                    vasilhame_existente_id: !placa
                      ? null
                      : destino.vasilhame_existente_id,
                  };
                }
                recalc(updated);
                onChange(updated);
              }}
              placeholder="Nº barril"
              readOnly={readOnly}
            />
            <IntegerField
              label={
                selectedFracionado
                  ? preserveEntryMass
                    ? `Quantidade (${unidadeLabel}) * · atual ${formatVolume(selectedFracionado.volume)} L`
                    : `Volume (L) * · atual ${formatVolume(selectedFracionado.volume)} L`
                  : preserveEntryMass
                    ? `Quantidade (${unidadeLabel}) *`
                    : "Volume (L) *"
              }
              value={destino.volume}
              onChange={(v) => updateField("volume", v)}
              readOnly={readOnly || faltaDensidade}
              decimals={3}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <IntegerField
              label="Tara (kg) *"
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
                checked={!tanqueCheio && (destino.fracionado || false)}
                onCheckedChange={(checked) => updateField("fracionado", checked)}
                disabled={readOnly || tanqueCheio}
              />
              <Label
                className={`font-medium ${tanqueCheio || readOnly ? "" : "cursor-pointer"}`}
                onClick={() =>
                  !readOnly &&
                  !tanqueCheio &&
                  updateField("fracionado", !destino.fracionado)
                }
              >
                Destino fracionado
              </Label>
            </div>
            <p className="text-xs text-muted-foreground pl-0 sm:pl-[2.25rem]">
              {tanqueCheio
                ? "Tanque completo. A tag de fracionado sai ao atingir a capacidade cadastrada."
                : "Permite registrar o destino antes de completar sua capacidade. Desmarque ao completar o tanque."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`destino-observacao-${index}`}>Observação</Label>
            <Textarea
              id={`destino-observacao-${index}`}
              value={destino.observacao || ""}
              onChange={(e) => updateField("observacao", e.target.value)}
              placeholder="Apontamentos sobre este vasilhame"
              disabled={readOnly}
              rows={3}
              className={INPUT_EDITABLE}
            />
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
              getOptionLabel={(i) => i.nome || i.tanka || i.codigo_itku || ""}
              renderOption={(i) =>
                i.display_label ||
                i.nome ||
                i.tanka ||
                i.codigo_itku ||
                ""
              }
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
              decimals={3}
              trimTrailingZeros
              value={destino.volume || ""}
              onChange={(v) => updateField("volume", v === "" ? "" : roundVolume(v))}
              placeholder="0"
              disabled={readOnly || faltaDensidade}
              className={INPUT_EDITABLE}
            />
            {selectedTanka && tankaCapacidade > 0 && (
              <p className="text-xs text-muted-foreground">
                Volume disponível: {formatVolume(tankaVolumeDisponivel)} L
              </p>
            )}
            {volumeExcedido && (
              <p className="text-xs text-red-600">
                ⚠ Capacidade disponível do tanka excedida!
              </p>
            )}
          </div>
        </div>
      )}

      {isDestinoEstoqueEmbalado(tipo) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl">
          <IntegerField
            label={
              preserveEntryMass
                ? `Quantidade Total (${unidadeLabel}) *`
                : "Volume Total (L) *"
            }
            value={destino.volume_total ?? destino.volume ?? ""}
            onChange={(v) => updateField("volume_total", v)}
            readOnly={readOnly || faltaDensidade}
            decimals={3}
          />
          <IntegerField
            label={
              preserveEntryMass
                ? `Quantidade por Embalagem (${unidadeLabel}) *`
                : "Volume por Embalagem (L) *"
            }
            value={destino.volume_por_embalagem}
            onChange={(v) => updateField("volume_por_embalagem", v)}
            readOnly={readOnly || faltaDensidade}
            decimals={3}
          />
          <IntegerField
            label="Qtd. Embalagens *"
            value={destino.quantidade_embalagens || ""}
            onChange={(v) => {
              const qtd = Math.max(0, Math.round(Number(v) || 0));
              const volPor = roundVolume(destino.volume_por_embalagem || 0);
              if (volPor > 0 && qtd > 0) {
                updateField("volume_total", roundVolume(qtd * volPor));
              } else {
                const updated = {
                  ...destino,
                  quantidade_embalagens: qtd,
                };
                recalc(updated);
                onChange(updated);
              }
            }}
            readOnly={readOnly || faltaDensidade}
            decimals={0}
          />
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

function Field({ label, value, onChange, placeholder, readOnly, hint }) {
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
      {hint ? (
        <p className="text-[11px] font-medium leading-tight text-red-600">{hint}</p>
      ) : null}
    </div>
  );
}

function IntegerField({ label, value, onChange, readOnly, decimals = 0 }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <NumberInputBr
        decimals={decimals}
        trimTrailingZeros={decimals > 0}
        value={value ?? ""}
        onChange={(v) => onChange(v === "" ? "" : roundVolume(v))}
        placeholder="0"
        disabled={readOnly}
        className={INPUT_EDITABLE}
      />
    </div>
  );
}
