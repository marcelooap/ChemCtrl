export type NotificationType = 'info' | 'success' | 'warning' | 'error';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';

export type NotificationEvent =
  | 'production_created'
  | 'production_finished'
  | 'cq_released'
  | 'filling_finished';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  priority: NotificationPriority;
  event: string;
  entity_type?: string | null;
  entity_id?: string | null;
  related_op?: string | null;
  related_table?: string | null;
  action_url?: string | null;
  client: string;
  target_role?: string | null;
  target_user?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface NotificationWithRead extends Notification {
  isRead: boolean;
  read_at?: string | null;
}

export interface ProductionNotificationPayload {
  id: string;
  op_number?: string;
  client?: string;
}

export interface CreateNotificationInput {
  title: string;
  message: string;
  type?: NotificationType;
  priority?: NotificationPriority;
  event: string;
  entity_type?: string;
  entity_id?: string;
  related_op?: string;
  related_table?: string;
  action_url?: string;
  client: string;
  target_role?: string | null;
  target_user?: string | null;
}

export interface NotificationListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  readFilter?: 'all' | 'read' | 'unread';
  typeFilter?: NotificationType | 'all';
}

export interface NotificationRead {
  id: string;
  notification_id: string;
  user_id: string;
  read_at: string;
}
