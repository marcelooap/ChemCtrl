import { formatVolume } from "@chemflow/lib/format";

export default function TankSilo({ tanka, capacidade, volume, produto, lote, fillColor }) {
    const pct = capacidade > 0 ? (volume / capacidade) * 100 : 0;
    const pctClamped = Math.min(pct, 100);
  
    return (
      <div className="flex flex-col items-center">
        {/* Silo - capsule shape */}
        <div className="relative w-24 h-44 rounded-[2rem] border-2 border-border bg-card overflow-hidden">
          {/* Fill */}
          <div
            className="absolute bottom-0 left-0 right-0 transition-all duration-500"
            style={{
              height: `${pctClamped}%`,
              backgroundColor: fillColor || "#E5E7EB",
            }}
          />
          {/* Text overlay - centered */}
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
            <span className="text-sm font-bold text-foreground">
              {formatVolume(volume)} L
            </span>
            <span className="text-xs text-foreground/80">
              {pct.toFixed(1)}%
            </span>
          </div>
        </div>
        {/* Info below */}
        <div className="text-center mt-2 space-y-0.5 w-full">
          <p className="text-sm font-bold text-foreground truncate">
            {tanka || "—"}
          </p>
          <p className="text-xs text-foreground truncate">
            {produto || "—"}
          </p>
          {lote && (
            <p className="text-xs text-muted-foreground truncate">Lote: {lote}</p>
          )}
          <p className="text-xs text-muted-foreground">Cap: {formatVolume(capacidade)} L</p>
        </div>
      </div>
    );
  }
