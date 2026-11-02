/**
 * "Install Mosaic" support. Chrome/Edge/Android fire `beforeinstallprompt`, which we keep so our own
 * button can open the browser's install dialog. iOS has no install API, so it gets a hint instead.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** 'prompt': we can open the install dialog. 'ios': show Share → Add to Home Screen. null: nothing to offer. */
export type InstallMode = 'prompt' | 'ios' | null;

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function onInstallChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Called once at startup: the event can fire before React mounts. */
export function watchInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // our card replaces the browser's own mini-infobar
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    notify();
  });
}

function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  // iPadOS reports itself as a Mac; touch gives it away.
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export function installMode(): InstallMode {
  if (installed || isStandalone()) return null;
  if (deferred) return 'prompt';
  return isIos() ? 'ios' : null;
}

/** Opens the browser's install dialog (the event can only be used once). */
export async function promptInstall(): Promise<void> {
  const e = deferred;
  if (!e) return;
  deferred = null;
  await e.prompt();
  if ((await e.userChoice).outcome === 'accepted') installed = true;
  notify();
}
