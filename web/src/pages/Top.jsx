import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Empty, StatusDot } from '../components/Bits.jsx';
import ProcessTable from '../components/ProcessTable.jsx';

export default function Top() {
  const { nodes } = useOutletContext();
  const live = nodes.filter((n) => n.online);
  const [nodeId, setNodeId] = useState(null);
  const current = nodes.find((n) => n.id === nodeId) ?? live[0] ?? nodes[0];

  if (!nodes.length) return <Empty icon="top" title="No nodes in this room" />;

  return (
    <>
      <div className="node-picker" role="tablist" aria-label="Node">
        {nodes.map((n) => (
          <button key={n.id} type="button" role="tab" aria-selected={n.id === current.id}
            className={`node-pill ${n.id === current.id ? 'active' : ''}`} onClick={() => setNodeId(n.id)}>
            <StatusDot online={n.online} /> {n.hostname}
          </button>
        ))}
      </div>
      {current.online
        ? <ProcessTable key={current.id} nodeId={current.id} />
        : <Empty icon="top" title={`${current.hostname} is offline`}>Processes are shown live, so the node must be connected.</Empty>}
    </>
  );
}
