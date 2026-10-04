// Placeholder for a nav item that exists but hasn't been built yet in this stage.
export default function ComingSoon({ title }) {
  return (
    <div>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>{title}</h1>
      <p style={{ color: 'var(--text-muted)' }}>Not built yet — coming in a later stage.</p>
    </div>
  );
}