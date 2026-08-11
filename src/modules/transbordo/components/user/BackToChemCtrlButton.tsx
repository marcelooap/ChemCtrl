import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Factory } from 'lucide-react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { canAccessModule, PAINEL_HOME_ROUTE, resolveModuleEntryRoute } from '@/lib/modules/access';
import { MODULE_IDS } from '@/lib/modules/catalog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import { cn } from '@shared/lib/utils';

/** Retorna do Transbordo para o Painel (hub de módulos). */
export function BackToChemCtrlButton() {
  const { t } = useTranslation();
  const { user } = useInternalAuth();
  const canInd = canAccessModule(user, MODULE_IDS.INDUSTRIALIZACAO);

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={PAINEL_HOME_ROUTE}
            aria-label={t('moduleSelection.navSelect')}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5',
              'text-muted-foreground hover:text-foreground hover:bg-accent/80',
              'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="hidden text-sm font-medium sm:inline">
              {t('moduleSelection.navSelect')}
            </span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="sm:hidden">
          {t('moduleSelection.navSelect')}
        </TooltipContent>
      </Tooltip>

      {canInd && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to={resolveModuleEntryRoute(user, MODULE_IDS.INDUSTRIALIZACAO)}
              aria-label={t('painel.modules.industrializacao')}
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-lg',
                'text-muted-foreground hover:text-foreground hover:bg-accent/80',
                'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring'
              )}
            >
              <Factory className="h-4 w-4" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            {t('painel.modules.industrializacao')}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
