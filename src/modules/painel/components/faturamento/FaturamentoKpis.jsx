import { useTranslation } from 'react-i18next';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Warehouse,
  CircleDollarSign,
} from 'lucide-react';
import { Card, CardHeader, CardDescription } from '@shared/components/ui/card';
import { formatCurrency } from '@transbordo/lib/format';
import { fromCents } from '@painel/lib/faturamentoEmbalados';

const ITEMS = [
  {
    key: 'movEntrada',
    icon: ArrowDownToLine,
    field: 'movEntradaCents',
    badge:
      'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200',
  },
  {
    key: 'movSaida',
    icon: ArrowUpFromLine,
    field: 'movSaidaCents',
    badge:
      'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200',
  },
  {
    key: 'armazenagem',
    icon: Warehouse,
    field: 'armazenagemCents',
    badge: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
  },
  {
    key: 'total',
    icon: CircleDollarSign,
    field: 'totalCents',
    badge:
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  },
];

export default function FaturamentoKpis({ totals }) {
  const { t } = useTranslation();
  const safe = totals || {
    movEntradaCents: 0,
    movSaidaCents: 0,
    armazenagemCents: 0,
    totalCents: 0,
    pendencias: 0,
  };

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
        {ITEMS.map(({ key, icon: Icon, field, badge }) => (
          <Card key={key} className="shadow-sm">
            <CardHeader className="py-2.5 px-3.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <CardDescription className="text-[10px] font-semibold uppercase tracking-wider leading-tight">
                  {t(`painel.faturamento.kpis.${key}`)}
                </CardDescription>
                <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </div>
              <span
                className={`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums ${badge}`}
              >
                {formatCurrency(fromCents(safe[field] || 0))}
              </span>
            </CardHeader>
          </Card>
        ))}
      </div>
      {safe.pendencias > 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t('painel.faturamento.kpis.pendencias', { count: safe.pendencias })}
        </p>
      ) : null}
    </div>
  );
}
