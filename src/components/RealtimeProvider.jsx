/**
 * RealtimeProvider — pré-subscreve todos os canais Supabase Realtime ao iniciar.
 * 
 * Ao montar na raiz do app, abre WebSocket para todas as tabelas imediatamente.
 * Isso elimina a latência de setup que ocorreria se cada tela abrisse seu próprio
 * canal apenas quando o usuário navega até ela.
 * 
 * Também exibe um pequeno badge de status no canto inferior esquerdo (apenas em dev,
 * ou quando há erro de conexão em produção).
 */
import { useEffect, useState } from 'react';
import { subscribeAllTables, getRealtimeStatus } from '@/lib/realtime';
import { entityTableMap } from '@/api/supabaseClient';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';

const IS_DEV = import.meta.env.DEV;

export default function RealtimeProvider({ children }) {
  const { user } = useInternalAuth();
  const [statusMap, setStatusMap] = useState({});

  useEffect(() => {
    // Aguarda autenticação antes de abrir WebSocket (RLS exige sessão válida)
    if (!user) return;

    // Monitora status de todos os canais a cada 2s
    const statusTimer = setInterval(() => {
      const map = {};
      Object.keys(entityTableMap).forEach((entityName) => {
        map[entityName] = getRealtimeStatus(entityName);
      });
      setStatusMap(map);
    }, 2000);

    // Pré-abre todos os canais WebSocket (com header de sessão)
    const unsubAll = subscribeAllTables();

    return () => {
      clearInterval(statusTimer);
      unsubAll();
    };
  }, [!!user]);

  // Calcula status global
  const statuses = Object.values(statusMap);
  const hasError = statuses.some((s) => s === 'error');
  const allConnected = statuses.length > 0 && statuses.every((s) => s === 'connected');
  const isConnecting = !allConnected && !hasError;

  // Mostra badge apenas em dev ou quando há erro
  const showBadge = IS_DEV || hasError;

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
          title={hasError ? 'Realtime desconectado — reconectando…' : allConnected ? 'Realtime conectado' : 'Conectando ao Realtime…'}
        >
          {hasError ? (
            <WifiOff className="w-3 h-3" />
          ) : allConnected ? (
            <Wifi className="w-3 h-3" />
          ) : (
            <Loader2 className="w-3 h-3 animate-spin" />
          )}
          {hasError ? 'Reconectando…' : allConnected ? 'Tempo real' : 'Conectando…'}
        </div>
      )}
    </>
  );
}
