import { useEffect, useState } from 'react';
import { applyUpdate, onUpdateReady } from '../lib/serviceWorker';

/** Offers the new version once it's downloaded; nothing changes until the user taps Reload. */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const off = onUpdateReady(() => setReady(true));
    return () => {
      off();
    };
  }, []);
  if (!ready) return null;
  return (
    <div className="update-banner" role="status">
      New version available
      <button type="button" className="pill-button" onClick={applyUpdate}>
        Reload
      </button>
    </div>
  );
}
