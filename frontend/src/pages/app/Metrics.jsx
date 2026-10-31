import { useOutletContext } from 'react-router-dom';
import { Empty } from '../../components/ui/Bits.jsx';
import MetricsBoard from '../../components/charts/MetricsBoard.jsx';

export default function Metrics() {
  const { group, nodes } = useOutletContext();
  if (!nodes.length) return <Empty icon="metrics" title="No nodes in this group">Add nodes to see their metrics here.</Empty>;
  return <MetricsBoard group={group.id} nodes={nodes} />;
}
