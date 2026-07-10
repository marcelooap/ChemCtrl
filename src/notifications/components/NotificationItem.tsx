import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { fmtRelativeTime } from '@/i18n/formatters';
import { NOTIFICATION_TYPE_CONFIG } from '../constants';
import type { NotificationWithRead } from '../types';

interface NotificationItemProps {
  notification: NotificationWithRead;
  onClick: (notification: NotificationWithRead) => void;
  compact?: boolean;
}

export function NotificationItem({
  notification,
  onClick,
  compact = false,
}: NotificationItemProps) {
  const { i18n } = useTranslation();
  const config = NOTIFICATION_TYPE_CONFIG[notification.type] ?? NOTIFICATION_TYPE_CONFIG.info;
  const Icon = config.icon;

  return (
    <button
      type="button"
      onClick={() => onClick(notification)}
      className={cn(
        'w-full text-left flex gap-3 p-3 rounded-lg transition-colors hover:bg-accent/50 border-b border-border last:border-0',
        !notification.isRead && 'bg-primary/5'
      )}
    >
      <div
        className={cn(
          'flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center',
          config.bgClass
        )}
      >
        <Icon className="w-4 h-4" style={{ color: config.color }} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm font-medium truncate',
              notification.isRead ? 'text-muted-foreground' : 'text-foreground'
            )}
          >
            {notification.title}
          </p>
          {!notification.isRead && (
            <span className="flex-shrink-0 w-2 h-2 rounded-full bg-[#2575D1] mt-1.5" />
          )}
        </div>
        <p
          className={cn(
            'text-xs mt-0.5',
            compact ? 'line-clamp-1' : 'line-clamp-2',
            notification.isRead ? 'text-muted-foreground/80' : 'text-muted-foreground'
          )}
        >
          {notification.message}
        </p>
        <p className="text-[11px] text-muted-foreground/70 mt-1">
          {fmtRelativeTime(notification.created_at, i18n.language)}
        </p>
      </div>
    </button>
  );
}
