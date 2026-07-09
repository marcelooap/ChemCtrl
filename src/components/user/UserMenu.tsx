import React from 'react';
import { ChevronDown } from 'lucide-react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { getRoleLabel } from '@/lib/permissions';
import { getInstalledVersion } from '@/pwa/version';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { UserAvatar, getUserDisplayName, getUserFirstName } from './UserAvatar';
import { ThemeSelector } from './ThemeSelector';
import { cn } from '@/lib/utils';

export function UserMenu() {
  const { user } = useInternalAuth();

  if (!user) return null;

  const displayName = getUserDisplayName(user);
  const firstName = getUserFirstName(user);
  const roleLabel = getRoleLabel(user);
  const username = user.usuario || user.username || '—';
  const version = getInstalledVersion();

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-haspopup="menu"
              className={cn(
                'flex items-center gap-2 rounded-lg px-2 py-1.5',
                'hover:bg-accent/80 transition-colors outline-none',
                'focus-visible:ring-2 focus-visible:ring-ring'
              )}
            >
              <UserAvatar user={user} size="sm" />
              <span className="hidden sm:inline text-sm font-medium text-foreground truncate max-w-[120px]">
                {firstName}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="max-w-xs">
          <div className="space-y-1 text-left">
            <p>
              <span className="opacity-80">Nome completo:</span>
              <br />
              <span className="font-medium">{displayName}</span>
            </p>
            <p>
              <span className="opacity-80">Nível:</span>
              <br />
              <span className="font-medium">{roleLabel}</span>
            </p>
            <p>
              <span className="opacity-80">Usuário:</span>
              <br />
              <span className="font-medium">{username}</span>
            </p>
            <p>
              <span className="opacity-80">Versão:</span>
              <br />
              <span className="font-medium">{version}</span>
            </p>
          </div>
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-64 p-0">
        <div className="px-4 py-4 flex items-start gap-3">
          <UserAvatar user={user} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm text-foreground truncate">{displayName}</p>
            <p className="text-xs text-muted-foreground truncate">@{username}</p>
            <span className="inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              {roleLabel}
            </span>
          </div>
        </div>

        <DropdownMenuSeparator />

        <ThemeSelector />

        <DropdownMenuSeparator />

        <div className="px-4 py-2 text-center">
          <span className="text-[10px] text-muted-foreground">Ver. {version}</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
