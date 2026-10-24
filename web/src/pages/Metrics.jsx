import { useOutletContext } from 'react-router-dom';
import { Empty } from '../components/Bits.jsx';
import MetricsBoard from '../components/MetricsBoard.jsx';

export default function Metrics() {
  const { room, nodes } = useOutletContext();
  if (!nodes.length) return <Empty icon="metrics" title="No nodes in this room">Add nodes to see their metrics here.</Empty>;
  return <MetricsBoard room={room.id} nodes={nodes} />;
}
