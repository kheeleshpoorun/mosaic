import { Engine, type StemState } from '../../audio/Engine';
import { stemMeta } from '../../lib/stemMeta';
import { MoreVerticalIcon, MuteSlash } from '../icons';
import { Slider } from './Slider';

interface Props {
  engine: Engine;
  stems: StemState[];
  index: number;
  onMenu: () => void;
}

export function StemRow({ engine, stems, index, onMenu }: Props) {
  const stem = stems[index];
  const { label, Icon } = stemMeta(stem.name);
  const audible = Engine.audible(stems, index);
  return (
    <div className={`stem-row ${audible ? '' : 'stem-row--off'} ${stem.soloed ? 'stem-row--solo' : ''}`}>
      <button
        type="button"
        className="stem-row__icon"
        aria-label={`${stem.muted ? 'Unmute' : 'Mute'} ${label}`}
        title={label}
        onClick={() => engine.toggleMute(index)}
      >
        <Icon size={30} />
        {stem.muted && <MuteSlash size={30} className="stem-row__slash" />}
      </button>
      <Slider
        className="stem-row__slider"
        label={`${label} volume`}
        value={stem.muted ? 0 : stem.volume}
        dim={!audible}
        onChange={(v) => engine.setVolume(index, v)}
      />
      <button type="button" className="icon-button stem-row__menu" aria-label={`${label} options`} onClick={onMenu}>
        <MoreVerticalIcon size={22} />
      </button>
    </div>
  );
}
