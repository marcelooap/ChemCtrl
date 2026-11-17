import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { Label } from "@shared/components/ui/label";
import { Textarea } from "@shared/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@shared/components/ui/radio-group";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import { AlertCircle, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { formatQuantidade, formatVolume } from "@transbordo/lib/format";
import {
  TIPO_AJUSTE,
  TIPO_LOCAL,
  labelTipoLocal,
  labelTipoAjuste,
  listTiposLocaisDisponiveis,
  listTanquesParaAjuste,
  listTankasParaAjuste,
  saldoAtualDoLocal,
  unidadeDoEstoque,
  validateAjusteManualPayload,
  persistAjusteManualSaldo,
} from "@transbordo/lib/estoqueAjusteManual";

function InfoCell({ label, value }) {
  return (
    <div className="space-y-0.5 min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-medium text-foreground break-words">{value || "—"}</p>
    </div>
  );
}

export default function EstoqueAjusteSaldoModal({
  open,
  onClose,
  onSuccess,
  item,
  locaisSaldo,
  vasilhames = [],
  transbordos = [],
  ajustes = [],
}) {
  const [tipoLocal, setTipoLocal] = useState(TIPO_LOCAL.EMBALADO);
  const [tipoAjuste, setTipoAjuste] = useState(TIPO_AJUSTE.AUMENTAR);
  const [quantidade, setQuantidade] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [containerId, setContainerId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const itemId = item?.id;

  const tiposDisponiveis = useMemo(
    () => listTiposLocaisDisponiveis(locaisSaldo || {}),
    [locaisSaldo]
  );

  const tanques = useMemo(
    () =>
      listTanquesParaAjuste(item, { vasilhames, transbordos }),
    [item, vasilhames, transbordos]
  );

  const tankas = useMemo(
    () =>
      listTankasParaAjuste(item, { vasilhames, transbordos, ajustes }),
    [item, vasilhames, transbordos, ajustes]
  );

  const containers =
    tipoLocal === TIPO_LOCAL.TANKA
      ? tankas
      : tipoLocal === TIPO_LOCAL.TANQUE
        ? tanques
        : [];

  const selectedContainer = useMemo(
    () => containers.find((c) => String(c.id) === String(containerId)) || null,
    [containers, containerId]
  );

  const unidade = unidadeDoEstoque(item);

  const saldoLocal = useMemo(() => {
    if (tipoLocal === TIPO_LOCAL.EMBALADO) {
      return saldoAtualDoLocal(locaisSaldo, TIPO_LOCAL.EMBALADO);
    }
    if (selectedContainer) {
      return Number(selectedContainer.saldo_atual) || 0;
    }
    return saldoAtualDoLocal(locaisSaldo, tipoLocal);
  }, [tipoLocal, locaisSaldo, selectedContainer]);

  const qtdNum = Number(quantidade) || 0;
  const signed =
    tipoAjuste === TIPO_AJUSTE.AUMENTAR ? qtdNum : -qtdNum;
  const novoSaldo = Math.max(0, Math.round((saldoLocal + signed) * 1000) / 1000);
  const isEntrada = tipoAjuste === TIPO_AJUSTE.AUMENTAR;

  useEffect(() => {
    if (!open || !item) return;
    const tipos = listTiposLocaisDisponiveis(locaisSaldo);
    const initialTipo = tipos[0] || TIPO_LOCAL.EMBALADO;
    setTipoLocal(initialTipo);
    setTipoAjuste(TIPO_AJUSTE.AUMENTAR);
    setQuantidade("");
    setJustificativa("");
    setContainerId("");
    setError("");
    savingRef.current = false;
    setSaving(false);
  }, [open, itemId]);

  useEffect(() => {
    if (!open) return;
    if (tipoLocal === TIPO_LOCAL.EMBALADO) {
      setContainerId("");
      return;
    }
    const list =
      tipoLocal === TIPO_LOCAL.TANKA
        ? listTankasParaAjuste(item, { vasilhames, transbordos, ajustes })
        : listTanquesParaAjuste(item, { vasilhames, transbordos });
    if (list.length === 1) {
      setContainerId(String(list[0].id));
    } else if (
      containerId &&
      !list.some((c) => String(c.id) === String(containerId))
    ) {
      setContainerId("");
    }
  }, [tipoLocal, open, itemId, vasilhames, transbordos, ajustes]);

  const produtoLabel =
    item?.produto_codigo && item?.produto_nome
      ? `${item.produto_codigo} — ${item.produto_nome}`
      : item?.produto_nome || item?.produto_codigo || "—";

  const handleSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (savingRef.current) return;

    const validation = validateAjusteManualPayload({
      tipoLocal,
      tipoAjuste,
      quantidade: qtdNum,
      justificativa,
      saldoLocalAtual: saldoLocal,
      vasilhameId: containerId,
      selectedContainer,
    });
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await persistAjusteManualSaldo({
        estoqueItem: item,
        tipoLocal,
        tipoAjuste,
        quantidade: qtdNum,
        justificativa,
        vasilhameId: containerId || null,
        tankaId: selectedContainer?.tanka_id || null,
        tankaCodigo:
          selectedContainer?.tanka_codigo || selectedContainer?.placa || null,
        saldoLocalAtual: saldoLocal,
      });
      await onSuccess?.(result);
    } catch (err) {
      const msg =
        err?.message ||
        err?.body ||
        "Não foi possível salvar o ajuste. Tente novamente.";
      setError(typeof msg === "string" ? msg : String(msg));
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open && !!item}
      onOpenChange={(v) => {
        if (!v && !savingRef.current) onClose();
      }}
    >
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajuste manual de saldo</DialogTitle>
        </DialogHeader>

        {!item ? null : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg border border-border bg-muted/40">
              <InfoCell label="Código / Produto" value={produtoLabel} />
              <InfoCell label="Cliente" value={item.cliente_nome} />
              <InfoCell label="Lote" value={item.lote} />
              <InfoCell label="Unidade" value={unidade} />
            </div>

            <div className="space-y-2">
              <Label>Tipo de estoque</Label>
              <div className="flex flex-wrap gap-2">
                {tiposDisponiveis.map((tipo) => {
                  const active = tipoLocal === tipo;
                  return (
                    <button
                      key={tipo}
                      type="button"
                      disabled={saving}
                      onClick={() => setTipoLocal(tipo)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-foreground border-border hover:bg-muted/60"
                      }`}
                    >
                      {labelTipoLocal(tipo)}
                    </button>
                  );
                })}
              </div>
            </div>

            {(tipoLocal === TIPO_LOCAL.TANQUE ||
              tipoLocal === TIPO_LOCAL.TANKA) && (
              <div className="space-y-2">
                <Label>
                  {tipoLocal === TIPO_LOCAL.TANKA
                    ? "Selecionar Tanka *"
                    : "Selecionar tanque *"}
                </Label>
                {containers.length === 0 ? (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Nenhum {tipoLocal === TIPO_LOCAL.TANKA ? "Tanka" : "tanque"}{" "}
                    No Pátio vinculado a este estoque.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {containers.map((c) => {
                      const selected = String(c.id) === String(containerId);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={saving}
                          onClick={() => setContainerId(String(c.id))}
                          className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                            selected
                              ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                              : "border-border bg-card hover:bg-muted/40"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground truncate">
                                {c.placa || c.tanka_codigo || c.codigo || c.id}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {[
                                  c.barril ? `Barril ${c.barril}` : null,
                                  c.tipo,
                                  c.capacidade
                                    ? `Cap. ${formatVolume(c.capacidade)} L`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[11px] text-muted-foreground">
                                Saldo
                              </p>
                              <p className="text-sm font-semibold tabular-nums">
                                {formatQuantidade(c.saldo_atual)} {unidade}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>Tipo de ajuste</Label>
              <RadioGroup
                value={tipoAjuste}
                onValueChange={setTipoAjuste}
                className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                disabled={saving}
              >
                <label
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer ${
                    isEntrada
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-border bg-card"
                  }`}
                >
                  <RadioGroupItem value={TIPO_AJUSTE.AUMENTAR} id="ajuste-up" />
                  <ArrowUpCircle className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-medium">
                    {labelTipoAjuste(TIPO_AJUSTE.AUMENTAR)}
                  </span>
                </label>
                <label
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer ${
                    !isEntrada
                      ? "border-red-400 bg-red-50"
                      : "border-border bg-card"
                  }`}
                >
                  <RadioGroupItem value={TIPO_AJUSTE.DIMINUIR} id="ajuste-down" />
                  <ArrowDownCircle className="w-4 h-4 text-red-600" />
                  <span className="text-sm font-medium">
                    {labelTipoAjuste(TIPO_AJUSTE.DIMINUIR)}
                  </span>
                </label>
              </RadioGroup>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Saldo atual ({labelTipoLocal(tipoLocal)})</Label>
                <div className="h-10 flex items-center px-3 rounded-md border border-border bg-muted/40 text-sm font-semibold tabular-nums">
                  {formatQuantidade(saldoLocal)} {unidade}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Quantidade a ajustar *</Label>
                <NumberInputBr
                  decimals={3}
                  min={0}
                  value={quantidade}
                  onChange={(v) => setQuantidade(v === "" ? "" : v)}
                  placeholder="0"
                  disabled={saving}
                  className="bg-card"
                />
              </div>
            </div>

            <div
              className={`rounded-lg border px-3 py-3 ${
                isEntrada
                  ? "border-emerald-200 bg-emerald-50/70"
                  : "border-red-200 bg-red-50/70"
              }`}
            >
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                Prévia do ajuste
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[11px] text-muted-foreground">Anterior</p>
                  <p className="text-sm font-semibold tabular-nums">
                    {formatQuantidade(saldoLocal)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Ajuste</p>
                  <p
                    className={`text-sm font-semibold tabular-nums ${
                      isEntrada ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {isEntrada ? "+" : "−"}
                    {formatQuantidade(qtdNum)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Novo saldo</p>
                  <p className="text-sm font-semibold tabular-nums">
                    {formatQuantidade(novoSaldo)} {unidade}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Justificativa *</Label>
              <Textarea
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                placeholder="Informe o motivo do ajuste (obrigatório)"
                disabled={saving}
                rows={3}
                className="bg-card resize-y min-h-[80px]"
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando…" : "Confirmar ajuste"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
