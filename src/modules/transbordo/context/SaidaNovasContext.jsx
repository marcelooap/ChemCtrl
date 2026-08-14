import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { isSaidaModuloPainel, ORIGEM_INDUSTRIALIZACAO, ORIGEM_TRANSBORDO } from '@transbordo/lib/saidaOrigem';
import {
  isSaidaNovaCandidata,
  loadUnreadSaidaIds,
  markSaidaLida,
  normalizeSaidaModulo,
  subscribeChemflowTable,
  POLL_INTERVAL_MS,
} from '@transbordo/lib/saidaNovas';

const EMPTY_SET = new Set();

const SaidaNovasContext = createContext({
  unreadIds: EMPTY_SET,
  count: 0,
  isNew: () => false,
  markAsRead: async () => {},
  saidasRevision: 0,
});

export function SaidaNovasProvider({ children, onlyIndustrializacao = false }) {
  const { user } = useInternalAuth();
  const usuarioId = user?.id ? String(user.id) : '';
  const [unreadIds, setUnreadIds] = useState(EMPTY_SET);
  const [saidasRevision, setSaidasRevision] = useState(0);
  const usuarioIdRef = useRef(usuarioId);
  usuarioIdRef.current = usuarioId;
  const channelKey = onlyIndustrializacao ? 'ind' : 'tb';
  const modulo = onlyIndustrializacao ? ORIGEM_INDUSTRIALIZACAO : ORIGEM_TRANSBORDO;

  const bumpSaidasRevision = useCallback(() => {
    setSaidasRevision((n) => n + 1);
  }, []);

  const refreshUnread = useCallback(async () => {
    const id = usuarioIdRef.current;
    if (!id) {
      setUnreadIds(EMPTY_SET);
      return;
    }
    try {
      const ids = await loadUnreadSaidaIds(id, { modulo });
      setUnreadIds(ids.length ? new Set(ids) : EMPTY_SET);
    } catch {
      // Tabela ainda não migrada ou falha de rede: não quebra o módulo.
    }
  }, [modulo]);

  useEffect(() => {
    if (!usuarioId) {
      setUnreadIds(EMPTY_SET);
      return undefined;
    }

    refreshUnread();

    const unsubSaidas = subscribeChemflowTable(
      't_saidas',
      (payload) => {
        const eventType = payload?.eventType;
        bumpSaidasRevision();

        if (eventType === 'DELETE') {
          const deletedId = payload?.old?.id;
          if (!deletedId) return;
          setUnreadIds((prev) => {
            if (!prev.has(deletedId)) return prev;
            const next = new Set(prev);
            next.delete(deletedId);
            return next.size ? next : EMPTY_SET;
          });
          return;
        }

        const row = payload?.new;
        if (!row?.id) {
          refreshUnread();
          return;
        }

        if (eventType === 'INSERT') {
          if (modulo === ORIGEM_INDUSTRIALIZACAO && !Array.isArray(row.itens)) {
            refreshUnread();
            return;
          }
          if (isSaidaNovaCandidata(row, { modulo })) {
            setUnreadIds((prev) => {
              if (prev.has(row.id)) return prev;
              const next = new Set(prev);
              next.add(row.id);
              return next;
            });
          }
          return;
        }

        if (eventType === 'UPDATE') {
          if (!isSaidaModuloPainel(row)) {
            setUnreadIds((prev) => {
              if (!prev.has(row.id)) return prev;
              const next = new Set(prev);
              next.delete(row.id);
              return next.size ? next : EMPTY_SET;
            });
            return;
          }
          if (modulo === ORIGEM_INDUSTRIALIZACAO && !Array.isArray(row.itens)) return;
          if (!isSaidaNovaCandidata(row, { modulo })) {
            setUnreadIds((prev) => {
              if (!prev.has(row.id)) return prev;
              const next = new Set(prev);
              next.delete(row.id);
              return next.size ? next : EMPTY_SET;
            });
          }
        }
      },
      { channelKey }
    );

    const unsubLeituras = subscribeChemflowTable(
      't_saida_leituras',
      (payload) => {
        const row = payload?.new || payload?.old;
        if (!row || String(row.usuario_id || '') !== usuarioIdRef.current) return;
        if (normalizeSaidaModulo(row.modulo) !== modulo) return;
        const saidaId = row.saida_id;
        if (!saidaId) {
          refreshUnread();
          return;
        }
        if (payload?.eventType === 'DELETE') {
          refreshUnread();
          return;
        }
        setUnreadIds((prev) => {
          if (!prev.has(saidaId)) return prev;
          const next = new Set(prev);
          next.delete(saidaId);
          return next.size ? next : EMPTY_SET;
        });
      },
      { channelKey }
    );

    const poll = setInterval(refreshUnread, POLL_INTERVAL_MS);

    return () => {
      unsubSaidas();
      unsubLeituras();
      clearInterval(poll);
    };
  }, [usuarioId, refreshUnread, bumpSaidasRevision, modulo, channelKey]);

  const markAsRead = useCallback(
    async (saidaId) => {
      if (!saidaId || !usuarioId) return;
      setUnreadIds((prev) => {
        if (!prev.has(saidaId)) return prev;
        const next = new Set(prev);
        next.delete(saidaId);
        return next.size ? next : EMPTY_SET;
      });
      try {
        await markSaidaLida(saidaId, usuarioId, modulo);
      } catch {
        refreshUnread();
      }
    },
    [usuarioId, refreshUnread, modulo]
  );

  const isNew = useCallback(
    (saidaId) => Boolean(saidaId && unreadIds.has(saidaId)),
    [unreadIds]
  );

  const value = useMemo(
    () => ({
      unreadIds,
      count: unreadIds.size,
      isNew,
      markAsRead,
      saidasRevision,
    }),
    [unreadIds, isNew, markAsRead, saidasRevision]
  );

  return (
    <SaidaNovasContext.Provider value={value}>{children}</SaidaNovasContext.Provider>
  );
}

export function useSaidaNovas() {
  return useContext(SaidaNovasContext);
}
