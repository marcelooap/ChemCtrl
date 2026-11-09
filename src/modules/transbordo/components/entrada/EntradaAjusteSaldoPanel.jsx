import { AlertCircle, Plus } from "lucide-react";
import { Label } from "@shared/components/ui/label";
import { Button } from "@shared/components/ui/button";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import { formatQuantidade, roundVolume } from "@transbordo/lib/format";
import {
  deltaEntradaParaLitros,
  sumDeltaAlocacoesLitros,
} from "@transbordo/lib/entradaAjusteSaldo";

function Metric({ label, value, unidade, emphasis = false, tone = "default" }) {
  const toneClass =
    tone === "danger"
      ? "text-red-700"
      : tone === "warning"
        ? "text-amber-700"
        : tone === "success"
          ? "text-emerald-700"
          : "text-foreground";
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        emphasis ? "bg-blue-50/80 border-blue-200" : "bg-muted/30 border-border"
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`text-sm font-semibold tabular-nums ${toneClass}`}>
        {formatQuantidade(value)} {unidade}
      </p>
    </div>
  );
}

/**
 * Painel de ajuste de saldos remanescentes na edição de entrada.
 */
export default function EntradaAjusteSaldoPanel({
  resumo,
  quantidadeNova,
  alocacoes,
  onChangeAlocacao,
  onAddNovoTanque,
  readOnly = false,
  manterNaOrigem = false,
  onChangeManterNaOrigem,
}) {
  if (!resumo) return null;

  const {
    quantidade,
    movimentado,
    disponivel,
    disponivelOrigem,
    disponivelPatio,
    unidade,
    emLitros,
    densidade,
    minimoPermitido,
  } = resumo;

  const qtdNova = Number(quantidadeNova) || 0;
  const delta = roundVolume(qtdNova - (Number(quantidade) || 0));
  const deltaL = deltaEntradaParaLitros(delta, {
    emLitros,
    dens: densidade,
  });
  const alocadoL = sumDeltaAlocacoesLitros(alocacoes);
  const origemDispL = deltaEntradaParaLitros(disponivelOrigem, {
    emLitros,
    dens: densidade,
  });

  let restanteL = deltaL - alocadoL;
  if (deltaL < 0) {
    const absorvidoOrigem = Math.min(-deltaL, Math.max(0, origemDispL));
    restanteL = deltaL + absorvidoOrigem - alocadoL;
  }
  if (deltaL > 0 && manterNaOrigem) {
    restanteL = Math.min(0, restanteL);
  }

  const abaixoDoMinimo = qtdNova > 0 && qtdNova + 1e-9 < (Number(minimoPermitido) || 0);
  const temDelta = Math.abs(delta) > 0.05;
  const um = unidade || (emLitros ? "L" : "kg");

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card/40 p-3">
      <div>
        <p className="text-sm font-medium text-foreground">
          Saldos e ajuste de quantidade
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Transbordos vinculados não bloqueiam a edição. Só saldos ainda no pátio
          (ou disponíveis na origem) podem ser ajustados.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Metric label="Quantidade original" value={quantidade} unidade={um} />
        <Metric
          label="Quantidade atualizada"
          value={qtdNova || quantidade}
          unidade={um}
          emphasis
        />
        <Metric
          label="Já movimentado"
          value={movimentado}
          unidade={um}
          tone="warning"
        />
        <Metric
          label="Disponível no pátio"
          value={disponivelPatio}
          unidade={um}
          tone="success"
        />
        <Metric
          label="Disponível na origem"
          value={disponivelOrigem}
          unidade={um}
        />
        <Metric
          label="Saldo total disponível"
          value={disponivel}
          unidade={um}
        />
      </div>

      {temDelta && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            abaixoDoMinimo
              ? "bg-red-50 border-red-200 text-red-800"
              : Math.abs(restanteL) > 0.05
                ? "bg-amber-50 border-amber-200 text-amber-900"
                : "bg-emerald-50 border-emerald-200 text-emerald-800"
          }`}
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p>
              {delta > 0 ? "Volume adicional" : "Redução"}:{" "}
              <strong>
                {formatQuantidade(Math.abs(delta))} {um}
              </strong>
              {!emLitros && densidade > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  (≈ {formatQuantidade(Math.abs(deltaL))} L)
                </span>
              )}
            </p>
            {abaixoDoMinimo ? (
              <p>
                Mínimo permitido: {formatQuantidade(minimoPermitido)} {um}{" "}
                (volume já movimentado).
              </p>
            ) : Math.abs(restanteL) > 0.05 ? (
              <p>
                Ainda falta {deltaL > 0 ? "alocar" : "remover"}{" "}
                <strong>{formatQuantidade(Math.abs(restanteL))} L</strong> nos
                itens do pátio
                {deltaL > 0 && manterNaOrigem
                  ? " (ou manter na origem)."
                  : "."}
              </p>
            ) : (
              <p>Alocação fechada. Pode salvar o ajuste.</p>
            )}
          </div>
        </div>
      )}

      {deltaL > 0 && typeof onChangeManterNaOrigem === "function" && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded border-border"
            checked={!!manterNaOrigem}
            disabled={readOnly}
            onChange={(e) => onChangeManterNaOrigem(e.target.checked)}
          />
          Manter volume não alocado disponível na origem (para novo transbordo)
        </label>
      )}

      {(alocacoes || []).length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">Itens disponíveis no pátio</Label>
          <div className="space-y-2">
            {alocacoes.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[1fr_auto_auto] gap-2 items-end rounded-lg border border-border bg-background px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Atual: {formatQuantidade(item.volume_atual)} L
                    {item.lote ? ` · Lote ${item.lote}` : ""}
                    {item.kind === "tanka" ? " · Tanka" : ""}
                  </p>
                </div>
                <div className="w-[120px] space-y-1">
                  <Label className="text-[11px]">Novo volume (L)</Label>
                  <NumberInputBr
                    value={item.volume_novo}
                    onChange={(v) =>
                      onChangeAlocacao(item.id, v === "" ? "" : Number(v))
                    }
                    decimals={3}
                    disabled={readOnly}
                    className="h-8 bg-white"
                    min={0}
                    max={item.capacidade || undefined}
                  />
                </div>
                <div className="w-[72px] text-right pb-1">
                  <p className="text-[11px] text-muted-foreground">Δ</p>
                  <p
                    className={`text-xs font-medium tabular-nums ${
                      roundVolume(
                        (Number(item.volume_novo) || 0) -
                          (Number(item.volume_atual) || 0)
                      ) >= 0
                        ? "text-emerald-700"
                        : "text-amber-700"
                    }`}
                  >
                    {formatQuantidade(
                      roundVolume(
                        (Number(item.volume_novo) || 0) -
                          (Number(item.volume_atual) || 0)
                      )
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!readOnly && temDelta && delta > 0 && typeof onAddNovoTanque === "function" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onAddNovoTanque}
        >
          <Plus className="w-3.5 h-3.5" />
          Adicionar tanque / vasilhame para alocação
        </Button>
      )}

      {(alocacoes || []).length === 0 && temDelta && (
        <p className="text-xs text-muted-foreground">
          Nenhum item com saldo no pátio foi encontrado para esta entrada.
          {delta > 0
            ? " Adicione um tanque/vasilhame ou mantenha o volume na origem."
            : disponivelOrigem > 0
              ? " A redução será aplicada sobre o saldo ainda disponível na origem."
              : " Não há saldo remanescente para reduzir."}
        </p>
      )}
    </div>
  );
}
