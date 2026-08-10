import { TrendingDown, TrendingUp } from "lucide-react";
import { formatPercent } from "@transbordo/lib/format";

export default function KpiCard({
  title,
  value,
  subtitle,
  comparison,
  comparisonLabel,
  icon: Icon,
  color,
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 flex flex-col text-left w-full">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </p>
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: color }}
        >
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold truncate" title={typeof value === "string" ? value : undefined}>
        {value}
      </p>
      {subtitle && <p className="text-xs mt-1 text-muted-foreground">{subtitle}</p>}
      {comparison === null ? (
        <p className="text-xs mt-2 text-muted-foreground">-</p>
      ) : comparison != null ? (
        <p
          className={`text-xs mt-2 flex items-center gap-1 ${
            comparison >= 0 ? "text-green-600" : "text-red-600"
          }`}
        >
          {comparison >= 0 ? (
            <TrendingUp className="w-3.5 h-3.5" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5" />
          )}
          <span>
            {formatPercent(Math.abs(comparison))}%
            {comparisonLabel ? ` ${comparisonLabel}` : ""}
          </span>
        </p>
      ) : null}
    </div>
  );
}
