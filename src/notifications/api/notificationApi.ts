import { callRPC } from '@/api/rpcClient';
import { getSessionId } from '@/api/rpcClient';
import { supabaseAnonKey } from '@/api/supabaseClient';
import type {
  CreateNotificationInput,
  Notification,
  NotificationListOptions,
  NotificationRead,
  NotificationWithRead,
} from '../types';
import { HISTORY_PAGE_SIZE } from '../constants';

const supabaseUrl = 'https://cpzibnwytukcgxeamfhp.supabase.co';
const restUrl = `${supabaseUrl}/rest/v1`;

const getHeaders = (extra: Record<string, string> = {}) => {
  const sessionId = getSessionId();
  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
    'Content-Type': 'application/json',
    ...(sessionId ? { 'x-session-id': sessionId } : {}),
    ...extra,
  };
};

export async function createNotificationRpc(
  input: CreateNotificationInput
): Promise<{ success: boolean; id?: string; error?: string }> {
  const result = await callRPC('create_notification', {
    p_title: input.title,
    p_message: input.message,
    p_type: input.type ?? 'info',
    p_priority: input.priority ?? 'normal',
    p_event: input.event,
    p_entity_type: input.entity_type ?? null,
    p_entity_id: input.entity_id ?? null,
    p_related_op: input.related_op ?? null,
    p_related_table: input.related_table ?? null,
    p_action_url: input.action_url ?? null,
    p_client: input.client,
    p_target_role: input.target_role ?? null,
    p_target_user: input.target_user ?? null,
  });
  return result as { success: boolean; id?: string; error?: string };
}

export async function markNotificationReadRpc(
  notificationId: string
): Promise<{ success: boolean; error?: string }> {
  const result = await callRPC('mark_notification_read', {
    p_notification_id: notificationId,
  });
  return result as { success: boolean; error?: string };
}

export async function markAllNotificationsReadRpc(): Promise<{
  success: boolean;
  marked?: number;
  error?: string;
}> {
  const result = await callRPC('mark_all_notifications_read', {});
  return result as { success: boolean; marked?: number; error?: string };
}

export async function getUnreadCountRpc(): Promise<number> {
  const result = await callRPC('get_unread_notification_count', {});
  return typeof result === 'number' ? result : 0;
}

export async function fetchNotifications(
  options: NotificationListOptions = {}
): Promise<Notification[]> {
  const limit = options.limit ?? HISTORY_PAGE_SIZE;
  const offset = options.offset ?? 0;

  const params = new URLSearchParams();
  params.set('select', '*');
  params.set('order', 'created_at.desc');
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  if (options.typeFilter && options.typeFilter !== 'all') {
    params.set('type', `eq.${options.typeFilter}`);
  }

  if (options.search?.trim()) {
    const q = options.search.trim();
    params.set('or', `(title.ilike.*${q}*,message.ilike.*${q}*)`);
  }

  const resp = await fetch(`${restUrl}/notifications?${params}`, {
    headers: getHeaders(),
    cache: 'no-store',
  });

  if (!resp.ok) return [];
  return (await resp.json()) as Notification[];
}

export async function fetchNotificationReads(
  userId: string
): Promise<NotificationRead[]> {
  const params = new URLSearchParams();
  params.set('select', '*');
  params.set('user_id', `eq.${userId}`);

  const resp = await fetch(`${restUrl}/notification_reads?${params}`, {
    headers: getHeaders(),
    cache: 'no-store',
  });

  if (!resp.ok) return [];
  return (await resp.json()) as NotificationRead[];
}

export function mergeNotificationsWithReads(
  notifications: Notification[],
  reads: NotificationRead[]
): NotificationWithRead[] {
  const readMap = new Map(reads.map((r) => [r.notification_id, r.read_at]));

  return notifications.map((n) => ({
    ...n,
    isRead: readMap.has(n.id),
    read_at: readMap.get(n.id) ?? null,
  }));
}

export async function fetchNotificationsWithReads(
  userId: string,
  options: NotificationListOptions = {}
): Promise<NotificationWithRead[]> {
  const [notifications, reads] = await Promise.all([
    fetchNotifications(options),
    fetchNotificationReads(userId),
  ]);

  let merged = mergeNotificationsWithReads(notifications, reads);

  if (options.readFilter === 'read') {
    merged = merged.filter((n) => n.isRead);
  } else if (options.readFilter === 'unread') {
    merged = merged.filter((n) => !n.isRead);
  }

  return merged;
}
