import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/components/ui/use-toast';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { subscribeToTable } from '@/lib/realtime';
import {
  fetchNotificationsWithReads,
  getUnreadCountRpc,
  markAllNotificationsReadRpc,
  markNotificationReadRpc,
} from '../api/notificationApi';
import { DROPDOWN_LIMIT } from '../constants';
import { notifTrace } from '../trace';
import type { NotificationWithRead } from '../types';

export interface NotificationContextValue {
  notifications: NotificationWithRead[];
  unreadCount: number;
  loading: boolean;
  /** Incrementa quando chega notificação nova — usado para animar o sino */
  pulseToken: number;
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
  const [pulseToken, setPulseToken] = useState(0);
  const userIdRef = useRef<string | null>(null);
  const pendingReadIdsRef = useRef<Set<string>>(new Set());
  const knownIdsRef = useRef<Set<string>>(new Set());
  const initialLoadDoneRef = useRef(false);
  const reloadInFlightRef = useRef(false);

  const userId = user?.id ?? null;
  userIdRef.current = userId;

  const applyLoadedData = useCallback(
    (items: NotificationWithRead[], count: number, source: string) => {
      const prevKnown = knownIdsRef.current;
      const nextKnown = new Set(items.map((n) => n.id));

      if (initialLoadDoneRef.current && source === 'realtime-signal') {
        const newestUnread = items.find((n) => !n.isRead && !prevKnown.has(n.id));
        if (newestUnread) {
          notifTrace('Lista atualizada com notificação nova', {
            id: newestUnread.id,
            title: newestUnread.title,
            event: newestUnread.event,
          });
          setPulseToken((t) => t + 1);
          toast({
            title: newestUnread.title,
            description: newestUnread.message,
            duration: 3000,
          });
          notifTrace('Popup (toast) exibido');
          notifTrace('Badge atualizado');
        }
      }

      knownIdsRef.current = nextKnown;
      setNotifications(items);
      setUnreadCount(count);
      notifTrace(`Estado aplicado (${source})`, {
        count: items.length,
        unread: count,
      });
    },
    []
  );

  const loadData = useCallback(
    async (source = 'manual') => {
      if (!userId) {
        setNotifications([]);
        setUnreadCount(0);
        setLoading(false);
        knownIdsRef.current = new Set();
        initialLoadDoneRef.current = false;
        return;
      }

      if (reloadInFlightRef.current && source === 'realtime-signal') {
        notifTrace('Reload já em andamento — sinal enfileirado como no-op debounce');
      }
      reloadInFlightRef.current = true;

      try {
        notifTrace(`Carregando notificações (${source})…`, { userId });
        const [items, count] = await Promise.all([
          fetchNotificationsWithReads(userId, { limit: DROPDOWN_LIMIT }),
          getUnreadCountRpc(),
        ]);
        applyLoadedData(items, count, source);
        initialLoadDoneRef.current = true;
      } catch (err) {
        console.error('[NotificationProvider] Erro ao carregar notificações:', err);
        notifTrace('Falha ao carregar', err);
      } finally {
        reloadInFlightRef.current = false;
        setLoading(false);
      }
    },
    [userId, applyLoadedData]
  );

  useEffect(() => {
    setLoading(true);
    initialLoadDoneRef.current = false;
    loadData('mount');
  }, [loadData]);

  useEffect(() => {
    if (!userId) return;

    notifTrace('Subscrevendo NotificationSignal (Realtime invalidate-and-fetch)');

    const handleSignal = (payload: { eventType: string; new?: { notification_id?: string } }) => {
      const { eventType, new: row } = payload;

      if (eventType === 'INSERT') {
        notifTrace('Realtime sinal recebido (INSERT)', {
          notification_id: row?.notification_id ?? null,
        });
        loadData('realtime-signal');
        return;
      }

      if (eventType === 'REFRESH') {
        notifTrace('Realtime sinal REFRESH — revalidando via REST');
        loadData('realtime-refresh');
      }
    };

    const unsubSignal = subscribeToTable('NotificationSignal', handleSignal);

    return () => {
      notifTrace('Cleanup subscription NotificationSignal');
      unsubSignal();
    };
  }, [userId, loadData]);

  const markAsRead = useCallback(
    async (id: string) => {
      const target = notifications.find((n) => n.id === id);
      if (!target || target.isRead) return;

      pendingReadIdsRef.current.add(id);
      notifTrace('Marcando como lida (otimista)', { id });

      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, isRead: true, read_at: new Date().toISOString() } : n
        )
      );
      setUnreadCount((c) => Math.max(0, c - 1));

      try {
        const result = await markNotificationReadRpc(id);
        if (!result?.success) {
          console.error('[NotificationProvider] mark_notification_read falhou:', result);
          pendingReadIdsRef.current.delete(id);
          await loadData('mark-read-rollback');
          return;
        }
        pendingReadIdsRef.current.delete(id);
        notifTrace('Marcar como lida OK', { id });
      } catch (err) {
        console.error('[NotificationProvider] Erro ao marcar como lida:', err);
        pendingReadIdsRef.current.delete(id);
        await loadData('mark-read-error');
      }
    },
    [notifications, loadData]
  );

  const markAllAsRead = useCallback(async () => {
    notifTrace('Marcando todas como lidas');
    setNotifications((prev) =>
      prev.map((n) => ({
        ...n,
        isRead: true,
        read_at: n.read_at || new Date().toISOString(),
      }))
    );
    setUnreadCount(0);

    try {
      const result = await markAllNotificationsReadRpc();
      if (!result?.success) {
        console.error('[NotificationProvider] mark_all_notifications_read falhou:', result);
        await loadData('mark-all-rollback');
        return;
      }
      notifTrace('Marcar todas OK', result);
    } catch (err) {
      console.error('[NotificationProvider] Erro ao marcar todas como lidas:', err);
      await loadData('mark-all-error');
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
      pulseToken,
      markAsRead,
      markAllAsRead,
      navigateToNotification,
      reload: () => loadData('manual'),
    }),
    [
      notifications,
      unreadCount,
      loading,
      pulseToken,
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
