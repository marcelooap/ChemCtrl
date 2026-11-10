import { useTranslation } from 'react-i18next';
import { Warehouse, CircleDollarSign, Container, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardDescription } from '@shared/components/ui/card';
import { formatCurrency } from '@transbordo/lib/format';
import { fromCents } from '@painel/lib/faturamentoEmbalados';

export default function FaturamentoVasilhamesKpis({ totals }) {
  const { t } = useTranslation();
  const safe = totals || {
    armazenagemCents: 0,
    totalCents: 0,
    pendencias: 0,
    quantidade: 0,
  };

  const items = [
    {
      key: 'quantidade',
      icon: Container,
      value: String(safe.quantidade || 0),
      badge: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
    },
    {
      key: 'armazenagem',
      icon: Warehouse,
      value: formatCurrency(fromCents(safe.armazenagemCents || 0)),
      badge: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
    },
    {
      key: 'total',
      icon: CircleDollarSign,
      value: formatCurrency(fromCents(safe.totalCents || 0)),
      badge:
        'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
    },
  ];

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {items.map(({ key, icon: Icon, value, badge }) => (
          <Card key={key} className="shadow-sm">
            <CardHeader className="py-2.5 px-3.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <CardDescription className="text-[10px] font-semibold uppercase tracking-wider leading-tight">
                  {t(`painel.faturamentoVasilhames.kpis.${key}`)}
                </CardDescription>
                <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </div>
              <span
                className={`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums ${badge}`}
              >
                {value}
              </span>
            </CardHeader>
          </Card>
        ))}
      </div>
      {safe.pendencias > 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-400 inline-flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" />
          {t('painel.faturamentoVasilhames.kpis.pendencias', {
            count: safe.pendencias,
          })}
        </p>
      ) : null}
    </div>
  );
}
