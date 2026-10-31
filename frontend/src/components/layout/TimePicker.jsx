import { duration } from '../../lib/format.js';
import { PRESETS, useTime } from '../../state/time.jsx';
import { Dropdown, MenuItem } from '../ui/Bits.jsx';
import Icon from '../ui/Icon.jsx';

function fmtRange(after, before) {
  const opts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
  return `${new Date(after * 1000).toLocaleString(undefined, opts)} → ${new Date(before * 1000).toLocaleTimeString()}`;
}

export default function TimePicker() {
  const time = useTime();
  const label = time.live
    ? <>Last {PRESETS.find((p) => p.seconds === time.duration)?.label ?? duration(time.duration)}</>
    : fmtRange(time.after, time.before);

  return (
    <div className="time-picker">
      <button type="button" className={`play ${time.live ? 'live' : 'paused'}`}
        title={time.live ? 'Pause: freeze the current time window' : 'Play: follow live data'}
        aria-label={time.live ? 'Pause' : 'Play'}
        onClick={time.live ? time.pause : time.resume}>
        <Icon name={time.live ? 'pause' : 'play'} size={14} />
        <span>{time.live ? 'Live' : 'Paused'}</span>
      </button>
      <Dropdown align="right" className="time-dropdown" label={<><Icon name="clock" size={15} /> {label}</>}>
        <div className="menu-heading">Quick ranges</div>
        {PRESETS.map((p) => (
          <MenuItem key={p.seconds} active={time.live && time.duration === p.seconds} onClick={() => time.setDuration(p.seconds)}>
            Last {p.label}
          </MenuItem>
        ))}
        <div className="menu-hint">Tip: drag across any chart to zoom into that range.</div>
      </Dropdown>
    </div>
  );
}
