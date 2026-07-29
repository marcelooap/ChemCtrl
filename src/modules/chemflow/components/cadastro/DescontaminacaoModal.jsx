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
import SearchableSelect from "@chemflow/components/cadastro/SearchableSelect";

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

  const tankaOptions = useMemo(() => {
    const unique = [
      ...new Set(
        (isotanques || [])
          .map((it) => it.tanka?.trim())
          .filter(Boolean)
      ),
    ];
    return unique
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((t) => ({ id: t, nome: t }));
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
    const tankaNorm = tanka?.trim();
    if (!tankaNorm) {
      setError("Informe o TANKA.");
      return;
    }
    const match = tankaOptions.find(
      (o) => o.nome.toLowerCase() === tankaNorm.toLowerCase()
    );
    if (!match) {
      setError("Tanka não encontrado. Digite ou selecione um tanka cadastrado.");
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
        tanka: match.nome,
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
            <SearchableSelect
              options={tankaOptions}
              value={tanka}
              onChange={(label) => setTanka(label || "")}
              placeholder="Digite ou selecione o tanka"
              disabled={saving || tankaOptions.length === 0}
              inputClassName="bg-white"
            />
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
            <Button type="submit" disabled={saving || tankaOptions.length === 0}>
              {saving ? "Salvando..." : "Registrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
