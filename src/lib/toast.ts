type Listener = (message: string) => void;
const listeners = new Set<Listener>();

export function toast(message: string) {
  listeners.forEach((fn) => fn(message));
}

export function onToast(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
