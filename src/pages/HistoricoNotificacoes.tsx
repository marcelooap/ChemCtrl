import React, { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Bell, ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useNotifications } from '@/notifications/hooks/useNotifications';
import { NotificationItem } from '@/notifications/components/NotificationItem';
import { fetchNotificationsWithReads } from '@/notifications/api/notificationApi';
import { HISTORY_PAGE_SIZE } from '@/notifications/constants';
import type { NotificationType, NotificationWithRead } from '@/notifications/types';

type ReadFilter = 'all' | 'read' | 'unread';
type TypeFilter = NotificationType | 'all';

export default function HistoricoNotificacoes() {
  const { user } = useOutletContext<{ user: { id: string } }>();
  const { markAllAsRead, navigateToNotification, unreadCount } = useNotifications();

  const [items, setItems] = useState<NotificationWithRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadPage = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const data = await fetchNotificationsWithReads(user.id, {
        limit: HISTORY_PAGE_SIZE,
        offset: page * HISTORY_PAGE_SIZE,
        search: searchDebounced || undefined,
        readFilter,
        typeFilter,
      });
      setItems(data);
      setHasMore(data.length === HISTORY_PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }, [user?.id, page, searchDebounced, readFilter, typeFilter]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  useEffect(() => {
    setPage(0);
  }, [searchDebounced, readFilter, typeFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="w-6 h-6" />
            Histórico de Notificações
          </h1>
          <p className="text-sm text-muted-foreground">
            Todas as notificações do sistema
            {unreadCount > 0 && ` · ${unreadCount} não ${unreadCount === 1 ? 'lida' : 'lidas'}`}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={() => markAllAsRead()}>
            Marcar todas como lidas
          </Button>
        )}
      </div>

      <div className="bg-card rounded-xl border border-border p-4 mb-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por título ou mensagem..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={readFilter} onValueChange={(v) => setReadFilter(v as ReadFilter)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="unread">Não lidas</SelectItem>
              <SelectItem value="read">Lidas</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="success">Sucesso</SelectItem>
              <SelectItem value="warning">Aviso</SelectItem>
              <SelectItem value="error">Erro</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Nenhuma notificação encontrada
          </div>
        ) : (
          <div>
            {items.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onClick={navigateToNotification}
              />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">Página {page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
