import type { UpdateAvailableCallback } from './types';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const RELOAD_FALLBACK_MS = 1500;
const CACHE_CLEAR_TIMEOUT_MS = 1500;

let registration: ServiceWorkerRegistration | null = null;
let updateNotified = false;
let isFirstActivation = !navigator.serviceWorker?.controller;
let reloadScheduled = false;
const listeners = new Set<UpdateAvailableCallback>();

function notifyUpdate() {
  if (updateNotified) return;
  updateNotified = true;
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignore */
    }
  });
  window.dispatchEvent(new CustomEvent('pwa-update-available'));
}

function watchInstalling(worker: ServiceWorker) {
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      notifyUpdate();
    }
    if (worker.state === 'activated' && !navigator.serviceWorker.controller) {
      isFirstActivation = false;
    }
  });
}

function checkForUpdate() {
  registration?.update().catch(() => {});
}

function forceReload() {
  if (reloadScheduled) return;
  reloadScheduled = true;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('_sw', String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

async function clearCachesWithTimeout(): Promise<void> {
  const clear = (async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  })();

  await Promise.race([
    clear.catch(() => {}),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, CACHE_CLEAR_TIMEOUT_MS);
    }),
  ]);
}

async function resolveWaitingWorker(): Promise<ServiceWorker | null> {
  try {
    const reg =
      registration ||
      (await navigator.serviceWorker.getRegistration()) ||
      null;
    if (reg) {
      registration = reg;
      if (reg.waiting) return reg.waiting;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function onUpdateAvailable(callback: UpdateAvailableCallback): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function initServiceWorkerManager(): () => void {
  if (!('serviceWorker' in navigator)) {
    return () => {};
  }

  // Em desenvolvimento o SW interfere com HMR e imports dinâmicos do Vite
  // (ex.: lazy load de /chemflow). Só registra em build de produção.
  if (import.meta.env.DEV) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        regs.forEach((reg) => reg.unregister().catch(() => {}));
      })
      .catch(() => {});
    return () => {};
  }

  const onControllerChange = () => {
    if (isFirstActivation) {
      isFirstActivation = false;
      return;
    }
    forceReload();
  };

  const onMessage = (event: MessageEvent) => {
    if (event.data?.type === 'SW_UPDATE_AVAILABLE') {
      notifyUpdate();
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      checkForUpdate();
    }
  };

  const onOnline = () => {
    checkForUpdate();
  };

  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
  navigator.serviceWorker.addEventListener('message', onMessage);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', onOnline);

  navigator.serviceWorker
    .register('/sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      registration = reg;

      if (reg.waiting && navigator.serviceWorker.controller) {
        notifyUpdate();
      }

      reg.addEventListener('updatefound', () => {
        if (reg.installing) {
          watchInstalling(reg.installing);
        }
      });

      checkForUpdate();
    })
    .catch(() => {});

  const pollTimer = window.setInterval(checkForUpdate, POLL_INTERVAL_MS);

  return () => {
    clearInterval(pollTimer);
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    navigator.serviceWorker.removeEventListener('message', onMessage);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', onOnline);
    listeners.clear();
  };
}

export async function applyServiceWorkerUpdate(): Promise<void> {
  // Sempre agenda reload — evita ficar preso em "Atualizando..." se o SW travar
  window.setTimeout(forceReload, RELOAD_FALLBACK_MS);

  // Limpa caches sem bloquear a ativação do novo SW
  void clearCachesWithTimeout();

  const waiting = await resolveWaitingWorker();
  if (waiting) {
    try {
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      forceReload();
    }
    return;
  }

  forceReload();
}

export function getRegistration(): ServiceWorkerRegistration | null {
  return registration;
}
