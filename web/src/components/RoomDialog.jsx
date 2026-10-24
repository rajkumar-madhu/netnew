import { useState } from 'react';
import { api } from '../api.js';
import { useSpace } from '../state/space.jsx';
import { Modal, SearchInput, StatusDot } from './Bits.jsx';

/** Create a room, or edit an existing room's name, description and nodes. */
export default function RoomDialog({ room, initialNodeIds, onClose, onSaved }) {
  const { nodes, loadRooms } = useSpace();
  const [name, setName] = useState(room?.name ?? '');
  const [description, setDescription] = useState(room?.description ?? '');
  const [selected, setSelected] = useState(() => new Set(room?.nodeIds ?? initialNodeIds ?? []));
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const visible = (nodes ?? []).filter((n) => n.hostname.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (id) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { name, description };
      const saved = room
        ? await api(`/rooms/${room.id}`, { method: 'PATCH', body })
        : await api('/rooms', { method: 'POST', body });
      const final = await api(`/rooms/${saved.id}/nodes`, { method: 'PUT', body: { nodeIds: [...selected] } });
      await loadRooms();
      onSaved?.(final);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title={room ? `Edit room: ${room.name}` : 'Create room'} onClose={onClose}
      footer={(
        <>
          {error && <span className="error small">{error}</span>}
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="room-form" className="primary" disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : room ? 'Save room' : 'Create room'}
          </button>
        </>
      )}>
      <form id="room-form" className="form" onSubmit={save}>
        <label>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Production" autoFocus />
        </label>
        <label>
          <span>Description <em className="muted">(optional)</em></span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </label>
        <div className="field">
          <span>Nodes in this room <em className="muted">({selected.size} selected)</em></span>
          <SearchInput value={filter} onChange={setFilter} placeholder="Filter nodes" />
          <div className="check-list">
            {visible.map((n) => (
              <label key={n.id} className="check-row">
                <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggle(n.id)} />
                <StatusDot online={n.online} />
                <span>{n.hostname}</span>
                <span className="muted small">{n.os}</span>
              </label>
            ))}
            {!visible.length && <p className="muted small">No nodes match.</p>}
          </div>
        </div>
      </form>
    </Modal>
  );
}
