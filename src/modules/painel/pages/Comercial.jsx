import { useTranslation } from 'react-i18next';
import { Briefcase } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';

const FUTURE_TOPICS = [
  'clients',
  'orders',
  'fichado',
  'reservations',
  'requests',
  'sales',
  'products',
  'status',
];

export default function Comercial() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('painel.comercial.title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('painel.comercial.subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{t('painel.comercial.emptyTitle')}</CardTitle>
              <CardDescription className="mt-1.5">
                {t('painel.comercial.emptyDescription')}
              </CardDescription>
            </div>
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Briefcase className="w-5 h-5 text-muted-foreground" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {FUTURE_TOPICS.map((topic) => (
              <li
                key={topic}
                className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
              >
                {t(`painel.comercial.topics.${topic}`)}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
