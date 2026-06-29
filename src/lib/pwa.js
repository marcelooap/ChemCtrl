/* PWA registration & update-detection logic for ChemCtrl */

let registration = null;
let updateNotified = false;
let isFirstLoad = !navigator.serviceWorker?.controller;

/**
 * Registers the service worker and wires up update detection.
 * Call this on app startup (main.jsx).
 */
export function initPWA() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        registration = reg;

        // Detect a new SW being installed
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            // New version downloaded and ready
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              notifyUpdate();
            }
          });
        });
      })
      .catch(() => {});
  });

  // When a new SW takes control (via skipWaiting), notify the user
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (isFirstLoad) {
      isFirstLoad = false;
      return; // First activation — no reload needed
    }
    notifyUpdate();
  });

  // Listen for SW_ACTIVATED message from the service worker
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SW_ACTIVATED' && navigator.serviceWorker.controller) {
      // Only notify if this isn't the very first load
      if (!isFirstLoad) {
        notifyUpdate();
      }
    }
  });

  // Periodically check for updates (every 60 minutes)
  setInterval(() => {
    registration?.update().catch(() => {});
  }, 60 * 60 * 1000);

  // Check for updates when the tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      registration?.update().catch(() => {});
    }
  });
}

/**
 * Dispatches a custom event that the PWAUpdatePrompt component listens to.
 */
function notifyUpdate() {
  if (updateNotified) return;
  updateNotified = true;
  window.dispatchEvent(new CustomEvent('pwa-update-available'));
}

/**
 * Called when the user clicks "Atualizar agora".
 * Sends SKIP_WAITING to the waiting SW (if any) and reloads.
 */
export function applyUpdate() {
  const reg = registration;
  if (reg && reg.waiting) {
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    // The controllerchange listener will reload the page
    // Fallback reload after 2s in case controllerchange doesn't fire
    setTimeout(() => window.location.reload(), 2000);
  } else {
    window.location.reload();
  }
}
