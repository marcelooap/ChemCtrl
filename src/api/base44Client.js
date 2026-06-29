import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { createSupabaseEntities } from '@/api/supabaseClient';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

// Create the Base44 SDK client (for auth, integrations, analytics, users, agents)
const sdkClient = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});

// Build the Supabase-backed entities (REST API, no WebSocket)
const supabaseEntities = createSupabaseEntities();

// Wrap the SDK client in a Proxy so EVERY access to `.entities` returns our
// Supabase implementation — this works even if the SDK uses a getter or
// internal Proxy on its own entities object.
export const base44 = new Proxy(sdkClient, {
  get(target, prop, receiver) {
    if (prop === 'entities') {
      return supabaseEntities;
    }
    const value = Reflect.get(target, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(target);
    }
    return value;
  },
  set(target, prop, value, receiver) {
    if (prop === 'entities') {
      return true; // swallow — keep our Supabase entities
    }
    return Reflect.set(target, prop, value, receiver);
  }
});
