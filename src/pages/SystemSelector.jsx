import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { getDefaultRoute, isAdminUser } from '@chemblend/lib/permissions';
import { applications } from '@/config/applications';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@shared/components/ui/card';
import { Button } from '@shared/components/ui/button';
import { Badge } from '@shared/components/ui/badge';
import { Separator } from '@shared/components/ui/separator';
import { cn } from '@shared/lib/utils';

function resolveApplicationRoute(app, user) {
  if (!app.enabled) return null;
  if (app.route) return app.route;
  return getDefaultRoute(user);
}

/** App acessível no portal: habilitado e, se exige admin, usuário é administrador. */
function isApplicationAccessible(app, user) {
  if (!app.enabled) return false;
  if (app.requiresAdmin && !isAdminUser(user)) return false;
  return true;
}

function ApplicationCard({ app, accessible, onAccess }) {
  const { t } = useTranslation();
  const showBadge = !accessible && Boolean(app.badgeKey);

  return (
    <Card
      className={cn(
        'flex h-full flex-col border-border/80 shadow-sm transition-shadow duration-200',
        accessible ? 'hover:shadow-md hover:border-primary/30' : 'opacity-95'
      )}
    >
      <CardHeader className="space-y-2.5 p-4 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
            <img
              src={app.logoSrc}
              alt=""
              className="h-full w-full object-contain p-0.5"
            />
          </div>
          <div className="min-w-0 space-y-0.5">
            <CardTitle className="text-base font-semibold tracking-tight text-foreground">
              {t(app.nameKey)}
            </CardTitle>
            {showBadge && (
              <Badge variant="secondary" className="font-medium text-[10px] px-1.5 py-0">
                {t(app.badgeKey)}
              </Badge>
            )}
          </div>
        </div>

        <CardDescription className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
          {t(app.descriptionKey)}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 space-y-2.5 px-4 pb-3 pt-0">
        <Separator />
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {app.features.map((feature) => {
            const Icon = feature.icon;
            return (
              <li
                key={feature.id}
                className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1.5 text-[11px] font-medium text-muted-foreground"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-background border border-border">
                  <Icon className="h-3 w-3 text-foreground/80" strokeWidth={1.75} />
                </span>
                <span className="truncate">{t(feature.labelKey)}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>

      <CardFooter className="px-4 pb-4 pt-0">
        {accessible ? (
          <Button
            size="sm"
            className="h-9 w-full text-white font-medium"
            style={{ background: '#2563eb' }}
            onClick={() => onAccess(app)}
          >
            {t(app.ctaKey)}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled
            aria-disabled="true"
            className="h-9 w-full cursor-not-allowed disabled:pointer-events-auto disabled:opacity-60"
          >
            {t(app.ctaDisabledKey || 'systemSelector.comingSoon')}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

/** Home da plataforma — seleção de módulos ChemBlend / ChemFlow. */
export default function SystemSelector() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useInternalAuth();

  const handleAccess = (app) => {
    if (!isApplicationAccessible(app, user)) return;
    const route = resolveApplicationRoute(app, user);
    if (!route) return;
    navigate(route);
  };

  return (
    <div className="flex flex-col min-h-full px-2 pt-1 pb-6 sm:px-4">
      <div className="w-full max-w-3xl">
        <div className="mb-4">
          <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {t('systemSelector.title')}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
            {t('systemSelector.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          {applications.map((app) => (
            <ApplicationCard
              key={app.id}
              app={app}
              accessible={isApplicationAccessible(app, user)}
              onAccess={handleAccess}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
