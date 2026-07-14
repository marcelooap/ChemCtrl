import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldOff } from 'lucide-react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { getDefaultRoute } from '@/lib/permissions';
import { Button } from '@/components/ui/button';

export default function AcessoNegado() {
  const { t } = useTranslation();
  const { user } = useInternalAuth();
  const home = getDefaultRoute(user);

  return (
    <div className="flex h-full min-h-0 items-center justify-center">
      <div className="max-w-md text-center px-6">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40">
          <ShieldOff className="h-7 w-7 text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">{t('accessDenied.title')}</h1>
        <p className="text-sm text-muted-foreground mb-6">{t('accessDenied.description')}</p>
        <Button asChild className="text-white" style={{ background: '#2575D1' }}>
          <Link to={home}>{t('accessDenied.goBack')}</Link>
        </Button>
      </div>
    </div>
  );
}
