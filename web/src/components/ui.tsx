import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';

// ---------- Button ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
const variants: Record<Variant, string> = {
  primary: 'bg-gradient-brand text-white shadow-lg shadow-cyan-500/20 hover:brightness-110',
  secondary: 'bg-surface-2 text-fg border border-line hover:border-brand/50',
  outline: 'border border-line text-fg hover:bg-surface-2',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-rose-600 text-white hover:bg-rose-500',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-9 px-4 text-sm',
        size === 'lg' && 'h-11 px-5 text-sm',
        variants[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ title, className, tone = 'default', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { title: string; tone?: 'default' | 'danger' | 'success' }) {
  return (
    <button
      {...rest}
      title={title}
      aria-label={title}
      className={clsx(
        'inline-flex size-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 disabled:opacity-40',
        tone === 'default' && 'hover:text-fg',
        tone === 'danger' && 'hover:text-rose-500',
        tone === 'success' && 'hover:text-emerald-500',
        className,
      )}
    />
  );
}

// ---------- Card ----------
export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={clsx('card', className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon, actions, className }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">{icon}</div>}
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, icon, actions }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3">
        {icon && <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-lg shadow-cyan-500/20">{icon}</div>}
        <div>
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------- Badge ----------
type Tone = 'gray' | 'green' | 'red' | 'yellow' | 'blue' | 'cyan' | 'violet' | 'orange';
const tones: Record<Tone, string> = {
  gray: 'bg-slate-500/10 text-slate-500 dark:text-slate-300 ring-slate-500/20',
  green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/25',
  red: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/25',
  yellow: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/25',
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-blue-500/25',
  cyan: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 ring-cyan-500/25',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-300 ring-violet-500/25',
  orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 ring-orange-500/25',
};

export function Badge({ tone = 'gray', children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function StatusDot({ online, className }: { online: boolean | undefined; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-block size-2.5 shrink-0 rounded-full',
        online === undefined ? 'bg-slate-400' : online ? 'live-dot bg-emerald-500 text-emerald-500/60' : 'bg-rose-500',
        className,
      )}
    />
  );
}

// ---------- Form ----------
export function Field({ label, hint, error, children, className, required }: { label?: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={clsx('block', className)}>
      {label && (
        <span className="mb-1.5 block text-xs font-medium text-muted">
          {label}
          {required && <span className="text-rose-500"> *</span>}
        </span>
      )}
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-subtle">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] text-rose-500">{error}</span>}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={clsx('input', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={clsx('input', className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={clsx('input min-h-20 font-mono text-xs', className)} />;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('inline-flex cursor-pointer select-none items-center gap-2.5', disabled && 'cursor-not-allowed opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-gradient-brand' : 'bg-slate-300 dark:bg-slate-700')}
      >
        <span className={clsx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}

// ---------- Feedback ----------
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-5 animate-spin text-brand', className)} />;
}

export function Loading({ text = 'Memuat...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
      <Spinner /> {text}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-subtle">{icon}</div>}
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-md text-xs text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="m-4 flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm">
      <XCircle className="mt-0.5 size-5 shrink-0 text-rose-500" />
      <div className="flex-1">
        <p className="font-medium text-rose-600 dark:text-rose-400">Gagal memuat data</p>
        <p className="mt-0.5 text-muted">{msg}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Coba lagi
        </Button>
      )}
    </div>
  );
}

export function Progress({ value, tone, className }: { value: number; tone?: 'auto' | 'brand'; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const color = tone === 'brand' ? 'bg-gradient-brand' : v > 85 ? 'bg-rose-500' : v > 65 ? 'bg-amber-500' : 'bg-gradient-brand';
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)}>
      <div className={clsx('h-full rounded-full transition-all duration-700', color)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Gauge({ value, label, sub, size = 112 }: { value: number; label: string; sub?: string; size?: number }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const r = 42;
  const c = 2 * Math.PI * r;
  const arc = c * 0.75;
  const color = v > 85 ? '#f43f5e' : v > 65 ? '#f59e0b' : 'url(#gauge-grad)';
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox="0 0 100 100" className="-mb-3">
        <defs>
          <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="var(--brand-2)" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="9" strokeDasharray={`${arc} ${c}`} strokeLinecap="round" transform="rotate(135 50 50)" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeDasharray={`${(arc * v) / 100} ${c}`}
          strokeLinecap="round"
          transform="rotate(135 50 50)"
          style={{ transition: 'stroke-dasharray .8s ease' }}
        />
        <text x="50" y="52" textAnchor="middle" className="fill-fg" style={{ fontSize: 19, fontWeight: 700 }}>
          {Math.round(v)}%
        </text>
      </svg>
      <p className="text-xs font-semibold">{label}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

export function StatCard({ label, value, icon, sub, tone = 'cyan', trend }: { label: string; value: ReactNode; icon: ReactNode; sub?: ReactNode; tone?: 'cyan' | 'violet' | 'green' | 'orange' | 'rose' | 'blue'; trend?: ReactNode }) {
  const map = {
    cyan: 'from-cyan-500/20 to-cyan-500/0 text-cyan-500',
    violet: 'from-violet-500/20 to-violet-500/0 text-violet-500',
    green: 'from-emerald-500/20 to-emerald-500/0 text-emerald-500',
    orange: 'from-orange-500/20 to-orange-500/0 text-orange-500',
    rose: 'from-rose-500/20 to-rose-500/0 text-rose-500',
    blue: 'from-blue-500/20 to-blue-500/0 text-blue-500',
  };
  return (
    <Card className="relative overflow-hidden p-4">
      <div className={clsx('pointer-events-none absolute -right-6 -top-6 size-24 rounded-full bg-gradient-to-br blur-xl', map[tone])} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">{label}</p>
          <p className="mt-1.5 truncate text-2xl font-bold tracking-tight">{value}</p>
          {sub && <p className="mt-1 truncate text-xs text-muted">{sub}</p>}
        </div>
        <div className={clsx('flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br', map[tone])}>{icon}</div>
      </div>
      {trend && <div className="relative mt-2">{trend}</div>}
    </Card>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface-2 p-1">
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={clsx('rounded-lg px-3 py-1.5 text-xs font-medium transition', value === it.value ? 'bg-surface text-fg shadow-sm dark:bg-elevated' : 'text-muted hover:text-fg')}
        >
          {it.label}
          {it.count !== undefined && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-[10px] text-muted">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={clsx(
          'animate-in relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl dark:bg-elevated',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-xl',
          size === 'lg' && 'sm:max-w-3xl',
          size === 'xl' && 'sm:max-w-5xl',
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          <IconButton title="Tutup" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Toast & Confirm ----------
type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}
interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  danger?: boolean;
}

interface FeedbackCtx {
  toast: (kind: ToastKind, title: string, message?: string) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackCtx | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const seq = useRef(0);

  const toast = useCallback((kind: ToastKind, title: string, message?: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-4), { id, kind, title, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...opts, resolve })), []);

  const close = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirm(null);
  };

  const icon = { success: <CheckCircle2 className="size-5 text-emerald-500" />, error: <XCircle className="size-5 text-rose-500" />, info: <Info className="size-5 text-cyan-500" />, warning: <AlertTriangle className="size-5 text-amber-500" /> };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="animate-in pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-xl dark:bg-elevated">
            {icon[t.kind]}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              {t.message && <p className="mt-0.5 break-words text-xs text-muted">{t.message}</p>}
            </div>
            <button className="text-subtle hover:text-fg" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <Modal
        open={!!confirmState}
        onClose={() => close(false)}
        title={confirmState?.title ?? ''}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Batal
            </Button>
            <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {confirmState?.confirmText ?? 'Ya, lanjutkan'}
            </Button>
          </>
        }
      >
        <div className="flex gap-3 text-sm text-muted">
          {confirmState?.danger && <AlertTriangle className="size-5 shrink-0 text-amber-500" />}
          <div>{confirmState?.message}</div>
        </div>
      </Modal>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback di luar FeedbackProvider');
  return ctx;
}

/** Jalankan aksi async dengan toast sukses/gagal otomatis. */
export function useAction() {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (success) toast('success', success);
        return r;
      } catch (err) {
        toast('error', 'Gagal', err instanceof Error ? err.message : String(err));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy };
}

export function SearchInput({ value, onChange, placeholder = 'Cari...' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <svg className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input className="input h-9 w-56 pl-8" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 truncate text-right font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
