/**
 * useRealtimeEntity — hook centralizado de dados em tempo real
 *
 * - Fetch inicial ao montar.
 * - Subscreve Supabase Realtime (WebSocket) via subscribeToTable.
 * - Subscreve event bus local (entityEvents) para updates imediatos do próprio dispositivo.
 * - Aplica INSERTs/UPDATEs/DELETEs diretamente no estado local (sem refetch completo).
 * - Em caso de REFRESH (payload incompleto ou reconexão), faz refetch pontual.
 * - Polling leve (30s) como failsafe final, somente quando realtime está com erro.
 * - Re-dispara fetch quando deps mudam.
 *
 * @param {string}   entityName  - Nome da entidade (ex: 'Production')
 * @param {Function} fetchFn     - () => Promise<Array> — busca os dados
 * @param {Array}    deps        - Dependências que re-triggeram o fetch
 * @param {Function} transform   - Transforma cada registro antes de colocar no estado
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeToTable, getRealtimeStatus } from '@/lib/realtime';
import { onEntityChange } from '@/lib/entityEvents';

const POLL_INTERVAL_MS = 15000; // polling universal — garante sincronização mesmo com WebSocket ativo

export function useRealtimeEntity(entityName, fetchFn, deps = [], transform = (x) => x) {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchFnRef    = useRef(fetchFn);
  fetchFnRef.current  = fetchFn;
  const transformRef  = useRef(transform);
  transformRef.current = transform;

  // ── fetch completo ──────────────────────────────────────────────────────────
  const reload = useCallback(() => {
    setLoading(true);
    return fetchFnRef.current()
      .then((result) => setData((result || []).map(transformRef.current)))
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // ── fetch silencioso (sem loading=true) — usado pelo REFRESH ───────────────
  const silentReload = useCallback(() => {
    return fetchFnRef.current()
      .then((result) => setData((result || []).map(transformRef.current)))
      .catch(() => {});
  }, []); // intencionalmente sem deps — sempre usa ref atual

  // ── handler incremental de eventos ─────────────────────────────────────────
  const handleChange = useCallback((payload) => {
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
          // Evita duplicata
          if (prev.some((item) => item.id === record.id)) {
            // Atualiza se já existia (pode ter chegado pelo event bus local antes do WS)
            return prev.map((item) => item.id === record.id ? { ...item, ...record } : item);
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

  // ── efeito principal ────────────────────────────────────────────────────────
  useEffect(() => {
    reload();

    // Supabase WebSocket (eventos de outros dispositivos/sessões)
    const unsubWS    = subscribeToTable(entityName, handleChange);
    // Event bus local (eventos do próprio dispositivo — feedback imediato)
    const unsubLocal = onEntityChange(entityName, handleChange);

    // Polling universal — sincroniza mesmo que o WebSocket esteja ativo mas com eventos perdidos
    const pollTimer = setInterval(() => {
      silentReload();
    }, POLL_INTERVAL_MS);

    return () => {
      unsubWS();
      unsubLocal();
      clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityName, reload]);

  return { data, loading, reload, setData };
}
