import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import NumberInputBr from "@transbordo/components/NumberInputBr";

export default function EntradaElementosModal({
  open,
  onClose,
  onSave,
  saving = false,
  proximosPreview = "F001",
}) {
  const [dataCompra, setDataCompra] = useState("");
  const [tipo, setTipo] = useState("Cartucho");
  const [marca, setMarca] = useState("");
  const [quantidade, setQuantidade] = useState("1");

  useEffect(() => {
    if (!open) return;
    setDataCompra(new Date().toISOString().split("T")[0]);
    setTipo("Cartucho");
    setMarca("");
    setQuantidade("1");
  }, [open]);

  const qtd = Math.max(0, Math.round(Number(quantidade) || 0));

  const handleSave = async () => {
    if (qtd < 1) return;
    await onSave({
      data_compra: dataCompra || null,
      tipo: tipo || "Cartucho",
      marca: (marca || "").trim(),
      quantidade: qtd,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Entrada de elementos</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="elem-data">Data da compra</Label>
            <Input
              id="elem-data"
              type="date"
              value={dataCompra}
              onChange={(e) => setDataCompra(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="elem-tipo">Tipo</Label>
            <Input id="elem-tipo" value={tipo} readOnly className="bg-muted/50" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="elem-marca">Marca</Label>
            <Input
              id="elem-marca"
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
              placeholder="Ex.: Pall, 3M..."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="elem-qtd">Quantidade</Label>
            <NumberInputBr
              id="elem-qtd"
              decimals={0}
              min={1}
              value={quantidade}
              onChange={(v) => setQuantidade(v === "" ? "" : v)}
              placeholder="Ex.: 3"
            />
            <p className="text-xs text-muted-foreground">
              Serão gerados {qtd || 0} ID(s) em sequência a partir de{" "}
              <span className="font-medium text-foreground">{proximosPreview}</span>
              {qtd > 1 ? "…" : ""}.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            type="button"
            className="bg-primary hover:bg-primary/90"
            onClick={handleSave}
            disabled={saving || qtd < 1}
          >
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
