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

export interface EventTemplate {
  title: string;
  message: (opNumber: string) => string;
  type: NotificationType;
  actionUrlInternal: (entityId: string) => string;
  actionUrlExternal: (entityId: string) => string;
}

export const EVENT_TEMPLATES: Record<NotificationEvent, EventTemplate> = {
  production_created: {
    title: 'Nova Ordem de Produção',
    message: (op) => `A OP ${op} foi registrada e está disponível para produção.`,
    type: 'info',
    actionUrlInternal: () => '/ordens',
    actionUrlExternal: (id) => `/tela-clientes?prod=${id}`,
  },
  production_finished: {
    title: 'Produção Finalizada',
    message: (op) => `A OP ${op} foi enviada para o Controle de Qualidade.`,
    type: 'warning',
    actionUrlInternal: (id) => `/qualidade/producoes?prod=${id}`,
    actionUrlExternal: (id) => `/tela-clientes?prod=${id}`,
  },
  cq_released: {
    title: 'CQ Liberou Produção',
    message: (op) => `A OP ${op} foi liberada para Envase.`,
    type: 'success',
    actionUrlInternal: () => '/ordens',
    actionUrlExternal: (id) => `/tela-clientes?prod=${id}`,
  },
  filling_finished: {
    title: 'Envase Finalizado',
    message: (op) => `A OP ${op} foi concluída com sucesso.`,
    type: 'success',
    actionUrlInternal: () => '/producoes',
    actionUrlExternal: (id) => `/tela-clientes?prod=${id}`,
  },
};
