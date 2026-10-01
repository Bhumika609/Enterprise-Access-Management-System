// Small live indicator, used on the login terminal to show whether the API is reachable.
export default function StatusDot({ state }) {
  const color = state === 'online' ? 'var(--low)' : state === 'offline' ? 'var(--critical)' : 'var(--text-faint)';
  const label = state === 'online' ? 'system online' : state === 'offline' ? 'system unreachable' : 'checking system…';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
      <span
        style={{
          width: 7, height: 7, borderRadius: '50%', background: color,
          boxShadow: state === 'online' ? `0 0 0 3px color-mix(in srgb, ${color} 25%, transparent)` : 'none',
        }}
      />
      <span className="mono" style={{ fontSize: 12 }}>{label}</span>
    </span>
  );
}