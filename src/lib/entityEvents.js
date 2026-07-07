**
 * Local event bus for immediate UI updates after CRUD operations.
 *
 * The fetch-based Supabase REST client emits here after every INSERT/UPDATE/DELETE.
 * The useRealtimeEntity hook subscribes so the UI reflects local writes instantly,
 * without waiting for the WebSocket realtime push (which can be delayed or missed).
 *
 * Payload format matches Supabase Realtime: { eventType, new, old }
 * Also supports eventType: 'REFRESH' → triggers a full refetch.
 */

const listeners = new Map(); // entityName → Set<callback>

export function onEntityChange(entityName, callback) {
  if (!listeners.has(entityName)) {
    listeners.set(entityName, new Set());
  }
  listeners.get(entityName).add(callback);
  return () => {
    const set = listeners.get(entityName);
    if (set) set.delete(callback);
  };
}

export function emitEntityChange(entityName, payload) {
  const set = listeners.get(entityName);
  if (!set) return;
  set.forEach((cb) => {
    try { cb(payload); } catch (_) { /* prevent one bad callback from breaking others */ }
  });
}
