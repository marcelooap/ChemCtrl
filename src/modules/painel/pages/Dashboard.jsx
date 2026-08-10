import { useTranslation } from 'react-i18next';
import {
  Factory,
  ArrowRightLeft,
  ClipboardList,
  FileStack,
  Truck,
  Boxes,
  BarChart3,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';

const KPI_KEYS = [
  { key: 'volumeProduced', icon: Factory },
  { key: 'volumeTransferred', icon: ArrowRightLeft },
  { key: 'orders', icon: ClipboardList },
  { key: 'productionOrders', icon: FileStack },
  { key: 'loadings', icon: Truck },
  { key: 'stock', icon: Boxes },
];

const CHART_KEYS = [
  'production',
  'transbordo',
  'sales',
  'logistics',
  'stock',
];

export default function Dashboard() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('painel.dashboard.title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('painel.dashboard.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {KPI_KEYS.map(({ key, icon: Icon }) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(`painel.dashboard.kpis.${key}`)}
                </CardDescription>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-muted shrink-0">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
              <CardTitle className="text-2xl text-muted-foreground/60 font-bold pt-2">—</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{t('painel.dashboard.awaitingData')}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">{t('painel.dashboard.chartsTitle')}</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {CHART_KEYS.map((key) => (
            <Card key={key} className="min-h-[220px]">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">
                    {t(`painel.dashboard.charts.${key}`)}
                  </CardTitle>
                  <BarChart3 className="w-4 h-4 text-muted-foreground shrink-0" />
                </div>
                <CardDescription>{t('painel.dashboard.chartPlaceholder')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-36 rounded-lg border border-dashed border-border bg-muted/40 flex items-center justify-center">
                  <p className="text-xs text-muted-foreground px-4 text-center">
                    {t('painel.dashboard.awaitingData')}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
