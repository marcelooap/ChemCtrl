import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Factory, ArrowRightLeft, Briefcase, Truck } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';

const AREA_CARDS = [
  {
    key: 'industrializacao',
    icon: Factory,
    to: '/',
    accent: '#2575D1',
  },
  {
    key: 'transbordo',
    icon: ArrowRightLeft,
    to: '/chemflow',
    accent: '#0D9488',
  },
  {
    key: 'comercial',
    icon: Briefcase,
    to: '/painel/comercial',
    accent: '#7C3AED',
  },
  {
    key: 'logistica',
    icon: Truck,
    to: '/painel/logistica',
    accent: '#EA580C',
  },
];

export default function Home() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('painel.home.title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('painel.home.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {AREA_CARDS.map(({ key, icon: Icon, to, accent }) => (
          <Link key={key} to={to} className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
            <Card className="h-full transition-colors group-hover:border-[#2575D1]/40 group-hover:bg-accent/30">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      {t(`painel.areas.${key}.title`)}
                    </CardTitle>
                    <CardDescription className="mt-1.5">
                      {t(`painel.areas.${key}.description`)}
                    </CardDescription>
                  </div>
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: accent }}
                  >
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {t('painel.home.preparedForData')}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
