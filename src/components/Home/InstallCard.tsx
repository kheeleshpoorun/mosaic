import { useState, useSyncExternalStore } from 'react';
import { installMode, onInstallChange, promptInstall } from '../../lib/install';
import { CloseIcon, ShareIcon, WaveIcon } from '../icons';

/** Per-viewer preference: the install card stays away once dismissed. */
const DISMISSED_KEY = 'mosaic:install-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // storage unavailable — dismissed for this session only
  }
}

/** Home page card that tells people Mosaic can be installed (and then works offline). */
export function InstallCard() {
  const mode = useSyncExternalStore(onInstallChange, installMode);
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!mode || dismissed) return null;

  return (
    <section className="install" aria-label="Install Mosaic">
      <span className="brand__mark install__mark">
        <WaveIcon size={20} />
      </span>
      <div className="install__text">
        <p className="install__title">Install Mosaic</p>
        {mode === 'prompt' ? (
          <p className="install__hint">Open it from your home screen and play saved songs offline.</p>
        ) : (
          <p className="install__hint">
            Tap <ShareIcon size={15} className="install__share" aria-label="Share" role="img" aria-hidden={false} /> then <strong>Add to Home Screen</strong> to
            play saved songs offline.
          </p>
        )}
      </div>
      {mode === 'prompt' && (
        <button type="button" className="pill-button install__button" onClick={() => void promptInstall()}>
          Install
        </button>
      )}
      <button
        type="button"
        className="icon-button install__close"
        aria-label="Dismiss"
        onClick={() => {
          writeDismissed();
          setDismissed(true);
        }}
      >
        <CloseIcon size={18} />
      </button>
    </section>
  );
}
