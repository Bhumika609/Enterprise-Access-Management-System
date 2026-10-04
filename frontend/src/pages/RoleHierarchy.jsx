import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApi, Async, Card, PageHeader } from '../components/ui';

// Draws the role DAG. Layer ("level") of every node comes from the recursive CTE in
// v_role_hierarchy_nodes; this component only turns those numbers into pixels.
// Edges point from a parent (broader role, left) to each child that inherits from it.
const NW = 150, NH = 38, GX = 90, GY = 18, PAD = 16;

export default function RoleHierarchy() {
  const state = useApi(() => api.get('/role-hierarchy'));
  const [sel, setSel] = useState(null);

  return (
    <div>
      <PageHeader title="Role Hierarchy" subtitle="Multi-parent inheritance (a DAG, not a tree). Select a role to trace what it inherits." />
      <Async state={state}>{({ nodes, edges }) => <Graph nodes={nodes} edges={edges} sel={sel} setSel={setSel} />}</Async>
    </div>
  );
}

function Graph({ nodes, edges, sel, setSel }) {
  const layout = useMemo(() => {
    const byLevel = {};
    nodes.forEach((n) => { (byLevel[n.level] ||= []).push(n); });
    const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
    const pos = {};
    let maxRows = 0;
    levels.forEach((lv) => {
      byLevel[lv].sort((a, b) => b.child_count - a.child_count || a.role_name.localeCompare(b.role_name));
      maxRows = Math.max(maxRows, byLevel[lv].length);
    });
    levels.forEach((lv, ci) => {
      const col = byLevel[lv];
      const offset = ((maxRows - col.length) * (NH + GY)) / 2;
      col.forEach((n, ri) => { pos[n.role_id] = { x: PAD + ci * (NW + GX), y: PAD + offset + ri * (NH + GY) }; });
    });
    return { pos, width: PAD * 2 + levels.length * NW + (levels.length - 1) * GX, height: PAD * 2 + maxRows * NH + (maxRows - 1) * GY };
  }, [nodes]);

  // everything the selected role inherits from (ancestors) and who inherits from it (descendants)
  const related = useMemo(() => {
    if (!sel) return null;
    const up = new Set([sel]), down = new Set([sel]);
    for (let changed = true; changed;) {
      changed = false;
      edges.forEach((e) => {
        if (up.has(e.child_role_id) && !up.has(e.parent_role_id)) { up.add(e.parent_role_id); changed = true; }
        if (down.has(e.parent_role_id) && !down.has(e.child_role_id)) { down.add(e.child_role_id); changed = true; }
      });
    }
    return { up, down };
  }, [sel, edges]);

  const role = nodes.find((n) => n.role_id === sel);
  const multi = nodes.filter((n) => n.parent_count > 1);
  const state = (id) => (!related ? 'n' : id === sel ? 's' : related.up.has(id) ? 'a' : related.down.has(id) ? 'd' : 'x');
  const edgeOn = (e) => related && ((related.up.has(e.child_role_id) && related.up.has(e.parent_role_id)) || (related.down.has(e.child_role_id) && related.down.has(e.parent_role_id)));

  return (
    <>
      <Card style={{ marginBottom: 12 }}>
        <div style={{ overflow: 'auto' }}>
          <svg width={layout.width} height={layout.height} role="img" aria-label="Role inheritance graph">
            <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--border-strong)" /></marker>
              <marker id="arrOn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent-strong)" /></marker></defs>
            {edges.map((e) => {
              const a = layout.pos[e.parent_role_id], b = layout.pos[e.child_role_id];
              if (!a || !b) return null;
              const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, mx = (x1 + x2) / 2;
              const on = edgeOn(e);
              return <path key={`${e.parent_role_id}-${e.child_role_id}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none"
                stroke={on ? 'var(--accent-strong)' : 'var(--border-strong)'} strokeWidth={on ? 2 : 1.2} opacity={related && !on ? 0.25 : 1} markerEnd={`url(#${on ? 'arrOn' : 'arr'})`} />;
            })}
            {nodes.map((n) => {
              const p = layout.pos[n.role_id]; const st = state(n.role_id);
              const stroke = st === 's' ? 'var(--accent-strong)' : st === 'a' ? 'var(--accent)' : st === 'd' ? 'var(--medium)' : n.parent_count > 1 ? 'var(--high)' : 'var(--border-strong)';
              return (
                <g key={n.role_id} transform={`translate(${p.x},${p.y})`} style={{ cursor: 'pointer' }} opacity={st === 'x' ? 0.3 : 1}
                  tabIndex={0} role="button" aria-label={`Role ${n.role_name}`}
                  onClick={() => setSel(sel === n.role_id ? null : n.role_id)} onKeyDown={(e) => e.key === 'Enter' && setSel(sel === n.role_id ? null : n.role_id)}>
                  <rect width={NW} height={NH} rx="4" fill={st === 's' ? 'var(--accent-wash)' : 'var(--panel-raised)'} stroke={stroke} strokeWidth={st === 'n' || st === 'x' ? 1.2 : 2} />
                  <text x={NW / 2} y={NH / 2 + 4} textAnchor="middle" fontSize="12.5" fill="var(--text)">{n.role_name}</text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="legend" style={{ marginTop: 10 }}>
          <span><i style={{ background: 'var(--high)' }} />multi-parent role ({multi.length})</span>
          <span><i style={{ background: 'var(--accent)' }} />inherited from (ancestor)</span>
          <span><i style={{ background: 'var(--medium)' }} />inherits from selected (descendant)</span>
        </div>
      </Card>
      {role && (
        <Card title={role.role_name}>
          <dl className="kv">
            <dt>Description</dt><dd>{role.description || '—'}</dd>
            <dt>Parents</dt><dd>{role.parent_count}</dd>
            <dt>Child roles</dt><dd>{role.child_count}</dd>
            <dt>Own permissions</dt><dd>{role.direct_permission_count}</dd>
            <dt>Current holders</dt><dd>{role.holders}</dd>
            <dt>Ancestors</dt><dd>{[...related.up].filter((i) => i !== sel).map((i) => nodes.find((n) => n.role_id === i)?.role_name).join(', ') || 'none'}</dd>
          </dl>
        </Card>
      )}
    </>
  );
}
