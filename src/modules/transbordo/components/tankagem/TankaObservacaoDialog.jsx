import { useEffect, useState } from "react";
import { Button } from "@shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Textarea } from "@shared/components/ui/textarea";
import { formatVolume } from "@transbordo/lib/format";

const MAX_OBS = 160;

function InfoItem({ label, value }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold text-foreground" title={value || undefined}>
        {value || "—"}
      </p>
    </div>
  );
}

export default function TankaObservacaoDialog({
  open,
  tank,
  saving = false,
  onClose,
  onSave,
}) {
  const [texto, setTexto] = useState("");

  useEffect(() => {
    if (!open) return;
    setTexto(String(tank?.observacao || ""));
  }, [open, tank]);

  const nome = tank?.tanka || tank?.tankaCodigo || tank?.codigo_itku || "—";
  const capacidade =
    Number(tank?.isotanque?.capacidade) ||
    Number(tank?.indTank?.capacity) ||
    Number(tank?.capacidade) ||
    0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tanka {nome}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/40 p-4">
          <InfoItem label="Produto" value={tank?.produto} />
          <InfoItem label="Cliente" value={tank?.cliente_nome} />
          <InfoItem label="Volume" value={`${formatVolume(tank?.volumeAtual || 0)} L`} />
          <InfoItem
            label="Capacidade"
            value={capacidade > 0 ? `${formatVolume(capacidade)} L` : "—"}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="tanka-observacao" className="text-sm font-medium text-foreground">
            Observação
          </label>
          <Textarea
            id="tanka-observacao"
            value={texto}
            maxLength={MAX_OBS}
            rows={3}
            placeholder="Ex.: aguardando análise, reservado para embarque..."
            onChange={(event) => setTexto(event.target.value)}
            disabled={saving}
          />
          <p className="text-right text-xs text-muted-foreground">
            {texto.trim().length}/{MAX_OBS}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => onSave(texto)}
            disabled={saving}
          >
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
