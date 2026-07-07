// Self-contained RPC + session client — does NOT import from supabaseClient.js
// (avoids stale Vite module cache issues during migration)

const supabaseUrl = 'https://cpzibnwytukcgxeamfhp.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwemlibnd5dHVrY2d4ZWFtZmhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcyMjksImV4cCI6MjA5NzMzMzIyOX0.28Y66Ba_u1GyQNnDpsdPXLiGHvcn_BkjGOyHsBPSqR0';
const restUrl = `${supabaseUrl}/rest/v1`;

export const getSessionId = () => localStorage.getItem('chemctrl_session_id') || '';
export const setSessionId = (id) => {
  if (id) localStorage.setItem('chemctrl_session_id', id);
  else localStorage.removeItem('chemctrl_session_id');
};
export const clearSessionId = () => localStorage.removeItem('chemctrl_session_id');

const getHeaders = (extra = {}) => {
  const sessionId = getSessionId();
  return {
    'apikey': supabaseAnonKey,
    'Authorization': `Bearer ${supabaseAnonKey}`,
    'Content-Type': 'application/json',
    ...(sessionId ? { 'x-session-id': sessionId } : {}),
    ...extra,
  };
};

export const callRPC = async (functionName, params = {}) => {
  const resp = await fetch(`${restUrl}/rpc/${functionName}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(params),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(text || `HTTP ${resp.status}`);
  }
  const text = await resp.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
};
