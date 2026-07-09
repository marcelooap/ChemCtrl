import type { UpdateAvailableCallback } from './types';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const RELOAD_FALLBACK_MS = 3000;

let registration: ServiceWorkerRegistration | null = null;
let updateNotified = false;
let isFirstActivation = !navigator.serviceWorker?.controller;
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

export function onUpdateAvailable(callback: UpdateAvailableCallback): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function initServiceWorkerManager(): () => void {
  if (!('serviceWorker' in navigator)) {
    return () => {};
  }

  const onControllerChange = () => {
    if (isFirstActivation) {
      isFirstActivation = false;
      return;
    }
    window.location.reload();
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
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* ignore */
  }

  if (registration?.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    window.setTimeout(() => window.location.reload(), RELOAD_FALLBACK_MS);
  } else {
    window.location.reload();
  }
}

export function getRegistration(): ServiceWorkerRegistration | null {
  return registration;
}
