import { useTranslation } from 'react-i18next';

/**
 * Calcula pontualidade (dentro/fora do horário) de carregamentos concluídos.
 * @param {Array<{ pontualidade?: 'dentro'|'fora' }>} groups grupos já filtrados pelo período desejado
 * @returns {{ dentro: number, fora: number, total: number, dentroPct: number, foraPct: number }}
 */
export function computePontualidadeStats(groups = []) {
  let dentro = 0;
  let fora = 0;
  for (const group of groups) {
    if (group?.pontualidade === 'dentro') dentro += 1;
    else fora += 1;
  }
  const total = dentro + fora;
  const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);
  return { dentro, fora, total, dentroPct: pct(dentro), foraPct: pct(fora) };
}

/**
 * Card compacto de pontualidade dos carregamentos: dentro/fora do horário
 * com quantidade, percentual e total do período.
 * @param {{ stats: ReturnType<typeof computePontualidadeStats>, title: string, action?: import('react').ReactNode, className?: string }} props
 */
export default function PontualidadeStatsCard({ stats, title, action = null, className = '' }) {
  const { t } = useTranslation();

  return (
    <div className={`rounded-xl border border-border bg-card px-4 py-3 shadow-sm ${className}`}>
      <div className="flex items-center justify-between gap-4 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {action}
      </div>
      <div className="flex items-center gap-4">
        <div className="min-w-[104px]">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            {t('painel.logistica.carregamentos.status.dentro')}
          </p>
          <p className="text-lg font-semibold tabular-nums text-emerald-700 leading-tight">
            {stats.dentro}
            <span className="ml-1.5 text-xs font-medium text-muted-foreground">
              {stats.dentroPct}%
            </span>
          </p>
        </div>
        <div className="h-8 w-px bg-border" aria-hidden />
        <div className="min-w-[104px]">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />
            {t('painel.logistica.carregamentos.status.fora')}
          </p>
          <p className="text-lg font-semibold tabular-nums text-red-700 leading-tight">
            {stats.fora}
            <span className="ml-1.5 text-xs font-medium text-muted-foreground">
              {stats.foraPct}%
            </span>
          </p>
        </div>
        <div className="h-8 w-px bg-border" aria-hidden />
        <div className="min-w-[64px]">
          <p className="text-[11px] text-muted-foreground">
            {t('painel.logistica.carregamentos.stats.total')}
          </p>
          <p className="text-lg font-semibold tabular-nums text-foreground leading-tight">
            {stats.total}
          </p>
        </div>
      </div>
    </div>
  );
}
