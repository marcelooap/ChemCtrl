import { useTranslation } from 'react-i18next';

function responsavelDoGrupo(group) {
  for (const booking of group?.bookings || []) {
    const value = String(booking?.justificativa_atraso_responsavel || '').trim();
    if (value) return value;
  }
  return '';
}

/**
 * Contabiliza responsáveis pelos carregamentos fora do horário.
 * O total espelha a quantidade de atrasos do período; Cliente/Intertank
 * usam a justificativa gravada na conclusão.
 * @param {Array<{ pontualidade?: 'dentro'|'fora', bookings?: object[] }>} groups
 * @returns {{ cliente: number, intertank: number, total: number, clientePct: number, intertankPct: number }}
 */
export function computeAtrasoResponsavelStats(groups = []) {
  let cliente = 0;
  let intertank = 0;
  let total = 0;

  for (const group of groups) {
    if (group?.pontualidade !== 'fora') continue;
    total += 1;
    const responsavel = responsavelDoGrupo(group);
    if (responsavel === 'cliente') cliente += 1;
    else if (responsavel === 'intertank') intertank += 1;
  }

  const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return {
    cliente,
    intertank,
    total,
    clientePct: pct(cliente),
    intertankPct: pct(intertank),
  };
}

/**
 * Card com a divisão Cliente × Intertank dos atrasos do período.
 * @param {{ stats: ReturnType<typeof computeAtrasoResponsavelStats>, title: string, className?: string }} props
 */
export default function AtrasoResponsavelStatsCard({
  stats,
  title,
  className = '',
}) {
  const { t } = useTranslation();

  return (
    <div
      className={`rounded-xl border border-border bg-card px-4 py-3 shadow-sm flex flex-col ${className}`}
    >
      <div className="flex items-center justify-between gap-4 mb-2 min-h-7">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
      </div>
      <div className="flex items-center gap-4 mt-auto">
        <div className="min-w-[104px]">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
            {t('painel.logistica.carregamentos.stats.atrasoCliente')}
          </p>
          <p className="text-lg font-semibold tabular-nums text-amber-700 leading-tight">
            {stats.cliente}
            <span className="ml-1.5 text-xs font-medium text-muted-foreground">
              {stats.clientePct}%
            </span>
          </p>
        </div>
        <div className="h-8 w-px bg-border" aria-hidden />
        <div className="min-w-[104px]">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" aria-hidden />
            {t('painel.logistica.carregamentos.stats.atrasoIntertank')}
          </p>
          <p className="text-lg font-semibold tabular-nums text-sky-700 leading-tight">
            {stats.intertank}
            <span className="ml-1.5 text-xs font-medium text-muted-foreground">
              {stats.intertankPct}%
            </span>
          </p>
        </div>
        <div className="h-8 w-px bg-border" aria-hidden />
        <div className="min-w-[64px]">
          <p className="text-[11px] text-muted-foreground">
            {t('painel.logistica.carregamentos.stats.atrasoTotal')}
          </p>
          <p className="text-lg font-semibold tabular-nums text-foreground leading-tight">
            {stats.total}
          </p>
        </div>
      </div>
    </div>
  );
}
