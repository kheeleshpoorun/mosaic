import { useEffect, useState } from 'react';
import { onToast } from '../lib/toast';

export function Toast() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    const off = onToast((m) => {
      setMessage(m);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMessage(null), 2200);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);
  return (
    <div className={`toast ${message ? 'toast--show' : ''}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}
