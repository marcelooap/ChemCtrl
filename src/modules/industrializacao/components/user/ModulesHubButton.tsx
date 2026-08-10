import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft } from 'lucide-react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { isAdminUser } from '@industrializacao/lib/permissions';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import { cn } from '@shared/lib/utils';

/** Atalho admin para o módulo ChemFlow dentro do ChemCtrl. */
export function ModulesHubButton() {
  const { t } = useTranslation();
  const { user } = useInternalAuth();

  if (!isAdminUser(user)) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/chemflow"
          aria-label={t('sidebar.footer.openChemFlow')}
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded-lg',
            'text-muted-foreground hover:text-foreground hover:bg-accent/80',
            'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
        >
          <ArrowRightLeft className="h-4 w-4" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        {t('sidebar.footer.openChemFlow')}
      </TooltipContent>
    </Tooltip>
  );
}
