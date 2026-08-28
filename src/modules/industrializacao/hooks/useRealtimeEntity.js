/**
 * useRealtimeEntity — hook centralizado de dados em tempo real
 *
 * - Fetch inicial ao montar (com AbortController + guarda de montagem).
 * - Subscreve Supabase Realtime (WebSocket) via subscribeToTable.
 * - Subscreve event bus local (entityEvents) para updates imediatos do próprio dispositivo.
 * - Aplica INSERTs/UPDATEs/DELETEs diretamente no estado local (sem refetch completo).
 * - Em caso de REFRESH (payload incompleto ou reconexão), faz refetch pontual.
 * - Polling leve (30s) como failsafe final, somente quando realtime está com erro/desconectado.
 * - Re-dispara fetch quando deps mudam.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeToTable, getRealtimeStatus } from '@industrializacao/lib/realtime';
import { onEntityChange } from '@industrializacao/lib/entityEvents';

const POLL_INTERVAL_MS = 30000;
const HEALTHY_STATUS = 'connected';

export function useRealtimeEntity(entityName, fetchFn, deps = [], transform = (x) => x) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const inFlightRef = useRef(null);
  const mountedRef = useRef(true);
  const abortRef = useRef(null);

  const reload = useCallback(() => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* ignore */ }
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortRef.current = controller;

    if (mountedRef.current) setLoading(true);
    return fetchFnRef.current({ signal: controller?.signal })
      .then((result) => {
        if (!mountedRef.current || controller?.signal?.aborted) return;
        setData((result || []).map(transformRef.current));
        setError(null);
      })
      .catch((err) => {
        if (!mountedRef.current || err?.name === 'AbortError' || controller?.signal?.aborted) return;
        setError(err);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const silentReload = useCallback(() => {
    if (inFlightRef.current) return inFlightRef.current;
    const request = fetchFnRef.current()
      .then((result) => {
        if (!mountedRef.current) return;
        setData((result || []).map(transformRef.current));
        setError(null);
      })
      .catch((err) => {
        if (!mountedRef.current || err?.name === 'AbortError') return;
        setError(err);
      })
      .finally(() => { inFlightRef.current = null; });
    inFlightRef.current = request;
    return request;
  }, []);

  const handleChange = useCallback((payload) => {
    if (!mountedRef.current) return;
    const { eventType, new: newRecord, old: oldRecord } = payload;

    if (eventType === 'REFRESH') {
      silentReload();
      return;
    }

    setData((prev) => {
      switch (eventType) {
        case 'INSERT': {
          if (!newRecord?.id) return prev;
          const record = transformRef.current(newRecord);
          if (prev.some((item) => item.id === record.id)) {
            return prev.map((item) => (item.id === record.id ? { ...item, ...record } : item));
          }
          return [record, ...prev];
        }
        case 'UPDATE': {
          if (!newRecord?.id) return prev;
          const record = transformRef.current(newRecord);
          const idx = prev.findIndex((item) => item.id === record.id);
          if (idx === -1) return [record, ...prev];
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...record };
          return updated;
        }
        case 'DELETE': {
          const id = oldRecord?.id;
          if (!id) return prev;
          return prev.filter((item) => item.id !== id);
        }
        default:
          return prev;
      }
    });
  }, [silentReload]);

  useEffect(() => {
    mountedRef.current = true;
    reload();

    const unsubWS = subscribeToTable(entityName, handleChange);
    const unsubLocal = onEntityChange(entityName, handleChange);

    const pollTimer = setInterval(() => {
      if (!mountedRef.current) return;
      if (getRealtimeStatus(entityName) === HEALTHY_STATUS) return;
      silentReload();
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      unsubWS();
      unsubLocal();
      clearInterval(pollTimer);
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch { /* ignore */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityName, reload]);

  return { data, loading, error, reload, setData };
}
