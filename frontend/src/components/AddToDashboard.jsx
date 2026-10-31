import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, usePolling } from '../lib/api.js';
import { Loading, Modal } from './ui/Bits.jsx';
import { withScope } from '../lib/scope.js';

const newId = () => Math.random().toString(36).slice(2, 10);

/** Appends a chart (with its current settings) to a dashboard in the group. */
export default function AddToDashboard({ groupId = 'all', item, onClose }) {
  const { data } = usePolling(`/dashboards?group=${groupId}`);
  const [choice, setChoice] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function add(e) {
    e.preventDefault();
    setError(null);
    try {
      const entry = { id: newId(), width: 6, height: 220, ...item };
      let dashboard;
      if (choice === 'new' || !data.length) {
        dashboard = await api('/dashboards', { method: 'POST', body: { group_id: groupId, name: name.trim(), items: [entry] } });
      } else {
        const current = await api(`/dashboards/${choice || data[0].id}`);
        dashboard = await api(`/dashboards/${current.id}`, { method: 'PUT', body: { ...current, items: [...current.items, entry] } });
      }
      setDone(dashboard);
    } catch (err) {
      setError(err.message);
    }
  }

  if (done) {
    return (
      <Modal title="Added to dashboard" onClose={onClose} footer={(
        <>
          <button type="button" className="ghost" onClick={onClose}>Close</button>
          <Link className="button primary" to={withScope(`/app/dashboards/${done.id}`, groupId)} onClick={onClose}>Open {done.name}</Link>
        </>
      )}>
        <p>The chart was added to <strong>{done.name}</strong>.</p>
      </Modal>
    );
  }

  const creating = choice === 'new' || data?.length === 0;
  return (
    <Modal title="Add chart to dashboard" onClose={onClose} footer={(
      <>
        {error && <span className="error small">{error}</span>}
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="add-dash" className="primary" disabled={!data || (creating && !name.trim())}>Add chart</button>
      </>
    )}>
      {!data ? <Loading /> : (
        <form id="add-dash" className="form" onSubmit={add}>
          {data.length > 0 && (
            <label>
              <span>Dashboard</span>
              <select value={choice || data[0].id} onChange={(e) => setChoice(e.target.value)}>
                {data.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.charts} items)</option>)}
                <option value="new">+ New dashboard…</option>
              </select>
            </label>
          )}
          {creating && (
            <label>
              <span>New dashboard name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Web tier" autoFocus maxLength={80} />
            </label>
          )}
          <p className="muted small">The chart keeps its current grouping, aggregation, chart type and node selection.</p>
        </form>
      )}
    </Modal>
  );
}
