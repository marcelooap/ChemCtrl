import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bell, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useNotifications } from '../hooks/useNotifications';
import { NotificationBadge } from './NotificationBadge';
import { NotificationItem } from './NotificationItem';

export function NotificationDropdown() {
  const { t } = useTranslation();
  const {
    notifications,
    unreadCount,
    loading,
    pulseToken,
    markAllAsRead,
    navigateToNotification,
  } = useNotifications();
  const [ringing, setRinging] = useState(false);

  useEffect(() => {
    if (pulseToken <= 0) return;
    setRinging(true);
    const timer = setTimeout(() => setRinging(false), 900);
    return () => clearTimeout(timer);
  }, [pulseToken]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('relative h-9 w-9', ringing && 'notif-bell-pulse')}
          aria-label={t('notifications.title')}
        >
          <Bell
            className={cn(
              'h-5 w-5 text-muted-foreground transition-transform',
              ringing && 'notif-bell-ring'
            )}
          />
          <NotificationBadge count={unreadCount} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">
            {t('notifications.title')}
            {unreadCount > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({t(unreadCount === 1 ? 'notifications.unread' : 'notifications.unreadPlural', { count: unreadCount })})
              </span>
            )}
          </h3>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllAsRead()}
              className="text-xs text-[#2575D1] hover:underline"
            >
              {t('notifications.markAllRead')}
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t('notifications.empty')}
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
            {t('notifications.viewAll')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function NotificationBell() {
  return <NotificationDropdown />;
}
