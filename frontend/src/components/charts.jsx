// Dependency-free SVG charts. They only draw numbers the database already computed.
const SEV_COLORS = { critical: 'var(--critical)', high: 'var(--high)', medium: 'var(--medium)', low: 'var(--low)' };
export const sevColor = (s) => SEV_COLORS[s] || 'var(--accent)';

export function Legend({ items }) {
  return <div className="legend">{items.map((i) => <span key={i.label}><i style={{ background: i.color }} />{i.label} <b className="mono" style={{ color: 'var(--text)' }}>{i.value}</b></span>)}</div>;
}

// items: [{ label, value, color }]
export function Donut({ items, size = 160 }) {
  const total = items.reduce((a, b) => a + b.value, 0);
  const r = 58, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="row" style={{ gap: 20, alignItems: 'center' }}>
      <svg width={size} height={size} viewBox="0 0 160 160" role="img" aria-label={`Distribution of ${total} items`}>
        <circle cx="80" cy="80" r={r} fill="none" stroke="var(--border)" strokeWidth="18" />
        {total > 0 && items.map((it) => {
          const len = (it.value / total) * c;
          const el = <circle key={it.label} cx="80" cy="80" r={r} fill="none" stroke={it.color} strokeWidth="18"
            strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 80 80)" />;
          acc += len; return el;
        })}
        <text x="80" y="78" textAnchor="middle" fill="var(--text)" fontSize="26" fontWeight="600" fontFamily="var(--font-mono)">{total}</text>
        <text x="80" y="96" textAnchor="middle" fill="var(--text-muted)" fontSize="10">open findings</text>
      </svg>
      <Legend items={items} />
    </div>
  );
}

// horizontal bars: items [{ label, value, color }]
export function HBars({ items }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((i) => (
        <div key={i.label}>
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
            <span className="muted">{i.label}</span><span className="mono">{i.value}</span>
          </div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(i.value / max) * 100}%`, background: i.color }} /></div>
        </div>
      ))}
    </div>
  );
}

// two series over days: points [{ day, total, failed }]
export function ActivityChart({ points, width = 560, height = 190 }) {
  if (!points.length) return <p className="faint">No access activity in the last 30 days.</p>;
  const pad = { l: 34, r: 8, t: 10, b: 24 };
  const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
  const max = Math.max(1, ...points.map((p) => p.total));
  const x = (i) => pad.l + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v) => pad.t + h - (v / max) * h;
  const line = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const ticks = [0, Math.ceil(max / 2), max];
  const step = Math.max(1, Math.floor(points.length / 5));
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Access activity over the last 30 days" style={{ maxWidth: width }}>
        {ticks.map((t) => <g key={t}><line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" /><text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--text-faint)">{t}</text></g>)}
        <path d={line('total')} fill="none" stroke="var(--accent)" strokeWidth="2" />
        <path d={line('failed')} fill="none" stroke="var(--critical)" strokeWidth="2" />
        {points.map((p, i) => i % step === 0 && <text key={p.day} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--text-faint)">{p.day.slice(5)}</text>)}
        {points.map((p, i) => <circle key={p.day} cx={x(i)} cy={y(p.total)} r="2.5" fill="var(--accent)"><title>{`${p.day}: ${p.total} accesses, ${p.failed} failed`}</title></circle>)}
      </svg>
      <Legend items={[{ label: 'All access events', value: points.reduce((a, p) => a + p.total, 0), color: 'var(--accent)' }, { label: 'Failed', value: points.reduce((a, p) => a + p.failed, 0), color: 'var(--critical)' }]} />
    </div>
  );
}
