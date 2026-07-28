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

export default function VasilhameCadastroModal({
  open,
  onClose,
  onSave,
  editingVasilhame,
}) {
  const [placa, setPlaca] = useState("");
  const [barril, setBarril] = useState("");
  const [volume, setVolume] = useState("");
  const [tara, setTara] = useState("");
  const [status, setStatus] = useState("No Pátio");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editingVasilhame) {
      setPlaca(editingVasilhame.placa || "");
      setBarril(editingVasilhame.barril || "");
      setVolume(editingVasilhame.volume ?? "");
      setTara(editingVasilhame.tara ?? "");
      setStatus(editingVasilhame.status || "No Pátio");
    } else {
      setPlaca("");
      setBarril("");
      setVolume("");
      setTara("");
      setStatus("No Pátio");
    }
    setError("");
  }, [editingVasilhame, open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!placa) {
      setError("Nº da Placa é obrigatório.");
      return;
    }
    onSave({
      placa,
      barril,
      volume: volume ? Number(volume) : 0,
      tara: tara ? Number(tara) : 0,
      status,
    });
  };

  const title = editingVasilhame ? "Editar Vasilhame" : "Cadastrar Vasilhame";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Nº Placa *</Label>
              <Input
                value={placa}
                onChange={(e) => setPlaca(e.target.value)}
                placeholder="Ex: 25649-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nº Barril</Label>
              <Input
                value={barril}
                onChange={(e) => setBarril(e.target.value)}
                placeholder="Nº barril"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Capacidade (L)</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tara (kg)</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                value={tara}
                onChange={(e) => setTara(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="status"
                  checked={status === "No Pátio"}
                  onChange={() => setStatus("No Pátio")}
                />
                <span className="text-sm">No Pátio</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="status"
                  checked={status === "Expedido"}
                  onChange={() => setStatus("Expedido")}
                />
                <span className="text-sm">Expedido</span>
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" className="bg-primary hover:bg-primary/90">
              {editingVasilhame ? "Salvar Alterações" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}