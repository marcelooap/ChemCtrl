/**
 * RealtimeProvider — pré-subscreve canais Supabase Realtime ao autenticar.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeAllTables, getRealtimeStatus } from '@/lib/realtime';
import { entityTableMap } from '@/api/supabaseClient';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';

const IS_DEV = import.meta.env.DEV;
const SKIP_REALTIME = new Set(['Perfil', 'PerfilPermissao']);
const REALTIME_ENTITIES = Object.keys(entityTableMap).filter((k) => !SKIP_REALTIME.has(k));

export default function RealtimeProvider({ children }) {
  const { t } = useTranslation();
  const { user } = useInternalAuth();
  const [statusMap, setStatusMap] = useState({});

  useEffect(() => {
    if (!user) {
      setStatusMap({});
      return undefined;
    }

    const statusTimer = setInterval(() => {
      const map = {};
      REALTIME_ENTITIES.forEach((entityName) => {
        map[entityName] = getRealtimeStatus(entityName);
      });
      setStatusMap(map);
    }, 2000);

    const unsubAll = subscribeAllTables();

    return () => {
      clearInterval(statusTimer);
      unsubAll();
      setStatusMap({});
    };
  }, [!!user]);

  const statuses = Object.values(statusMap);
  const hasError = statuses.some((s) => s === 'error');
  const allConnected = statuses.length > 0 && statuses.every((s) => s === 'connected');
  // Só mostra badge com usuário autenticado e após receber status dos canais
  const showBadge = Boolean(user) && statuses.length > 0 && (IS_DEV || hasError);

  const badgeTitle = hasError
    ? t('realtime.disconnected')
    : allConnected
      ? t('realtime.connected')
      : t('realtime.connecting');
  const badgeLabel = hasError
    ? t('realtime.disconnected')
    : allConnected
      ? t('realtime.live')
      : t('realtime.connecting');

  return (
    <>
      {children}
      {showBadge && (
        <div
          className="fixed bottom-3 left-3 z-50 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shadow-lg select-none"
          style={{
            background: hasError ? '#fef2f2' : allConnected ? '#f0fdf4' : '#fefce8',
            color: hasError ? '#991b1b' : allConnected ? '#166534' : '#92400e',
            border: `1px solid ${hasError ? '#fecaca' : allConnected ? '#bbf7d0' : '#fde68a'}`,
          }}
          title={badgeTitle}
        >
          {hasError ? (
            <WifiOff className="w-3 h-3" />
          ) : allConnected ? (
            <Wifi className="w-3 h-3" />
          ) : (
            <Loader2 className="w-3 h-3 animate-spin" />
          )}
          {badgeLabel}
        </div>
      )}
    </>
  );
}
