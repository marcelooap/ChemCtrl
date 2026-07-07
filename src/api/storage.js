// Storage utilities — fully self-contained (no cross-module imports to avoid Vite cache issues)
const getSessionId = () => localStorage.getItem('chemctrl_session_id') || '';

const supabaseUrl = 'https://cpzibnwytukcgxeamfhp.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwemlibnd5dHVrY2d4ZWFtZmhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcyMjksImV4cCI6MjA5NzMzMzIyOX0.28Y66Ba_u1GyQNnDpsdPXLiGHvcn_BkjGOyHsBPSqR0';

export const uploadFileToSupabase = async (file, bucket = 'fotos-cq') => {
  const ext = (file.name ? file.name.split('.').pop() : null) || 'jpg';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const contentType = file.type && file.type !== '' ? file.type : 'image/jpeg';
  const sessionId = getSessionId();
  const resp = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${fileName}`, {
    method: 'POST',
    headers: {
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'x-upsert': 'true',
      'Content-Type': contentType,
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
    },
    body: file,
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`Upload falhou (${resp.status}): ${errBody}`);
  }
  return `${bucket}/${fileName}`;
};

export const getSignedFileUrl = async (url, expiresIn = 3600) => {
  if (!url) return null;
  let path = url;
  const publicPrefix = `${supabaseUrl}/storage/v1/object/public/`;
  if (path.startsWith(publicPrefix)) path = path.substring(publicPrefix.length);
  const sessionId = getSessionId();
  const resp = await fetch(`${supabaseUrl}/storage/v1/object/sign/${path}`, {
    method: 'POST',
    headers: {
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ expiresIn }),
  });
  if (!resp.ok) {
    return url.startsWith('http') ? url : `${supabaseUrl}/storage/v1/object/public/${path}`;
  }
  const data = await resp.json();
  if (data.signedURL) {
    return data.signedURL.startsWith('http') ? data.signedURL : `${supabaseUrl}/storage/v1${data.signedURL}`;
  }
  return url.startsWith('http') ? url : `${supabaseUrl}/storage/v1/object/public/${path}`;
};
