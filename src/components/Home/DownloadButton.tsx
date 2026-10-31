import { DownloadIcon, SavedIcon } from '../icons';

const RING_R = 9;
const RING_C = 2 * Math.PI * RING_R;

interface Props {
  saved: boolean;
  /** 0..1 while downloading, else null. */
  progress: number | null;
  onDownload: () => void;
  onRemove: () => void;
}

/** Library row action: save the song on the device, show the download, or offer to remove it. */
export function DownloadButton({ saved, progress, onDownload, onRemove }: Props) {
  if (progress !== null) {
    const pct = Math.round(progress * 100);
    return (
      <span className="icon-button download download--busy" role="progressbar" aria-label={`Downloading ${pct}%`} aria-valuenow={pct}>
        <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true">
          <circle className="download__track" cx="12" cy="12" r={RING_R} />
          <circle
            className="download__ring"
            cx="12"
            cy="12"
            r={RING_R}
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - progress)}
          />
        </svg>
      </span>
    );
  }
  return saved ? (
    <button type="button" className="icon-button download download--saved" aria-label="Remove download" onClick={onRemove}>
      <SavedIcon size={20} />
    </button>
  ) : (
    <button type="button" className="icon-button download" aria-label="Download for offline" onClick={onDownload}>
      <DownloadIcon size={20} />
    </button>
  );
}
