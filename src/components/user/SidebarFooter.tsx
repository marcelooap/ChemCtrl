import React from 'react';
import { LogOut, PanelLeft, PanelLeftClose } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInternalAuth } from '@/lib/InternalAuthContext';

interface SidebarFooterProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function SidebarFooter({ collapsed, onToggleCollapse }: SidebarFooterProps) {
  const { logout } = useInternalAuth();

  return (
    <div className="border-t border-white/10 p-3 shrink-0">
      <div
        className={cn(
          'flex items-center gap-2',
          collapsed ? 'justify-center' : 'justify-between px-1'
        )}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expandir sidebar' : 'Recolher sidebar'}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0"
        >
          {collapsed ? (
            <PanelLeft className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>

        <button
          type="button"
          onClick={logout}
          aria-label="Sair"
          className={cn(
            'flex items-center gap-2 rounded-lg text-white/60 hover:text-red-400 hover:bg-white/10 transition-all duration-200 shrink-0 overflow-hidden',
            collapsed
              ? 'w-0 opacity-0 p-0 pointer-events-none'
              : 'w-auto opacity-100 px-2 py-1.5'
          )}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span
            className={cn(
              'text-sm font-medium whitespace-nowrap transition-all duration-200',
              collapsed ? 'max-w-0 opacity-0' : 'max-w-[4rem] opacity-100'
            )}
          >
            Sair
          </span>
        </button>
      </div>
    </div>
  );
}
