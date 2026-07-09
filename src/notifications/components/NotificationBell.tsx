import React from 'react';
import { Link } from 'react-router-dom';
import { Bell, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications } from '../hooks/useNotifications';
import { NotificationBadge } from './NotificationBadge';
import { NotificationItem } from './NotificationItem';

export function NotificationDropdown() {
  const {
    notifications,
    unreadCount,
    loading,
    markAllAsRead,
    navigateToNotification,
  } = useNotifications();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <NotificationBadge count={unreadCount} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm" style={{ color: '#1A1A2E' }}>
            Notificações
            {unreadCount > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({unreadCount} não {unreadCount === 1 ? 'lida' : 'lidas'})
              </span>
            )}
          </h3>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllAsRead()}
              className="text-xs text-[#2575D1] hover:underline"
            >
              Marcar todas como lidas
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma notificação
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="p-1">
              {notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onClick={navigateToNotification}
                  compact
                />
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="border-t px-4 py-2">
          <Link
            to="/notificacoes"
            className="text-xs text-[#2575D1] hover:underline"
          >
            Ver todas as notificações
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function NotificationBell() {
  return <NotificationDropdown />;
}
