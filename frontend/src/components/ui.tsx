import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ---------- toast ----------
type ToastFn = (text: string, tone?: 'ok' | 'bad') => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; tone?: string } | null>(null);
  const timer = useRef<number>();
  const show = useCallback<ToastFn>((text, tone) => {
    setMsg({ text, tone });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {msg && <div className={`toast ${msg.tone ?? ''}`}>{msg.text}</div>}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- small pieces ----------
export function Pill({ tone = '', children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return <span className={`pill ${tone}`} title={title}>{children}</span>;
}

export function Progress({ value, total, label }: { value: number; total: number; label?: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label ?? 'Progress'}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="spinner" role="status"><span className="dot" />{label}</div>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

/** A button that asks "are you sure?" inline instead of a browser dialog. */
export function ConfirmButton({
  children, confirm, onConfirm, className = 'ghost', confirmClass = 'danger', disabled,
}: {
  children: ReactNode; confirm: ReactNode; onConfirm: () => void | Promise<unknown>;
  className?: string; confirmClass?: string; disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) return <button type="button" className={className} disabled={disabled} onClick={() => setAsking(true)}>{children}</button>;
  return (
    <span className="confirm">
      <span>{confirm}</span>
      <button type="button" className={confirmClass} disabled={busy}
        onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); setAsking(false); } }}>
        Yes
      </button>
      <button type="button" className="ghost" onClick={() => setAsking(false)}>No</button>
    </span>
  );
}

/** Live "in 12s / in 3 min" countdown to a timestamp. */
export function Countdown({ to }: { to: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick(x => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((new Date(to).getTime() - Date.now()) / 1000));
  return <>{s >= 120 ? `${Math.ceil(s / 60)} min` : `${s}s`}</>;
}
