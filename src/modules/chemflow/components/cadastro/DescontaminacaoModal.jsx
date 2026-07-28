import { useState, useEffect, useMemo } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/components/ui/select";

export default function DescontaminacaoModal({
  open,
  onClose,
  onSave,
  isotanques,
}) {
  const [tanka, setTanka] = useState("");
  const [dataDescontaminacao, setDataDescontaminacao] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const tankas = useMemo(() => {
    const unique = [
      ...new Set(
        (isotanques || [])
          .map((it) => it.tanka?.trim())
          .filter(Boolean)
      ),
    ];
    return unique.sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [isotanques]);

  useEffect(() => {
    if (!open) return;
    setTanka("");
    setDataDescontaminacao(new Date().toISOString().slice(0, 10));
    setError("");
    setSaving(false);
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!tanka) {
      setError("Selecione o TANKA.");
      return;
    }
    if (!dataDescontaminacao) {
      setError("Informe a data da descontaminação.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        tanka,
        data_descontaminacao: dataDescontaminacao,
      });
    } catch (err) {
      setError(err?.message || "Não foi possível registrar a descontaminação.");
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Registrar Descontaminação</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="space-y-1.5">
            <Label>TANKA *</Label>
            <Select value={tanka} onValueChange={setTanka} disabled={saving}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o tanka" />
              </SelectTrigger>
              <SelectContent>
                {tankas.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    Nenhum tanka cadastrado
                  </SelectItem>
                ) : (
                  tankas.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Data da Descontaminação *</Label>
            <Input
              type="date"
              value={dataDescontaminacao}
              onChange={(e) => setDataDescontaminacao(e.target.value)}
              disabled={saving}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || tankas.length === 0}>
              {saving ? "Salvando..." : "Registrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
