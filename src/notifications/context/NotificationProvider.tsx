import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { subscribeToTable } from '@/lib/realtime';
import {
  fetchNotificationsWithReads,
  getUnreadCountRpc,
  markAllNotificationsReadRpc,
  markNotificationReadRpc,
  mergeNotificationsWithReads,
} from '../api/notificationApi';
import { DROPDOWN_LIMIT } from '../constants';
import type { NotificationWithRead } from '../types';

export interface NotificationContextValue {
  notifications: NotificationWithRead[];
  unreadCount: number;
  loading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  navigateToNotification: (notification: NotificationWithRead) => Promise<void>;
  reload: () => Promise<void>;
}

export const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useInternalAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationWithRead[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null>(null);
  const pendingReadIdsRef = useRef<Set<string>>(new Set());

  const userId = user?.id ?? null;
  userIdRef.current = userId;

  const loadData = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    try {
      const [items, count] = await Promise.all([
        fetchNotificationsWithReads(userId, { limit: DROPDOWN_LIMIT }),
        getUnreadCountRpc(),
      ]);
      setNotifications(items);
      setUnreadCount(count);
    } catch (err) {
      console.warn('[NotificationProvider] Erro ao carregar notificações:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!userId) return;

    const handleNotificationChange = (payload: {
      eventType: string;
      new?: NotificationWithRead;
    }) => {
      const { eventType, new: newRecord } = payload;

      if (eventType === 'REFRESH') {
        loadData();
        return;
      }

      if (eventType === 'INSERT' && newRecord?.id) {
        setNotifications((prev) => {
          const merged = mergeNotificationsWithReads(
            [newRecord as NotificationWithRead, ...prev.map(({ isRead, read_at, ...n }) => n)],
            prev.filter((p) => p.isRead).map((p) => ({
              id: '',
              notification_id: p.id,
              user_id: userId,
              read_at: p.read_at || new Date().toISOString(),
            }))
          );
          return merged.slice(0, DROPDOWN_LIMIT);
        });
        setUnreadCount((c) => c + 1);
      }
    };

    const handleReadChange = (payload: {
      eventType: string;
      new?: { notification_id: string; user_id: string; read_at: string };
    }) => {
      const { eventType, new: newRecord } = payload;

      if (eventType === 'REFRESH') {
        loadData();
        return;
      }

      if (
        eventType === 'INSERT' &&
        newRecord?.notification_id &&
        newRecord.user_id === userIdRef.current
      ) {
        const wasPending = pendingReadIdsRef.current.has(newRecord.notification_id);
        if (wasPending) {
          pendingReadIdsRef.current.delete(newRecord.notification_id);
        }

        setNotifications((prev) =>
          prev.map((n) =>
            n.id === newRecord.notification_id
              ? { ...n, isRead: true, read_at: newRecord.read_at }
              : n
          )
        );

        if (!wasPending) {
          setUnreadCount((c) => Math.max(0, c - 1));
        }
      }
    };

    const unsubNotif = subscribeToTable('Notification', handleNotificationChange);
    const unsubReads = subscribeToTable('NotificationRead', handleReadChange);

    return () => {
      unsubNotif();
      unsubReads();
    };
  }, [userId, loadData]);

  const markAsRead = useCallback(
    async (id: string) => {
      const target = notifications.find((n) => n.id === id);
      if (!target || target.isRead) return;

      pendingReadIdsRef.current.add(id);

      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, isRead: true, read_at: new Date().toISOString() } : n
        )
      );
      setUnreadCount((c) => Math.max(0, c - 1));

      try {
        await markNotificationReadRpc(id);
      } catch {
        pendingReadIdsRef.current.delete(id);
        loadData();
      }
    },
    [notifications, loadData]
  );

  const markAllAsRead = useCallback(async () => {
    setNotifications((prev) =>
      prev.map((n) => ({
        ...n,
        isRead: true,
        read_at: n.read_at || new Date().toISOString(),
      }))
    );
    setUnreadCount(0);

    try {
      await markAllNotificationsReadRpc();
    } catch {
      loadData();
    }
  }, [loadData]);

  const navigateToNotification = useCallback(
    async (notification: NotificationWithRead) => {
      await markAsRead(notification.id);

      let url = notification.action_url;
      if (user?.tipo === 'externo' && notification.entity_id) {
        url = `/tela-clientes?prod=${notification.entity_id}`;
      }

      if (url) {
        navigate(url);
      }
    },
    [markAsRead, navigate, user?.tipo]
  );

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      markAsRead,
      markAllAsRead,
      navigateToNotification,
      reload: loadData,
    }),
    [
      notifications,
      unreadCount,
      loading,
      markAsRead,
      markAllAsRead,
      navigateToNotification,
      loadData,
    ]
  );

  return (
    <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
  );
}
