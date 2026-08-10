import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRightLeft, LayoutGrid } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import { cn } from '@shared/lib/utils';

/**
 * Troca entre módulos a partir do Painel (Industrialização / Transbordo).
 * Reutiliza o padrão visual do ModulesHubButton da Industrialização.
 */
export function ModulesSwitcher() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('painel.modules.switch')}
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-lg',
                'text-muted-foreground hover:text-foreground hover:bg-accent/80',
                'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring'
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          {t('painel.modules.switch')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <Link
            to="/"
            className={cn(
              'flex items-center gap-2 cursor-pointer',
              pathname === '/' || (!pathname.startsWith('/chemflow') && !pathname.startsWith('/painel'))
                ? 'bg-accent'
                : ''
            )}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            {t('painel.modules.industrializacao')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            to="/chemflow"
            className={cn(
              'flex items-center gap-2 cursor-pointer',
              pathname.startsWith('/chemflow') ? 'bg-accent' : ''
            )}
          >
            <ArrowRightLeft className="h-4 w-4 shrink-0" />
            {t('painel.modules.transbordo')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
