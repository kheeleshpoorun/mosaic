/** Registers the service worker (production only) and reports when a new version is waiting. */
const listeners = new Set<() => void>();
let waiting: ServiceWorker | null = null;

export function onUpdateReady(fn: () => void) {
  listeners.add(fn);
  if (waiting) fn();
  return () => listeners.delete(fn);
}

/** Activates the waiting version; the page reloads once it takes over. */
export function applyUpdate() {
  waiting?.postMessage('skip-waiting');
}

function announce(worker: ServiceWorker) {
  waiting = worker;
  listeners.forEach((fn) => fn());
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  // Without a controller this is the first install: nothing to reload into.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
      const watch = (w: ServiceWorker) =>
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) announce(w);
        });
      if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
      if (reg.installing) watch(reg.installing);
      reg.addEventListener('updatefound', () => reg.installing && watch(reg.installing));
      // An installed app can stay open for days: look for a new version whenever it comes back.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
      });
    } catch {
      // No offline support (e.g. private mode); the app works as before.
    }
  });
}
