import { useEffect, useState } from "react";
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
import { Ban, Trash2 } from "lucide-react";
import {
  isSaidaCancelada,
  isSaidaComValidacao,
} from "@transbordo/lib/saidaOrigem";

/**
 * Fluxo do ícone excluir:
 * 1) escolher Cancelar carregamento ou Excluir definitivamente
 * 2a) justificativa obrigatória no cancelamento (somente se validada)
 * 2b) confirmação / bloqueio na exclusão definitiva
 */
export default function SaidaRemoverModal({
  open,
  saida,
  busy = false,
  onClose,
  onCancelarCarregamento,
  onExcluirDefinitivamente,
}) {
  const [step, setStep] = useState("choose"); // choose | cancel | delete
  const [justificativa, setJustificativa] = useState("");
  const [error, setError] = useState("");

  const cancelada = isSaidaCancelada(saida);
  const validada = isSaidaComValidacao(saida);
  const codigo = saida?.codigo || "";

  useEffect(() => {
    if (!open) return;
    setStep(cancelada ? "delete" : "choose");
    setJustificativa("");
    setError("");
  }, [open, saida?.id, cancelada]);

  const handleClose = () => {
    if (busy) return;
    onClose?.();
  };

  const handleConfirmCancel = async () => {
    if (!validada) {
      setError(
        "Só é possível cancelar o carregamento após a validação da carga."
      );
      return;
    }
    const motivo = justificativa.trim();
    if (!motivo) {
      setError("A justificativa é obrigatória.");
      return;
    }
    setError("");
    await onCancelarCarregamento?.(motivo);
  };

  const handleConfirmDelete = async () => {
    if (cancelada) {
      setError(
        "Carregamento cancelado permanece no histórico e não pode ser excluído definitivamente."
      );
      return;
    }
    if (validada) {
      setError(
        "Esta saída já foi validada. Desvalide-a antes de excluir definitivamente."
      );
      return;
    }
    setError("");
    await onExcluirDefinitivamente?.();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md overflow-hidden"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {step === "choose" ? (
          <>
            <DialogHeader>
              <DialogTitle>
                Remover saída{codigo ? ` ${codigo}` : ""}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground pr-6">
              Escolha se deseja cancelar o carregamento (mantém o histórico) ou
              excluir a solicitação de forma definitiva.
            </p>
            <div className="flex w-full min-w-0 flex-col gap-2.5 pt-1">
              <button
                type="button"
                disabled={busy || !validada}
                onClick={() => {
                  setError("");
                  setStep("cancel");
                }}
                className="flex w-full min-w-0 items-start gap-3 rounded-md border border-input bg-transparent px-3 py-3 text-left shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <Ban className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-sm font-medium text-foreground">
                    Cancelar carregamento
                  </span>
                  <span className="block text-xs font-normal leading-snug text-muted-foreground whitespace-normal break-words">
                    {validada
                      ? "Mantém validação, data de saída e baixa de saldo. Itens não voltam ao estoque."
                      : "Disponível somente após a validação da carga (para garantir baixa e data de saída)."}
                  </span>
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setStep("delete");
                }}
                className="flex w-full min-w-0 items-start gap-3 rounded-md border border-red-200 bg-transparent px-3 py-3 text-left shadow-sm transition-colors hover:bg-red-50 hover:text-red-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-sm font-medium text-foreground">
                    Excluir definitivamente
                  </span>
                  <span className="block text-xs font-normal leading-snug text-muted-foreground whitespace-normal break-words">
                    Remove a saída dos registros. Só permitido se ainda não
                    estiver validada.
                  </span>
                </span>
              </button>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={busy}
              >
                Fechar
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {step === "cancel" ? (
          <>
            <DialogHeader>
              <DialogTitle>Cancelar carregamento</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              A saída permanecerá no histórico com status Cancelado. A
              validação, a data de saída e a baixa de saldo dos itens serão
              mantidas — nada retorna ao estoque. Informe a justificativa
              obrigatória.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="saida-cancel-justificativa">Justificativa *</Label>
              <Textarea
                id="saida-cancel-justificativa"
                value={justificativa}
                onChange={(e) => {
                  setJustificativa(e.target.value);
                  if (error) setError("");
                }}
                placeholder="Descreva o motivo do cancelamento"
                disabled={busy}
                rows={4}
                className="bg-card resize-y min-h-[96px]"
              />
              {error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : null}
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setError("");
                  setStep("choose");
                }}
                disabled={busy}
              >
                Voltar
              </Button>
              <Button
                type="button"
                className="bg-amber-600 hover:bg-amber-700 whitespace-normal h-auto min-h-9 py-2"
                disabled={busy || !validada}
                onClick={handleConfirmCancel}
              >
                {busy ? "Cancelando…" : "Confirmar cancelamento"}
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {step === "delete" ? (
          <>
            <DialogHeader>
              <DialogTitle>Excluir definitivamente</DialogTitle>
            </DialogHeader>
            {cancelada ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                Carregamento cancelado permanece no histórico com a validação e
                a baixa de saldo preservadas. Não é possível excluir
                definitivamente.
              </div>
            ) : validada ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                Esta saída já foi validada. Desvalide-a antes de excluir
                definitivamente.
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                A saída{codigo ? ` ${codigo}` : ""} será removida dos registros
                de solicitação e não poderá ser recuperada.
              </p>
            )}
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}
            <DialogFooter className="gap-2 sm:gap-2">
              {!cancelada ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setError("");
                    setStep("choose");
                  }}
                  disabled={busy}
                >
                  Voltar
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  disabled={busy}
                >
                  Fechar
                </Button>
              )}
              <Button
                type="button"
                className="bg-red-600 hover:bg-red-700 whitespace-normal h-auto min-h-9 py-2"
                disabled={busy || validada || cancelada}
                onClick={handleConfirmDelete}
              >
                {busy ? "Excluindo…" : "Excluir definitivamente"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
