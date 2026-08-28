import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInternalAuth } from "@/lib/InternalAuthContext";
import {
  isValidacaoNovaCandidata,
  loadUnreadValidacaoIds,
  markValidacaoLida,
  normalizeValidacaoModulo,
  subscribeChemflowTable,
  POLL_INTERVAL_MS,
  MODULO_INDUSTRIALIZACAO,
  MODULO_TRANSBORDO,
} from "@transbordo/lib/validacaoNovas";
import { getChemflowChannelStatus } from "@transbordo/lib/saidaNovas";

const EMPTY_SET = new Set();

const ValidacaoNovasContext = createContext({
  unreadIds: EMPTY_SET,
  count: 0,
  isNew: () => false,
  markAsRead: async () => {},
  validacoesRevision: 0,
});

export function ValidacaoNovasProvider({ children, onlyIndustrializacao = false }) {
  const { user } = useInternalAuth();
  const usuarioId = user?.id ? String(user.id) : "";
  const [unreadIds, setUnreadIds] = useState(EMPTY_SET);
  const [validacoesRevision, setValidacoesRevision] = useState(0);
  const usuarioIdRef = useRef(usuarioId);
  usuarioIdRef.current = usuarioId;
  const channelKey = onlyIndustrializacao ? "ind-val" : "tb-val";
  const modulo = onlyIndustrializacao ? MODULO_INDUSTRIALIZACAO : MODULO_TRANSBORDO;
  const sourceTable = onlyIndustrializacao
    ? "ind_validacoes"
    : "t_transbordo_validacoes";

  const bumpRevision = useCallback(() => {
    setValidacoesRevision((n) => n + 1);
  }, []);

  const refreshUnread = useCallback(async () => {
    const id = usuarioIdRef.current;
    if (!id) {
      setUnreadIds(EMPTY_SET);
      return;
    }
    try {
      const ids = await loadUnreadValidacaoIds(id, modulo);
      setUnreadIds(ids.length ? new Set(ids.map(String)) : EMPTY_SET);
    } catch {
      // Tabela ainda não migrada: não quebra o módulo.
    }
  }, [modulo]);

  useEffect(() => {
    if (!usuarioId) {
      setUnreadIds(EMPTY_SET);
      return undefined;
    }

    refreshUnread();

    const unsubSource = subscribeChemflowTable(
      sourceTable,
      (payload) => {
        const eventType = payload?.eventType;
        bumpRevision();

        if (eventType === "DELETE") {
          const deletedId = payload?.old?.id;
          if (!deletedId) return;
          const key = String(deletedId);
          setUnreadIds((prev) => {
            if (!prev.has(key)) return prev;
            const next = new Set(prev);
            next.delete(key);
            return next.size ? next : EMPTY_SET;
          });
          return;
        }

        const row = payload?.new;
        if (!row?.id) {
          refreshUnread();
          return;
        }
        const key = String(row.id);

        if (eventType === "INSERT") {
          if (isValidacaoNovaCandidata(row)) {
            setUnreadIds((prev) => {
              if (prev.has(key)) return prev;
              const next = new Set(prev);
              next.add(key);
              return next;
            });
          }
          return;
        }

        if (eventType === "UPDATE") {
          if (!isValidacaoNovaCandidata(row)) {
            setUnreadIds((prev) => {
              if (!prev.has(key)) return prev;
              const next = new Set(prev);
              next.delete(key);
              return next.size ? next : EMPTY_SET;
            });
          }
        }
      },
      { channelKey }
    );

    const unsubLeituras = subscribeChemflowTable(
      "t_validacao_leituras",
      (payload) => {
        const row = payload?.new || payload?.old;
        if (!row || String(row.usuario_id || "") !== usuarioIdRef.current) return;
        if (normalizeValidacaoModulo(row.modulo) !== modulo) return;
        const validacaoId = row.validacao_id ? String(row.validacao_id) : "";
        if (!validacaoId) {
          refreshUnread();
          return;
        }
        if (payload?.eventType === "DELETE") {
          refreshUnread();
          return;
        }
        setUnreadIds((prev) => {
          if (!prev.has(validacaoId)) return prev;
          const next = new Set(prev);
          next.delete(validacaoId);
          return next.size ? next : EMPTY_SET;
        });
      },
      { channelKey }
    );

    const poll = setInterval(() => {
      const s1 = getChemflowChannelStatus(`chemflow-saida-novas-${channelKey}-${sourceTable}`);
      const s2 = getChemflowChannelStatus(`chemflow-saida-novas-${channelKey}-t_validacao_leituras`);
      if (s1 === 'connected' && s2 === 'connected') return;
      refreshUnread();
    }, POLL_INTERVAL_MS);

    return () => {
      unsubSource();
      unsubLeituras();
      clearInterval(poll);
    };
  }, [usuarioId, refreshUnread, bumpRevision, modulo, channelKey, sourceTable]);

  const markAsRead = useCallback(
    async (validacaoId) => {
      if (!validacaoId || !usuarioId) return;
      const key = String(validacaoId);
      setUnreadIds((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next.size ? next : EMPTY_SET;
      });
      try {
        await markValidacaoLida(key, usuarioId, modulo);
      } catch {
        refreshUnread();
      }
    },
    [usuarioId, refreshUnread, modulo]
  );

  const isNew = useCallback(
    (validacaoId) => Boolean(validacaoId && unreadIds.has(String(validacaoId))),
    [unreadIds]
  );

  const value = useMemo(
    () => ({
      unreadIds,
      count: unreadIds.size,
      isNew,
      markAsRead,
      validacoesRevision,
    }),
    [unreadIds, isNew, markAsRead, validacoesRevision]
  );

  return (
    <ValidacaoNovasContext.Provider value={value}>
      {children}
    </ValidacaoNovasContext.Provider>
  );
}

export function useValidacaoNovas() {
  return useContext(ValidacaoNovasContext);
}
