import { PRESETS, useTime } from '../../state/time.jsx';
import Icon from '../ui/Icon.jsx';

function fmtRange(after, before) {
  const day = { month: 'short', day: 'numeric' };
  const time = { hour: '2-digit', minute: '2-digit' };
  const a = new Date(after * 1000);
  const b = new Date(before * 1000);
  const sameDay = a.toDateString() === b.toDateString();
  return `${a.toLocaleDateString(undefined, day)} ${a.toLocaleTimeString(undefined, time)} – ${sameDay ? '' : `${b.toLocaleDateString(undefined, day)} `}${b.toLocaleTimeString(undefined, time)}`;
}

/**
 * The global time range: a live switch plus quick ranges. Dragging across a
 * chart sets a fixed range, shown as a chip that returns to live when cleared.
 */
export default function TimeRange() {
  const time = useTime();
  return (
    <div className="timerange">
      <button type="button" className={`live-switch ${time.live ? 'on' : ''}`} aria-pressed={time.live}
        aria-label={time.live ? 'Live: pause' : 'Paused: follow live data'}
        title={time.live ? 'Freeze the current time range' : 'Follow live data'}
        onClick={time.live ? time.pause : time.resume}>
        <span className="pulse" /> <span className="live-label">{time.live ? 'Live' : 'Paused'}</span>
      </button>
      {!time.live && (
        <span className="range-chip" title="Fixed time range">
          <Icon name="clock" size={13} /> {fmtRange(time.after, time.before)}
          <button type="button" className="icon-button" aria-label="Back to live" onClick={time.resume}><Icon name="x" size={12} /></button>
        </span>
      )}
      <div className="range-seg" role="group" aria-label="Time range">
        {PRESETS.map((p) => (
          <button key={p.seconds} type="button" className={time.live && time.duration === p.seconds ? 'active' : ''}
            aria-label={`Last ${p.label}`} onClick={() => time.setDuration(p.seconds)}>
            {p.label}
          </button>
        ))}
      </div>
      <select className="range-select" aria-label="Time range" value={time.live ? time.duration : ''}
        onChange={(e) => time.setDuration(Number(e.target.value))}>
        {!time.live && <option value="">Custom</option>}
        {PRESETS.map((p) => <option key={p.seconds} value={p.seconds}>{p.label}</option>)}
      </select>
    </div>
  );
}
