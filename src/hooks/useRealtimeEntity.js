/**
 * React hook that provides real-time entity data with polling fallback.
 *
 * Usage (replaces useState + useEffect + load pattern):
 *
 *   const { data: productions, loading, reload: load, setData: setProductions } =
 *     useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 200));
 *
 * - On mount: fetches initial data.
 * - Subscribes to Supabase Realtime for INSERT/UPDATE/DELETE on the entity's table.
 * - Applies incremental updates to state (no full page reload).
 * - Falls back to polling every 10s if realtime is not connected.
 * - Preserves all other UI state (filters, dialogs, etc.) — only the data array updates.
 * - Optional `transform` function is applied to every record (initial fetch + realtime)
 *   — use it to parse JSON string fields (e.g. parseArr(r.raw_materials)).
 *
 * @param {string} entityName  - Entity name (e.g. 'Production')
 * @param {() => Promise<Array>} fetchFn - Function that returns the full data array (raw)
 * @param {Array} deps - Dependencies that should trigger a refetch
 * @param {(record: object) => object} transform - Optional transform applied to each record
 * @returns {{ data: Array, loading: boolean, reload: Function, setData: Function }}
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeToTable, getRealtimeStatus } from '@/lib/realtime';
import { onEntityChange } from '@/lib/entityEvents';

const POLL_INTERVAL = 10000; // 10 seconds

export function useRealtimeEntity(entityName, fetchFn, deps = [], transform = (x) => x) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;
  const transformRef = useRef(transform);
  transformRef.current = transform;

  const reload = useCallback(() => {
    setLoading(true);
    return fetchFnRef
      .current()
      .then((result) => { setData((result || []).map(transformRef.current)); })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    // Initial load
    reload();

    // Shared handler for both WebSocket realtime events and local CRUD events.
    const handleChange = (payload) => {
      const { eventType, new: newRecord, old: oldRecord } = payload;

      // REFRESH — full refetch (used by updateMany/deleteMany without full records)
      if (eventType === 'REFRESH') {
        fetchFnRef
          .current()
          .then((result) => { setData((result || []).map(transformRef.current)); })
          .catch(() => {});
        return;
      }

      setData((prev) => {
        if (eventType === 'INSERT') {
          if (!newRecord) return prev;
          const record = transformRef.current(newRecord);
          if (prev.some((item) => item.id === record.id)) return prev;
          return [...prev, record];
        }
        if (eventType === 'UPDATE') {
          if (!newRecord) return prev;
          const record = transformRef.current(newRecord);
          const idx = prev.findIndex((item) => item.id === record.id);
          if (idx === -1) return [...prev, record]; // record not loaded yet → add it
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...record };
          return updated;
        }
        if (eventType === 'DELETE') {
          const id = oldRecord?.id;
          if (!id) return prev;
          return prev.filter((item) => item.id !== id);
        }
        return prev;
      });
    };

    // WebSocket realtime subscription (for changes from other clients/sessions)
    const unsubRealtime = subscribeToTable(entityName, handleChange);

    // Local event bus subscription (for immediate UI updates after local writes)
    const unsubLocal = onEntityChange(entityName, handleChange);

    // Polling fallback — only polls when realtime is NOT connected
    const pollInterval = setInterval(() => {
      if (getRealtimeStatus(entityName) !== 'connected') {
        fetchFnRef
          .current()
          .then((result) => { setData((result || []).map(transformRef.current)); })
          .catch(() => {});
      }
    }, POLL_INTERVAL);

    return () => {
      unsubRealtime();
      unsubLocal();
      clearInterval(pollInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityName]);

  return { data, loading, reload, setData };
}
