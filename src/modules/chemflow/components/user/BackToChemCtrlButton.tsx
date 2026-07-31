import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import { cn } from '@shared/lib/utils';

/** Retorna do módulo ChemFlow para o ChemCtrl. */
export function BackToChemCtrlButton() {
  const { t } = useTranslation();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/"
          aria-label={t('sidebar.footer.backToChemCtrl')}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5',
            'text-muted-foreground hover:text-foreground hover:bg-accent/80',
            'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span className="hidden text-sm font-medium sm:inline">
            {t('sidebar.footer.backToChemCtrl')}
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="sm:hidden">
        {t('sidebar.footer.backToChemCtrl')}
      </TooltipContent>
    </Tooltip>
  );
}
