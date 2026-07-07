/* PWA registration & update-detection logic for ChemCtrl */

let registration = null;
let updateNotified = false;
// true only during the very first activation (no previous controller)
let isFirstActivation = !navigator.serviceWorker?.controller;

function notifyUpdate() {
  if (updateNotified) return;
  updateNotified = true;
  window.dispatchEvent(new CustomEvent('pwa-update-available'));
}

function watchInstalling(worker) {
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      // A new SW finished installing and is waiting — notify immediately
      notifyUpdate();
    }
    if (worker.state === 'activated' && !navigator.serviceWorker.controller) {
      // First-ever activation — no update prompt needed
      isFirstActivation = false;
    }
  });
}

export function initPWA() {
  if (!('serviceWorker' in navigator)) return;

  // controllerchange fires when a new SW calls clients.claim() after skipWaiting
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (isFirstActivation) {
      isFirstActivation = false;
      return;
    }
    // New SW took control → reload immediately to serve fresh assets
    window.location.reload();
  });

  // Message from SW (backup channel)
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SW_UPDATE_AVAILABLE') {
      notifyUpdate();
    }
  });

  navigator.serviceWorker
    .register('/sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      registration = reg;

      // Already a waiting worker on first load (user was offline previously)
      if (reg.waiting && navigator.serviceWorker.controller) {
        notifyUpdate();
      }

      // New worker found while app is open
      reg.addEventListener('updatefound', () => {
        if (reg.installing) {
          watchInstalling(reg.installing);
        }
      });

      // Poll for updates every 5 minutes
      setInterval(() => reg.update().catch(() => {}), 5 * 60 * 1000);

      // Check on tab focus
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          reg.update().catch(() => {});
        }
      });
    })
    .catch(() => {});
}

/**
 * Activates the waiting SW immediately, clears caches, and reloads.
 */
export async function applyUpdate() {
  const reg = registration;

  // Clear all caches so no stale asset remains
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch (_) {}

  if (reg?.waiting) {
    // Tell SW to skip waiting → triggers controllerchange → reload
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    // Fallback: if controllerchange doesn't fire within 3s, force reload
    setTimeout(() => window.location.reload(), 3000);
  } else {
    window.location.reload();
  }
}
