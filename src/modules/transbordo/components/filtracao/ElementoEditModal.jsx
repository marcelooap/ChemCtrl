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
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import { STATUS_ELEMENTO } from "@transbordo/lib/filtracao";

const STATUS_OPTIONS = STATUS_ELEMENTO.map((s) => ({ id: s, nome: s }));

export default function ElementoEditModal({
  open,
  onClose,
  onSave,
  elemento,
  saving = false,
}) {
  const [marca, setMarca] = useState("");
  const [tipo, setTipo] = useState("Cartucho");
  const [dataCompra, setDataCompra] = useState("");
  const [status, setStatus] = useState("Almoxarifado");

  useEffect(() => {
    if (!open || !elemento) return;
    setMarca(elemento.marca || "");
    setTipo(elemento.tipo || "Cartucho");
    setDataCompra(elemento.data_compra || "");
    setStatus(elemento.status || "Almoxarifado");
  }, [open, elemento]);

  const handleSave = async () => {
    await onSave({
      marca: (marca || "").trim(),
      tipo: tipo || "Cartucho",
      data_compra: dataCompra || null,
      status: status || "Almoxarifado",
    });
  };

  if (!elemento) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar elemento {elemento.codigo || ""}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>ID</Label>
            <Input value={elemento.codigo || ""} readOnly className="bg-muted/50" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-marca">Marca</Label>
            <Input
              id="edit-marca"
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
              placeholder="Ex.: Pall, 3M..."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-tipo">Tipo</Label>
            <Input
              id="edit-tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-data">Data da compra</Label>
            <Input
              id="edit-data"
              type="date"
              value={dataCompra}
              onChange={(e) => setDataCompra(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <SearchableSelect
              value={status}
              onChange={(label) => setStatus(label || "Almoxarifado")}
              options={STATUS_OPTIONS}
              getOptionLabel={(o) => o.nome}
              getOptionValue={(o) => o.id}
              placeholder="Selecione o status"
            />
            {status === "Em uso" && elemento.status !== "Em uso" && (
              <p className="text-xs text-muted-foreground">
                O cartucho que estiver Em uso será marcado como Descartado.
              </p>
            )}
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
            disabled={saving}
          >
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
