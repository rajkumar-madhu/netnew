import { useState } from 'react';
import { api } from '../lib/api.js';
import { useWorkspace } from '../state/workspace.jsx';
import { Modal, SearchInput, StatusDot } from './ui/Bits.jsx';

/** Create a group, or edit an existing group's name, description and nodes. */
export default function GroupDialog({ group, initialNodeIds, onClose, onSaved }) {
  const { nodes, loadGroups } = useWorkspace();
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [selected, setSelected] = useState(() => new Set(group?.nodeIds ?? initialNodeIds ?? []));
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
      const saved = group
        ? await api(`/groups/${group.id}`, { method: 'PATCH', body })
        : await api('/groups', { method: 'POST', body });
      const final = await api(`/groups/${saved.id}/nodes`, { method: 'PUT', body: { nodeIds: [...selected] } });
      await loadGroups();
      onSaved?.(final);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title={group ? `Edit group: ${group.name}` : 'Create group'} onClose={onClose}
      footer={(
        <>
          {error && <span className="error small">{error}</span>}
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="group-form" className="primary" disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : group ? 'Save group' : 'Create group'}
          </button>
        </>
      )}>
      <form id="group-form" className="form" onSubmit={save}>
        <label>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Production" autoFocus />
        </label>
        <label>
          <span>Description <em className="muted">(optional)</em></span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </label>
        <div className="field">
          <span>Nodes in this group <em className="muted">({selected.size} selected)</em></span>
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
