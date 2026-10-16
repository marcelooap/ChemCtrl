import { Eye, Pencil } from "lucide-react";
import { formatVolume, formatPercent } from "@transbordo/lib/format";

export default function TankSilo({
  tanka,
  capacidade,
  volume,
  produto,
  fillColor,
  observacao,
  onView,
  onEdit,
}) {
  const pct = capacidade > 0 ? (volume / capacidade) * 100 : 0;
  const pctClamped = Math.min(pct, 100);

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-44 rounded-[2rem] border-2 border-border bg-card overflow-hidden">
        <div
          className="absolute bottom-0 left-0 right-0 transition-all duration-500"
          style={{
            height: `${pctClamped}%`,
            backgroundColor: fillColor || "#E5E7EB",
          }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          <span className="text-sm font-bold text-foreground">
            {formatVolume(volume)} L
          </span>
          <span className="text-xs text-foreground/80">
            {formatPercent(pct)}%
          </span>
        </div>
      </div>

      <div className="text-center mt-2 space-y-0.5 w-full">
        <div className="flex items-center justify-center gap-1.5 min-w-0">
          <p className="text-sm font-bold text-foreground truncate">
            {tanka || "—"}
          </p>
          {onView && (
            <button
              type="button"
              onClick={onView}
              className="shrink-0 text-muted-foreground hover:text-primary transition-colors p-0.5"
              title="Visualizar tanka"
              aria-label={`Visualizar ${tanka || "tanka"}`}
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="shrink-0 text-muted-foreground hover:text-primary transition-colors p-0.5"
              title="Editar observação"
              aria-label={`Editar observação de ${tanka || "tanka"}`}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <p className="text-xs text-foreground truncate">{produto || "—"}</p>
        {String(observacao || "").trim() ? (
          <span
            className="mt-1 inline-flex max-w-full rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold leading-snug text-orange-800 line-clamp-2"
            title={String(observacao).trim()}
          >
            {String(observacao).trim()}
          </span>
        ) : null}
      </div>
    </div>
  );
}
