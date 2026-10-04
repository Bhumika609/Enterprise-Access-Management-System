// Small shared UI toolkit: data-fetch hook, badges, table, modal, pager, formatters.
import { useCallback, useEffect, useState } from 'react';

export function useApi(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    return loader()
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((e) => setState({ data: null, error: e.message || String(e), loading: false }));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export const fmtDate = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '—');
export const fmtDay = (v) => (v ? String(v).slice(0, 10) : '—');
export const titleCase = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bSod\b/g, 'SoD');

export function Sev({ level }) {
  if (!level) return null;
  return <span className={`badge badge--${level}`}>{titleCase(level)}</span>;
}

const STATUS_TONE = {
  open: 'bad', under_review: 'warn', resolved: 'ok', false_positive: '',
  pending: 'warn', approved: 'ok', rejected: 'bad', keep: 'ok', revoke: 'bad',
  active: 'ok', revoked: 'bad', expired: '', completed: 'ok', in_progress: 'info', planned: '',
  inactive: '', terminated: 'bad', insert: 'ok', update: 'warn', delete: 'bad',
};
export function Pill({ value, tone }) {
  const t = tone ?? STATUS_TONE[value] ?? '';
  return <span className={`pill ${t ? `pill--${t}` : ''}`}>{titleCase(String(value))}</span>;
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      <div className="row">{children}</div>
    </div>
  );
}

export function Card({ title, actions, children, style }) {
  return (
    <section className="card" style={style}>
      {(title || actions) && <div className="card-head"><h2>{title}</h2><div className="row">{actions}</div></div>}
      {children}
    </section>
  );
}

export function Notice({ kind, children }) {
  if (!children) return null;
  return <div className={`notice ${kind === 'err' ? 'notice--err' : kind === 'ok' ? 'notice--ok' : ''}`} role={kind === 'err' ? 'alert' : 'status'}>{children}</div>;
}

export function Async({ state, children }) {
  if (state.loading && !state.data) return <p className="muted">Loading…</p>;
  if (state.error) return <Notice kind="err">{state.error}</Notice>;
  return children(state.data);
}

// columns: [{ key, label, render?(row), align? }]
export function Table({ columns, rows, onRowClick, empty = 'Nothing to show.' }) {
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr>{columns.map((c) => <th key={c.key} style={{ textAlign: c.align }}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length}><div className="empty">{empty}</div></td></tr>}
          {rows.map((r, i) => (
            <tr key={r.__key ?? i} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => <td key={c.key} style={{ textAlign: c.align }}>{c.render ? c.render(r) : (r[c.key] ?? '—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { maxWidth: 820 } : undefined}>
        <div className="modal-head"><h2>{title}</h2><button className="btn btn--sm" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Pager({ total, limit, offset, onChange }) {
  if (!total) return null;
  const from = offset + 1, to = Math.min(offset + limit, total);
  return (
    <div className="row" style={{ marginTop: 10 }}>
      <span className="muted" style={{ fontSize: 12.5 }}>{from}–{to} of {total}</span>
      <button className="btn btn--sm right" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</button>
      <button className="btn btn--sm" disabled={to >= total} onClick={() => onChange(offset + limit)}>Next</button>
    </div>
  );
}

export function Field({ label, children }) {
  return <div className="form-row"><label>{label}</label>{children}</div>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t.key} role="tab" className="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>{t.label}</button>)}
    </div>
  );
}

// run an async action with busy/error/success feedback
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const run = async (fn, okMsg) => {
    setBusy(true); setError(null); setOk(null);
    try { const r = await fn(); if (okMsg) setOk(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
    catch (e) { setError(e.message || String(e)); return undefined; }
    finally { setBusy(false); }
  };
  return { busy, error, ok, run, clear: () => { setError(null); setOk(null); } };
}

export const qs = (obj) => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const canReview = (role) => ['admin', 'auditor', 'manager'].includes(role);
