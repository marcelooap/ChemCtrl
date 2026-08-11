import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRightLeft,
  Factory,
  LayoutDashboard,
  LayoutGrid,
  LayoutList,
} from 'lucide-react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { isAdminUser } from '@industrializacao/lib/permissions';
import { getAccessibleModules, resolveModuleEntryRoute } from '@/lib/modules/access';
import { MODULE_IDS } from '@/lib/modules/catalog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import { cn } from '@shared/lib/utils';

const ICONS = {
  Factory,
  ArrowRightLeft,
  [MODULE_IDS.INDUSTRIALIZACAO]: Factory,
  [MODULE_IDS.TRANSBORDO]: ArrowRightLeft,
};

/** Atalho para módulos autorizados + Painel (admin) a partir da Industrialização. */
export function ModulesHubButton() {
  const { t } = useTranslation();
  const { user } = useInternalAuth();
  const { pathname } = useLocation();
  const accessible = useMemo(() => getAccessibleModules(user), [user]);
  const admin = isAdminUser(user);

  if (user?.tipo === 'externo') return null;
  if (!accessible.length && !admin) return null;

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
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link to="/painel/home" className="flex items-center gap-2 cursor-pointer">
            <LayoutList className="h-4 w-4 shrink-0" />
            {t('moduleSelection.navSelect')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {accessible.map((mod) => {
          const Icon = ICONS[mod.icon] || ICONS[mod.id] || LayoutGrid;
          const active =
            mod.id === MODULE_IDS.TRANSBORDO
              ? pathname.startsWith('/chemflow')
              : !pathname.startsWith('/chemflow') && !pathname.startsWith('/painel');
          return (
            <DropdownMenuItem key={mod.id} asChild>
              <Link
                to={resolveModuleEntryRoute(user, mod.id)}
                className={cn('flex items-center gap-2 cursor-pointer', active ? 'bg-accent' : '')}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {t(mod.titleKey)}
              </Link>
            </DropdownMenuItem>
          );
        })}
        {admin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                to="/painel/home"
                className={cn(
                  'flex items-center gap-2 cursor-pointer',
                  pathname.startsWith('/painel') ? 'bg-accent' : ''
                )}
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" />
                {t('painel.modules.painel')}
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
