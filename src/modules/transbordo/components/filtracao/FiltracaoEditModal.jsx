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
import { PARTICULA_TAMANHOS } from "@transbordo/lib/filtracao";

function toInputValue(v) {
  return v === null || v === undefined || v === "" ? "" : String(v);
}

function parseOptionalNumber(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function FiltracaoEditModal({
  open,
  onClose,
  onSave,
  filtracao,
  elementos = [],
}) {
  const [sae, setSae] = useState("");
  const [filtroId, setFiltroId] = useState("");
  const [particulas, setParticulas] = useState({
    particulas_6: "",
    particulas_14: "",
    particulas_21: "",
    particulas_38: "",
    particulas_70: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !filtracao) return;
    setSae(toInputValue(filtracao.sae));
    const emUso = elementos.find((e) => e.status === "Em uso");
    setFiltroId(filtracao.filtro_id || emUso?.id || "");
    setParticulas({
      particulas_6: toInputValue(filtracao.particulas_6),
      particulas_14: toInputValue(filtracao.particulas_14),
      particulas_21: toInputValue(filtracao.particulas_21),
      particulas_38: toInputValue(filtracao.particulas_38),
      particulas_70: toInputValue(filtracao.particulas_70),
    });
  }, [open, filtracao, elementos]);

  const filtroOptions = [
    { id: "", codigo: "Sem filtro", status: "" },
    ...[...elementos].sort((a, b) => {
      const aUso = a.status === "Em uso" ? 0 : 1;
      const bUso = b.status === "Em uso" ? 0 : 1;
      if (aUso !== bUso) return aUso - bUso;
      return String(a.codigo || "").localeCompare(String(b.codigo || ""));
    }),
  ];

  const selectedFiltroLabel = (() => {
    if (!filtroId) return "Sem filtro";
    const el = elementos.find((e) => e.id === filtroId);
    if (!el) return filtracao?.filtro_codigo || "Sem filtro";
    return el.status === "Em uso" ? `${el.codigo} (Em uso)` : el.codigo;
  })();

  const handleSave = async () => {
    setSaving(true);
    try {
      const el = elementos.find((e) => e.id === filtroId);
      await onSave({
        sae:
          parseOptionalNumber(sae) !== null
            ? Math.round(parseOptionalNumber(sae))
            : null,
        filtro_id: filtroId || null,
        filtro_codigo: el?.codigo || "",
        particulas_6: parseOptionalNumber(particulas.particulas_6),
        particulas_14: parseOptionalNumber(particulas.particulas_14),
        particulas_21: parseOptionalNumber(particulas.particulas_21),
        particulas_38: parseOptionalNumber(particulas.particulas_38),
        particulas_70: parseOptionalNumber(particulas.particulas_70),
      });
    } finally {
      setSaving(false);
    }
  };

  if (!filtracao) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Filtração</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-muted/50 p-3 text-sm grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-muted-foreground">ID</p>
              <p className="font-medium text-primary">{filtracao.codigo || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Placa / Barril</p>
              <p className="font-medium text-foreground">
                {filtracao.placa || "—"}
                {filtracao.barril ? ` / ${filtracao.barril}` : ""}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">Produto</p>
              <p className="font-medium text-foreground">
                {[filtracao.produto_codigo, filtracao.produto_nome]
                  .filter(Boolean)
                  .join(" — ") || "—"}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Filtro (elemento filtrante)</Label>
            <SearchableSelect
              value={selectedFiltroLabel}
              onChange={(_label, option) => {
                setFiltroId(option?.id || "");
              }}
              options={filtroOptions}
              getOptionLabel={(o) =>
                !o.id
                  ? "Sem filtro"
                  : o.status === "Em uso"
                    ? `${o.codigo} (Em uso)`
                    : o.codigo
              }
              getOptionValue={(o) => o.id || "none"}
              placeholder="Selecione o cartucho"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filtracao-sae">SAE</Label>
            <Input
              id="filtracao-sae"
              type="number"
              min={0}
              step={1}
              value={sae}
              onChange={(e) => setSae(e.target.value)}
              placeholder="Ex.: 1, 2, 3..."
            />
          </div>

          <div className="space-y-2">
            <Label>Contagem de partículas</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {PARTICULA_TAMANHOS.map(({ key, label }) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`filtracao-${key}`} className="text-xs text-muted-foreground">
                    {label}
                  </Label>
                  <Input
                    id={`filtracao-${key}`}
                    type="number"
                    min={0}
                    step="any"
                    value={particulas[key]}
                    onChange={(e) =>
                      setParticulas((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
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
