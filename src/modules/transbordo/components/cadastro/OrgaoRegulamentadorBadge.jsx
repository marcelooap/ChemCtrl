/** Logos característicos simplificados (não oficiais) dos órgãos. */

function LogoFederal({ className = "w-4 h-4" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#1B5E20"
        d="M12 2L3 6v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V6l-9-4z"
      />
      <path
        fill="#F9A825"
        d="M12 4.2L5.5 7.1v3.7c0 4.2 2.9 8.2 6.5 9.3 3.6-1.1 6.5-5.1 6.5-9.3V7.1L12 4.2z"
      />
      <path
        fill="#1B5E20"
        d="M12 7.2c-1.7 0-3 1.1-3 2.6 0 1 .5 1.8 1.3 2.2L9.5 16h5l-.8-4c.8-.4 1.3-1.2 1.3-2.2 0-1.5-1.3-2.6-3-2.6z"
      />
    </svg>
  );
}

function LogoExercito({ className = "w-4 h-4" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="10" fill="#2E4A1E" />
      <circle cx="12" cy="12" r="8.2" fill="#3D5C28" stroke="#C9A227" strokeWidth="1.2" />
      <path
        fill="#C9A227"
        d="M12 5.5l1.2 3.6h3.8l-3 2.2 1.1 3.6L12 12.9 8.9 14.9l1.1-3.6-3-2.2h3.8L12 5.5z"
      />
    </svg>
  );
}

export const ORGAOS_REGULAMENTADORES = [
  { value: "Federal", label: "Federal" },
  { value: "Exército", label: "Exército" },
];

export function OrgaoRegulamentadorLogo({ orgao, className = "w-4 h-4" }) {
  if (orgao === "Federal") return <LogoFederal className={className} />;
  if (orgao === "Exército") return <LogoExercito className={className} />;
  return null;
}

/**
 * Exibe o órgão regulamentador com logo, ou "-" se não controlado.
 */
export default function OrgaoRegulamentadorBadge({ controlado, orgao, compact = false }) {
  if (!controlado || !orgao) {
    return <span className="text-muted-foreground">-</span>;
  }

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/80 bg-amber-50 px-1.5 py-0.5 text-amber-950">
        <OrgaoRegulamentadorLogo orgao={orgao} className="w-3.5 h-3.5 shrink-0" />
        <span className="text-[11px] font-semibold whitespace-nowrap">{orgao}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <OrgaoRegulamentadorLogo orgao={orgao} className="w-4 h-4 shrink-0" />
      <span className="text-foreground font-medium truncate">{orgao}</span>
    </span>
  );
}

/** Banner de destaque quando todos os produtos são controlados pelo mesmo órgão. */
export function OrgaoControladoBanner({
  orgao,
  label = "Todos os produtos desta entrada são controlados",
}) {
  if (!orgao) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-lg border border-amber-400/70 bg-gradient-to-r from-amber-50 to-orange-50 px-3.5 py-2.5 shadow-sm"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 border border-amber-300/60">
        <OrgaoRegulamentadorLogo orgao={orgao} className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800">
          Produto controlado
        </p>
        <p className="text-sm font-semibold text-amber-950">
          Órgão regulamentador: {orgao}
        </p>
        <p className="text-[11px] text-amber-900/80 mt-0.5">{label}</p>
      </div>
    </div>
  );
}
