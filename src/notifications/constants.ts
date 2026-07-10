import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import { Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { NotificationEvent, NotificationType } from './types';

export const NOTIFICATION_TYPE_CONFIG: Record<
  NotificationType,
  { icon: LucideIcon; color: string; bgClass: string }
> = {
  info: {
    icon: Info,
    color: '#2575D1',
    bgClass: 'bg-blue-50',
  },
  success: {
    icon: CheckCircle2,
    color: '#00875a',
    bgClass: 'bg-green-50',
  },
  warning: {
    icon: AlertTriangle,
    color: '#f59e0b',
    bgClass: 'bg-amber-50',
  },
  error: {
    icon: XCircle,
    color: 'hsl(0 84% 60%)',
    bgClass: 'bg-red-50',
  },
};

export const DROPDOWN_LIMIT = 20;
export const HISTORY_PAGE_SIZE = 20;

export interface EventTemplateConfig {
  type: NotificationType;
  actionUrlInternal: (entityId: string) => string;
  actionUrlExternal: (entityId: string) => string;
}

export const EVENT_TEMPLATE_CONFIG: Record<NotificationEvent, EventTemplateConfig> = {
  production_created: {
    type: 'info',
    actionUrlInternal: () => '/ordens',
    actionUrlExternal: (id) => `/tela-clientes?prod=${id}`,
  },
  production_finished: {
    type: 'warning',
    actionUrlInternal: (id) => `/qualidade/producoes?prod=${id}`,
    actionUrlExternal: (id) => `/tela-clientes?prod=${id}`,
  },
  cq_released: {
    type: 'success',
    actionUrlInternal: () => '/ordens',
    actionUrlExternal: (id) => `/tela-clientes?prod=${id}`,
  },
  filling_finished: {
    type: 'success',
    actionUrlInternal: () => '/producoes',
    actionUrlExternal: (id) => `/tela-clientes?prod=${id}`,
  },
};

export function getNotificationText(t: TFunction, event: NotificationEvent, opNumber: string) {
  return {
    title: t(`notifications.events.${event}.title`),
    message: t(`notifications.events.${event}.message`, { op: opNumber }),
  };
}
