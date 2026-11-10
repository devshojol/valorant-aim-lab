import { useEffect, useState, type ReactNode } from 'react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="font-display text-sm font-semibold uppercase tracking-[0.25em] text-accent">{kicker}</div>
        <h1 className="font-display text-4xl font-bold uppercase leading-none text-ink md:text-5xl">{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function Card({ children, className, title, right }: { children: ReactNode; className?: string; title?: string; right?: ReactNode }) {
  return (
    <section className={cx('border border-line bg-panel/90 p-5', className)}>
      {(title || right) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="font-display text-lg font-semibold uppercase tracking-wider text-ink">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  className,
  title,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: 'button' | 'submit';
}) {
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-5 py-2.5 text-base', lg: 'px-8 py-4 text-xl' };
  const variants = {
    primary: 'bg-accent text-white hover:bg-[#ff5d6a] active:translate-y-px',
    ghost: 'bg-transparent text-mute hover:text-ink hover:bg-white/5',
    outline: 'border border-line bg-panel2 text-ink hover:border-mute',
    danger: 'border border-accent/50 bg-accent/10 text-accent hover:bg-accent/20',
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'clip-angle-sm inline-flex items-center justify-center gap-2 font-display font-semibold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        sizes[size],
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
}) {
  return (
    <label className="block py-1.5">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-sm text-mute">{label}</span>
        <input
          type="number"
          className="tal-num tabular w-20 border border-line bg-bg px-2 py-0.5 text-right text-sm text-ink outline-none focus:border-accent"
          value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
          }}
        />
      </div>
      <input
        type="range"
        className="tal-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {(hint || format) && <div className="mt-1 text-xs text-dim">{hint ?? format?.(value)}</div>}
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {hint && <span className="block text-xs text-dim">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-6 w-11 shrink-0 border transition-colors', checked ? 'border-accent bg-accent/25' : 'border-line bg-bg')}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 transition-all', checked ? 'left-[22px] bg-accent' : 'left-0.5 bg-mute')} />
      </button>
    </label>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-wrap gap-1.5', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'border px-3 py-1.5 font-display text-sm font-semibold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-35',
            o.value === value ? 'border-accent bg-accent/15 text-ink' : 'border-line bg-bg/60 text-mute hover:border-mute hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className="border border-line bg-bg/50 px-4 py-3">
      <div className="text-xs uppercase tracking-widest text-dim">{label}</div>
      <div className={cx('font-display tabular text-3xl font-bold leading-tight', accent ? 'text-accent' : 'text-ink')}>{value}</div>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-2">
      <div className="mb-2 text-xs uppercase tracking-widest text-dim">{label}</div>
      {children}
    </div>
  );
}

export function Badge({ children, tone = 'mute' }: { children: ReactNode; tone?: 'mute' | 'accent' | 'ok' | 'warn' }) {
  const tones = {
    mute: 'border-line text-mute',
    accent: 'border-accent/50 text-accent',
    ok: 'border-ok/40 text-ok',
    warn: 'border-warn/40 text-warn',
  };
  return <span className={cx('inline-flex items-center border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider', tones[tone])}>{children}</span>;
}

/** Two-step destructive action (no browser confirm() — it is unavailable in embedded viewers). */
export function ConfirmButton({ children, confirmLabel = 'Click again to confirm', onConfirm, size = 'sm' }: { children: ReactNode; confirmLabel?: string; onConfirm: () => void; size?: 'sm' | 'md' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      variant="danger"
      size={size}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}
