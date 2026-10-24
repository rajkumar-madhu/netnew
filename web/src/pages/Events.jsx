import { useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { qs, useLive, usePolling } from '../api.js';
import { Empty, Loading, SearchInput } from '../components/Bits.jsx';
import { dateTime, timeOnly } from '../format.js';
import { useTime } from '../state/time.jsx';

const FILTERS = [
  { id: 'all', label: 'All events', type: null },
  { id: 'node', label: 'Node status', type: 'node' },
  { id: 'alert', label: 'Alert transitions', type: 'alert' },
  { id: 'notification', label: 'Notifications', type: 'notification' },
];

const TYPE_LABELS = {
  'node.created': 'Node created',
  'node.connected': 'Connected',
  'node.disconnected': 'Disconnected',
  'node.removed': 'Node removed',
  'alert.raised': 'Alert raised',
  'alert.changed': 'Alert changed',
  'alert.cleared': 'Alert cleared',
  'notification.failed': 'Notification failed',
};

export default function Events() {
  const { room } = useOutletContext();
  const time = useTime();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const type = FILTERS.find((f) => f.id === filter).type;
  const { data, error, reload } = usePolling(`/events${qs({ room: room.id, type, limit: 500, ...time.query })}`, time.live ? 15_000 : 0);

  // New events arrive over the WebSocket; refetch (at most once a second) to show them.
  const pending = useRef(null);
  useLive((msg) => {
    if (msg.type !== 'event' || !time.live || pending.current) return;
    pending.current = setTimeout(() => { pending.current = null; reload(); }, 1000);
  });

  const q = query.toLowerCase();
  const events = (data ?? []).filter((e) => !q || `${e.hostname} ${e.message} ${e.type}`.toLowerCase().includes(q));

  // Group by day, newest first.
  const days = [];
  for (const e of events) {
    const day = new Date(e.ts * 1000).toDateString();
    if (days.at(-1)?.day !== day) days.push({ day, events: [] });
    days.at(-1).events.push(e);
  }

  return (
    <>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Event type">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="Search events" />
        <span className="muted small push">{events.length} events in the selected time range</span>
      </div>
      {error && <p className="error">{error.message}</p>}
      {!data && !error && <Loading />}
      {data && !events.length && <Empty icon="events" title="No events in this time range">Node connections, disconnections and alert changes show up here.</Empty>}
      {days.map(({ day, events: list }) => (
        <section key={day} className="event-day">
          <h3 className="day-heading">{day}</h3>
          <div className="panel event-list">
            {list.map((e) => (
              <div key={e.id} className="event-row">
                <span className="mono muted small" title={dateTime(e.ts)}>{timeOnly(e.ts)}</span>
                <span className={`sev-dot ${e.severity}`} title={e.severity} />
                <span className="event-type">{TYPE_LABELS[e.type] ?? e.type}</span>
                <span className="event-node">{e.node_id && e.hostname ? <Link to={`/nodes/${e.node_id}`}>{e.hostname}</Link> : <span className="muted">space</span>}</span>
                <span className="event-message">{e.message}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
