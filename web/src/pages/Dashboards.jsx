import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { api, qs, usePolling } from '../api.js';
import { Dropdown, Empty, Loading, MenuItem, Modal, SearchInput, StatusDot } from '../components/Bits.jsx';
import Icon from '../components/Icon.jsx';
import NetChart from '../components/NetChart.jsx';
import { ago, plural } from '../format.js';

const WIDTHS = [
  { cols: 3, label: 'Quarter' },
  { cols: 4, label: 'Third' },
  { cols: 6, label: 'Half' },
  { cols: 8, label: 'Two thirds' },
  { cols: 12, label: 'Full width' },
];
const newId = () => Math.random().toString(36).slice(2, 10);

// The full chart catalog (titles, units, defaults), fetched once.
let catalogPromise = null;
function useCatalog() {
  const [catalog, setCatalog] = useState(null);
  useEffect(() => {
    catalogPromise ??= api('/catalog');
    catalogPromise.then(setCatalog).catch(() => { catalogPromise = null; });
  }, []);
  return catalog;
}

// ------------------------------------------------------------------ list

function NewDashboard({ roomId, onClose }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(null);

  async function create(e) {
    e.preventDefault();
    try {
      const d = await api('/dashboards', { method: 'POST', body: { room_id: roomId, name, description } });
      navigate(`/rooms/${roomId}/dashboards/${d.id}?edit=1`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title="New dashboard" onClose={onClose} footer={(
      <>
        {error && <span className="error small">{error}</span>}
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="new-dash" className="primary" disabled={!name.trim()}>Create and add charts</button>
      </>
    )}>
      <form id="new-dash" className="form" onSubmit={create}>
        <label><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Checkout service" autoFocus /></label>
        <label><span>Description <em className="muted">(optional)</em></span><input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></label>
      </form>
    </Modal>
  );
}

export function DashboardList() {
  const { room } = useOutletContext();
  const { data, error } = usePolling(`/dashboards?room=${room.id}`);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="toolbar">
        <p className="muted">Build your own views: pick any chart, for any nodes in this room, and arrange them on a board.</p>
        <button type="button" className="primary push" onClick={() => setCreating(true)}><Icon name="plus" size={15} /> New dashboard</button>
      </div>
      {error && <p className="error">{error.message}</p>}
      {!data && !error && <Loading />}
      {data?.length === 0 && (
        <Empty icon="dashboard" title="No dashboards in this room yet"
          action={<button type="button" className="primary" onClick={() => setCreating(true)}>Create a dashboard</button>}>
          You can also add any chart from the Metrics tab with its dashboard button.
        </Empty>
      )}
      <div className="dash-cards">
        {data?.map((d) => (
          <Link key={d.id} to={`/rooms/${room.id}/dashboards/${d.id}`} className="panel dash-card">
            <Icon name="dashboard" size={22} />
            <strong>{d.name}</strong>
            {d.description && <span className="muted small">{d.description}</span>}
            <span className="muted small">{plural(d.charts, 'item')} · updated {ago(d.updated_at)}</span>
          </Link>
        ))}
      </div>
      {creating && <NewDashboard roomId={room.id} onClose={() => setCreating(false)} />}
    </>
  );
}

// ------------------------------------------------------------------ chart picker

function ChartItemDialog({ roomId, nodes, catalog, item, onSave, onClose }) {
  const { data: available } = usePolling(`/contexts${qs({ room: roomId, after: -3600 })}`);
  const [context, setContext] = useState(item?.context ?? '');
  const [title, setTitle] = useState(item?.title ?? '');
  const [width, setWidth] = useState(item?.width ?? 6);
  const [selected, setSelected] = useState(() => (item?.nodes ? new Set(item.nodes) : null));
  const [query, setQuery] = useState('');

  const withData = new Set(available?.contexts.map((c) => c.context) ?? []);
  const q = query.toLowerCase();
  const options = (catalog?.contexts ?? []).filter((c) => !q || `${c.title} ${c.context} ${c.section}`.toLowerCase().includes(q));
  const meta = catalog?.contexts.find((c) => c.context === context);

  const toggleNode = (id) => setSelected((cur) => {
    const next = new Set(cur ?? nodes.map((n) => n.id));
    if (next.has(id)) next.delete(id); else next.add(id);
    return next.size === nodes.length ? null : next;
  });

  function save(e) {
    e.preventDefault();
    onSave({
      ...(item ?? { id: newId(), kind: 'chart', height: 220 }),
      context,
      title: title.trim(),
      width,
      nodes: selected ? [...selected] : undefined,
    });
  }

  return (
    <Modal title={item ? 'Edit chart' : 'Add chart'} wide onClose={onClose} footer={(
      <>
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="chart-item" className="primary" disabled={!context}>{item ? 'Save chart' : 'Add chart'}</button>
      </>
    )}>
      <form id="chart-item" className="chart-picker" onSubmit={save}>
        <div className="picker-list">
          <SearchInput value={query} onChange={setQuery} placeholder="Search charts" />
          <div className="picker-options">
            {(catalog?.sections ?? []).map((section) => {
              const list = options.filter((c) => c.section === section);
              if (!list.length) return null;
              return (
                <div key={section}>
                  <div className="int-group">{section}</div>
                  {list.map((c) => (
                    <button key={c.context} type="button" className={`picker-option ${context === c.context ? 'active' : ''}`} onClick={() => setContext(c.context)}>
                      <span>{c.title}</span>
                      <span className="muted small mono">{c.context}</span>
                      {!withData.has(c.context) && <span className="muted small">no data yet</span>}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        <div className="form">
          {meta ? <p><strong>{meta.title}</strong> <span className="muted small">{meta.units}</span><br /><span className="muted small">{meta.help}</span></p>
            : <p className="muted">Choose a chart on the left.</p>}
          <label><span>Title <em className="muted">(optional)</em></span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={meta?.title} maxLength={100} /></label>
          <label>
            <span>Width</span>
            <select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
              {WIDTHS.map((w) => <option key={w.cols} value={w.cols}>{w.label}</option>)}
            </select>
          </label>
          <div className="field">
            <span>Nodes <em className="muted">({selected ? `${selected.size} of ${nodes.length}` : 'all in room'})</em></span>
            <div className="check-list">
              {nodes.map((n) => (
                <label key={n.id} className="check-row">
                  <input type="checkbox" checked={!selected || selected.has(n.id)} onChange={() => toggleNode(n.id)} />
                  <StatusDot online={n.online} /> <span>{n.hostname}</span>
                </label>
              ))}
            </div>
          </div>
          <p className="muted small">Group-by, aggregation and chart type are set on the chart itself while editing.</p>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ board

function ItemControls({ item, index, count, onChange, onMove, onEdit, onRemove }) {
  return (
    <div className="item-controls">
      <button type="button" className="icon-button" title="Move earlier" aria-label="Move earlier" disabled={index === 0} onClick={() => onMove(-1)}><Icon name="left" size={14} /></button>
      <button type="button" className="icon-button" title="Move later" aria-label="Move later" disabled={index === count - 1} onClick={() => onMove(1)}><Icon name="right" size={14} /></button>
      <Dropdown align="right" label={WIDTHS.find((w) => w.cols === item.width)?.label ?? 'Width'}>
        {WIDTHS.map((w) => <MenuItem key={w.cols} active={item.width === w.cols} onClick={() => onChange({ width: w.cols })}>{w.label}</MenuItem>)}
      </Dropdown>
      <button type="button" className="icon-button" title="Shorter" aria-label="Shorter" onClick={() => onChange({ height: Math.max(120, item.height - 40) })}><Icon name="up" size={14} /></button>
      <button type="button" className="icon-button" title="Taller" aria-label="Taller" onClick={() => onChange({ height: Math.min(520, item.height + 40) })}><Icon name="down" size={14} /></button>
      {onEdit && <button type="button" className="icon-button" title="Edit" aria-label="Edit" onClick={onEdit}><Icon name="edit" size={14} /></button>}
      <button type="button" className="icon-button danger" title="Remove" aria-label="Remove" onClick={onRemove}><Icon name="trash" size={14} /></button>
    </div>
  );
}

export function DashboardView() {
  const { room, nodes } = useOutletContext();
  const { dashboardId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const [dash, setDash] = useState(null);
  const [draft, setDraft] = useState(null); // editing copy
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // { item } for edit, {} for add
  const [dragId, setDragId] = useState(null);

  useEffect(() => {
    setDash(null);
    api(`/dashboards/${dashboardId}`).then((d) => {
      setDash(d);
      if (params.get('edit')) {
        setDraft(d);
        setParams((p) => { p.delete('edit'); return p; }, { replace: true });
      }
    }).catch(setError);
  }, [dashboardId]); // eslint-disable-line react-hooks/exhaustive-deps

  const metaFor = useMemo(() => {
    const map = new Map(catalog?.contexts.map((c) => [c.context, c]) ?? []);
    return (context) => map.get(context) ?? { context, title: context, units: '', type: 'line', agg: 'avg', groupBy: 'dimension', section: 'Other' };
  }, [catalog]);

  if (error) return <Empty icon="dashboard" title="Dashboard not found" action={<Link className="button primary" to={`/rooms/${room.id}/dashboards`}>All dashboards</Link>}>{error.message}</Empty>;
  if (!dash || !catalog) return <Loading />;

  const editing = Boolean(draft);
  const board = draft ?? dash;
  const setItems = (fn) => setDraft((d) => ({ ...d, items: fn(d.items) }));
  const updateItem = (id, patch) => setItems((items) => items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const move = (from, to) => setItems((items) => {
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, it);
    return next;
  });

  async function save() {
    try {
      const saved = await api(`/dashboards/${dash.id}`, { method: 'PUT', body: draft });
      setDash(saved);
      setDraft(null);
    } catch (err) {
      window.alert(err.message);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete dashboard "${dash.name}"?`)) return;
    await api(`/dashboards/${dash.id}`, { method: 'DELETE' });
    navigate(`/rooms/${room.id}/dashboards`);
  }

  return (
    <div className={`dashboard ${editing ? 'editing' : ''}`}>
      <div className="toolbar dash-head">
        <Link to={`/rooms/${room.id}/dashboards`} className="icon-button" aria-label="All dashboards"><Icon name="back" size={16} /></Link>
        {editing ? (
          <>
            <input className="dash-name-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Dashboard name" maxLength={80} />
            <input className="dash-desc-input" value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Description" aria-label="Description" maxLength={300} />
          </>
        ) : (
          <div>
            <h2 className="dash-title">{dash.name}</h2>
            {dash.description && <span className="muted small">{dash.description}</span>}
          </div>
        )}
        <div className="push toolbar-actions">
          {editing ? (
            <>
              <button type="button" className="ghost" onClick={() => setDialog({})}><Icon name="plus" size={15} /> Add chart</button>
              <button type="button" className="ghost" onClick={() => setItems((items) => [...items, { id: newId(), kind: 'note', title: 'Note', text: '', width: 4, height: 160 }])}>
                <Icon name="edit" size={15} /> Add note
              </button>
              <button type="button" className="ghost" onClick={() => setDraft(null)}>Cancel</button>
              <button type="button" className="primary" onClick={save} disabled={!draft.name.trim()}>Save dashboard</button>
            </>
          ) : (
            <>
              <button type="button" className="ghost danger" onClick={remove}><Icon name="trash" size={15} /> Delete</button>
              <button type="button" className="primary" onClick={() => setDraft(dash)}><Icon name="edit" size={15} /> Edit</button>
            </>
          )}
        </div>
      </div>
      {editing && <p className="muted small">Drag items to reorder them, or use the arrows. Changes to a chart's grouping, aggregation and type are saved with the dashboard.</p>}

      {!board.items.length && (
        <Empty icon="dashboard" title="This dashboard is empty"
          action={<button type="button" className="primary" onClick={() => { if (!editing) setDraft(dash); setDialog({}); }}>Add a chart</button>} />
      )}

      <div className="dash-grid">
        {board.items.map((item, index) => {
          const controls = editing && (
            <ItemControls item={item} index={index} count={board.items.length}
              onChange={(patch) => updateItem(item.id, patch)}
              onMove={(delta) => move(index, index + delta)}
              onEdit={item.kind === 'chart' ? () => setDialog({ item }) : null}
              onRemove={() => setItems((items) => items.filter((it) => it.id !== item.id))} />
          );
          return (
            <div key={item.id} className={`dash-item ${dragId === item.id ? 'dragging' : ''}`}
              style={{ gridColumn: `span ${item.width}` }}
              draggable={editing}
              onDragStart={(e) => { setDragId(item.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => { if (dragId) e.preventDefault(); }}
              onDrop={(e) => {
                e.preventDefault();
                const from = board.items.findIndex((it) => it.id === dragId);
                if (from >= 0 && from !== index) move(from, index);
                setDragId(null);
              }}>
              {item.kind === 'note' ? (
                <section className="panel note-item" style={{ minHeight: item.height }}>
                  <header className="chart-head">
                    {editing
                      ? <input value={item.title} onChange={(e) => updateItem(item.id, { title: e.target.value })} aria-label="Note title" maxLength={100} />
                      : <h3>{item.title}</h3>}
                    <div className="chart-actions">{controls}</div>
                  </header>
                  {editing
                    ? <textarea value={item.text} onChange={(e) => updateItem(item.id, { text: e.target.value })} rows={5} placeholder="Runbook links, context for the team…" />
                    : <p className="note-text">{item.text || <span className="muted">Empty note</span>}</p>}
                </section>
              ) : (
                <NetChart key={`${item.id}-${(item.nodes ?? []).join(',')}-${editing}`}
                  meta={{ ...metaFor(item.context), dims: item.dims }}
                  scope={{ room: room.id, nodes: item.nodes }}
                  height={item.height}
                  settings={item}
                  onSettingsChange={editing ? (patch) => updateItem(item.id, patch) : undefined}
                  actions={controls}
                  canAddToDashboard={false} />
              )}
            </div>
          );
        })}
      </div>

      {dialog && (
        <ChartItemDialog roomId={room.id} nodes={nodes} catalog={catalog} item={dialog.item}
          onClose={() => setDialog(null)}
          onSave={(saved) => {
            setItems((items) => (dialog.item ? items.map((it) => (it.id === saved.id ? saved : it)) : [...items, saved]));
            setDialog(null);
          }} />
      )}
    </div>
  );
}
