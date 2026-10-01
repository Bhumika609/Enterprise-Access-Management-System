// Decorative motif for the login screen: a small node/edge graph standing in
// for the role-hierarchy DAG at the heart of EAPIS. Static, quiet, on-theme —
// not a generic gradient blob.
export default function NodeMotif() {
  const nodes = [
    [40, 20], [110, 20], [20, 70], [75, 70], [130, 70], [75, 120],
  ];
  const edges = [[0, 2], [0, 3], [1, 3], [1, 4], [2, 5], [3, 5], [4, 5]];
  return (
    <svg viewBox="0 0 150 140" width="150" height="140" aria-hidden="true">
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]}
          stroke="var(--border-strong)" strokeWidth="1"
        />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 5 ? 5 : 3.5}
          fill={i === 5 ? 'var(--accent)' : 'var(--panel-raised)'}
          stroke={i === 5 ? 'var(--accent)' : 'var(--border-strong)'} strokeWidth="1.5" />
      ))}
    </svg>
  );
}