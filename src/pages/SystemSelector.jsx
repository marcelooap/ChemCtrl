import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, LogOut } from 'lucide-react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { getDefaultRoute } from '@/lib/permissions';
import { applications } from '@/config/applications';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

function resolveApplicationRoute(app, user) {
  if (!app.enabled) return null;
  if (app.route) return app.route;
  return getDefaultRoute(user);
}

function ApplicationCard({ app, onAccess }) {
  const { t } = useTranslation();
  const enabled = app.enabled;

  return (
    <Card
      className={cn(
        'flex h-full flex-col border-border/80 shadow-sm transition-shadow duration-200',
        enabled ? 'hover:shadow-md hover:border-primary/30' : 'opacity-95'
      )}
    >
      <CardHeader className="space-y-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
              <img
                src={app.logoSrc}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-xl font-semibold tracking-tight text-foreground">
                {t(app.nameKey)}
              </CardTitle>
              {!enabled && app.badgeKey && (
                <Badge variant="secondary" className="font-medium">
                  {t(app.badgeKey)}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <CardDescription className="text-sm leading-relaxed text-muted-foreground">
          {t(app.descriptionKey)}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 space-y-4 pb-4">
        <Separator />
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {app.features.map((feature) => {
            const Icon = feature.icon;
            return (
              <li
                key={feature.id}
                className="flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-2 text-xs font-medium text-muted-foreground"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background border border-border">
                  <Icon className="h-3.5 w-3.5 text-foreground/80" strokeWidth={1.75} />
                </span>
                <span className="truncate">{t(feature.labelKey)}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>

      <CardFooter className="pt-0">
        {enabled ? (
          <Button
            className="h-11 w-full text-white font-medium"
            style={{ background: '#2563eb' }}
            onClick={() => onAccess(app)}
          >
            {t(app.ctaKey)}
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            disabled
            aria-disabled="true"
            className="h-11 w-full cursor-not-allowed disabled:pointer-events-auto disabled:opacity-60"
          >
            {t(app.ctaDisabledKey)}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

export default function SystemSelector() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useInternalAuth();

  const handleAccess = (app) => {
    const route = resolveApplicationRoute(app, user);
    if (!route) return;
    navigate(route);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/icons/chemctrl-logo.svg"
              alt="ChemCtrl"
              className="h-8 w-8 rounded-lg object-cover shrink-0"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground tracking-tight">
                {t('systemSelector.brand')}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {t('systemSelector.headerSubtitle')}
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => logout()}
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{t('systemSelector.logout')}</span>
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col justify-center px-4 py-10 sm:px-6">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-8 text-center sm:mb-10">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {t('systemSelector.title')}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              {t('systemSelector.subtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
            {applications.map((app) => (
              <ApplicationCard key={app.id} app={app} onAccess={handleAccess} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
