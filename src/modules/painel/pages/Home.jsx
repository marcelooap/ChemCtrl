import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Factory, ArrowRightLeft, ArrowRight } from 'lucide-react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { getAccessibleModules, resolveModuleEntryRoute } from '@/lib/modules/access';
import { MODULE_IDS } from '@/lib/modules/catalog';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import { Button } from '@shared/components/ui/button';

const CARD_META = {
  [MODULE_IDS.INDUSTRIALIZACAO]: {
    icon: Factory,
    accent: '#2575D1',
  },
  [MODULE_IDS.TRANSBORDO]: {
    icon: ArrowRightLeft,
    accent: '#0D9488',
  },
};

export default function Home() {
  const { t } = useTranslation();
  const { user } = useInternalAuth();
  const modules = useMemo(() => getAccessibleModules(user), [user]);

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('moduleSelection.title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('moduleSelection.subtitle')}</p>
      </div>

      {modules.length === 0 ? (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle className="text-lg">{t('moduleSelection.emptyTitle')}</CardTitle>
            <CardDescription>{t('moduleSelection.emptyDescription')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6">
          {modules.map((mod) => {
            const meta = CARD_META[mod.id] || {};
            const Icon = meta.icon || Factory;
            const to = resolveModuleEntryRoute(user, mod.id);
            const accent = meta.accent || mod.accent;
            return (
              <Card key={mod.id} className="min-w-0 flex flex-col">
                <CardHeader className="pb-3 pt-6 px-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle className="text-xl">{t(mod.titleKey)}</CardTitle>
                      <CardDescription className="mt-2 text-sm leading-relaxed">
                        {t(mod.descriptionKey)}
                      </CardDescription>
                    </div>
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: accent }}
                    >
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-6 pb-6 mt-auto">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      {t('moduleSelection.accessGranted')}
                    </span>
                    <Button
                      asChild
                      className="w-full sm:w-auto text-white"
                      style={{ background: accent }}
                    >
                      <Link to={to}>
                        {t('painel.home.openModule')}
                        <ArrowRight className="w-4 h-4" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
