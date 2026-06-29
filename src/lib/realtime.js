/**
 * Supabase Realtime subscription manager for ChemCtrl.
 *
 * - Uses @supabase/supabase-js WebSocket client for realtime events.
 * - Deduplicates channels per table (multiple components share one channel).
 * - Tracks subscription status so the hook can fall back to polling.
 * - Exposes a simple subscribeToTable(entityName, callback) → unsubscribe.
 */
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseAnonKey, entityTableMap } from '@/api/supabaseClient';

let supabaseClient = null;

function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 10 } },
      auth: { persistSession: false },
    });
  }
  return supabaseClient;
}

// tableName → Set<callback>
const tableCallbacks = new Map();
// tableName → channel
const tableChannels = new Map();
// tableName → 'connecting' | 'connected' | 'error'
const tableStatus = new Map();

/**
 * Returns the current realtime connection status for an entity.
 */
export function getRealtimeStatus(entityName) {
  const tableName = entityTableMap[entityName];
  return tableName ? tableStatus.get(tableName) || 'disconnected' : 'disconnected';
}

/**
 * Subscribe to all INSERT/UPDATE/DELETE events on the given entity's table.
 * Multiple components subscribing to the same table share a single WebSocket channel.
 *
 * @param {string} entityName - e.g. 'Production', 'Tank'
 * @param {(payload: { eventType: string, new: object, old: object }) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function subscribeToTable(entityName, callback) {
  const tableName = entityTableMap[entityName];
  if (!tableName) return () => {};

  const supabase = getSupabase();

  // Register callback
  if (!tableCallbacks.has(tableName)) {
    tableCallbacks.set(tableName, new Set());
  }
  tableCallbacks.get(tableName).add(callback);

  // Create channel if this is the first subscriber
  if (!tableChannels.has(tableName)) {
    tableStatus.set(tableName, 'connecting');
    const channelName = `realtime-${tableName}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tableName },
        (payload) => {
          const callbacks = tableCallbacks.get(tableName);
          if (callbacks) {
            callbacks.forEach((cb) => {
              try { cb(payload); } catch (_) { /* prevent one bad callback from breaking others */ }
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          tableStatus.set(tableName, 'connected');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          tableStatus.set(tableName, 'error');
        }
      });
    tableChannels.set(tableName, channel);
  }

  // Unsubscribe: remove callback, and tear down channel if no more subscribers
  return () => {
    const callbacks = tableCallbacks.get(tableName);
    if (!callbacks) return;
    callbacks.delete(callback);
    if (callbacks.size === 0) {
      const channel = tableChannels.get(tableName);
      if (channel) {
        getSupabase().removeChannel(channel);
      }
      tableChannels.delete(tableName);
      tableCallbacks.delete(tableName);
      tableStatus.delete(tableName);
    }
  };
}
