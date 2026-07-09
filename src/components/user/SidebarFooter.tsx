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
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:text-red-400 hover:bg-white/10 transition-colors shrink-0"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
