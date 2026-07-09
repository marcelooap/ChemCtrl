declare const __APP_VERSION__: string;

export interface VersionInfo {
  version: string;
  buildId: string;
  builtAt: string;
}

export function getInstalledVersion(): string {
  if (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) {
    return __APP_VERSION__;
  }
  return import.meta.env.VITE_APP_VERSION || '1.0.0';
}

export async function fetchVersionInfo(): Promise<VersionInfo | null> {
  try {
    const resp = await fetch(`/version.json?_=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!resp.ok) return null;
    return (await resp.json()) as VersionInfo;
  } catch {
    return null;
  }
}

export async function fetchAvailableVersion(): Promise<string | null> {
  const info = await fetchVersionInfo();
  return info?.version ?? null;
}
