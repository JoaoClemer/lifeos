import { Banknote, Check, ChevronLeft, ChevronRight, CreditCard, Landmark, QrCode, Ticket, Wallet, X } from "lucide-react";
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, useEffect, useId, useRef } from "react";
import { formatBRL } from "../shared/money";
import { addMonths, monthTitle } from "../shared/month";
import type { AccountType } from "../shared/types";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const cls = cx("rounded-2xl border border-border bg-surface", onClick && "cursor-pointer text-left active:scale-[0.995] transition", className);
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(cls, "block w-full")}>
      {children}
    </button>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("space-y-2", className)}>
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({
  variant = "primary",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: "bg-accent text-accent-fg hover:brightness-110",
    secondary: "bg-surface-2 text-text hover:brightness-95 dark:hover:brightness-125",
    ghost: "text-accent hover:bg-accent-soft",
    danger: "text-danger hover:bg-danger-soft",
  };
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition disabled:opacity-50 active:scale-[0.98]",
        styles[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-sm font-semibold text-accent hover:underline">
      {children}
    </button>
  );
}

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="animate-fade absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        className="animate-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-surface shadow-2xl md:max-w-lg md:rounded-3xl"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="-mr-2 rounded-full p-2 text-muted hover:bg-surface-2">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto px-5">
          {/* padding no filho (não no container de rolagem) para o rodapé fixo colar no fundo */}
          <div className="pb-4">{children}</div>
        </div>
        {footer && (
          <div className="border-t border-border px-5 pt-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputCls =
  "h-11 w-full rounded-xl border border-border bg-surface-2 px-3 text-base outline-none transition placeholder:text-muted/70 focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/20";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(inputCls, "h-auto min-h-[5.5rem] py-2.5", props.className)} />;
}

/** Entrada de dinheiro "estilo app de banco": os dígitos preenchem da direita (5 → 0,05 → 0,54 → 5,48). */
export function MoneyInput({
  value,
  onChange,
  big,
  id,
  autoFocus,
  placeholder = "0,00",
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  big?: boolean;
  id?: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const text = value == null ? "" : (value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className={cx("relative", big && "py-1")}>
      <span className={cx("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-medium text-muted", big ? "text-xl" : "text-base")}>R$</span>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(-11);
          onChange(digits ? Number(digits) : null);
        }}
        onFocus={(e) => {
          const el = e.target;
          requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
        }}
        className={cx(inputCls, "num pl-10", big && "h-16 pl-12 text-3xl font-semibold")}
      />
    </div>
  );
}

export interface ChipOption<T> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export function Chips<T extends string | number | null>({
  options,
  value,
  onChange,
  wrap,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (v: T) => void;
  wrap?: boolean;
}) {
  return (
    <div className={cx("-mx-1 flex gap-2 px-1", wrap ? "flex-wrap" : "no-scrollbar overflow-x-auto pb-0.5")}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition",
              active ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-text hover:bg-surface-2",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl bg-surface-2 p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-9 min-w-0 flex-1 rounded-lg font-semibold transition",
            // 5+ opções: texto menor para caber em telas de celular estreitas
            options.length > 4 ? "px-0.5 text-[13px] sm:text-sm" : "px-2 text-sm",
            o.value === value ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-4 py-1">
      <span>
        <span className="block text-[15px] font-medium">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-7 w-12 rounded-full bg-border transition peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40" />
        <span className="absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function MonthStepper({
  value,
  onChange,
  allowClear,
  placeholder = "Sem data",
  fallback,
}: {
  value: string | null;
  onChange: (m: string | null) => void;
  allowClear?: boolean;
  placeholder?: string;
  fallback: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-11 flex-1 items-center justify-between rounded-xl border border-border bg-surface-2 px-1">
        <button type="button" aria-label="Mês anterior" className="rounded-lg p-2 text-muted hover:bg-surface" onClick={() => onChange(addMonths(value ?? fallback, -1))}>
          <ChevronLeft size={18} />
        </button>
        <span className={cx("text-[15px] font-medium", !value && "text-muted")}>{value ? monthTitle(value) : placeholder}</span>
        <button type="button" aria-label="Próximo mês" className="rounded-lg p-2 text-muted hover:bg-surface" onClick={() => onChange(addMonths(value ?? fallback, value ? 1 : 0))}>
          <ChevronRight size={18} />
        </button>
      </div>
      {allowClear && value && (
        <button type="button" onClick={() => onChange(null)} className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Limpar">
          <X size={18} />
        </button>
      )}
    </div>
  );
}

/** `goal`: chegar a 100% é bom (verde). Padrão (limite): perto do fim fica laranja, estourado fica vermelho. */
export function Progress({ value, max, className, goal }: { value: number; max: number; className?: string; goal?: boolean }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : value > 0 ? 100 : 0;
  const tone = goal ? (pct >= 100 ? "bg-success" : "bg-accent") : value > max ? "bg-danger" : pct >= 85 ? "bg-warn" : "bg-accent";
  return (
    <div className={cx("h-2 overflow-hidden rounded-full bg-surface-2", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full transition-[width] duration-500", tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={cx("num", className)}>{formatBRL(cents)}</span>;
}

export function CheckCircle({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-pressed={checked}
      aria-label={label}
      className={cx(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition",
        checked ? "border-success bg-success text-white" : "border-border text-transparent hover:border-success",
      )}
    >
      <Check size={16} strokeWidth={3} />
    </button>
  );
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-10 text-center">
      <div className="mb-3 rounded-full bg-surface-2 p-3 text-muted">{icon}</div>
      <p className="font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function AccountIcon({ type, size = 16 }: { type: AccountType | null; size?: number }) {
  switch (type) {
    case "credit":
      return <CreditCard size={size} />;
    case "pix":
      return <QrCode size={size} />;
    case "voucher":
      return <Ticket size={size} />;
    case "cash":
      return <Banknote size={size} />;
    case "debit":
      return <Landmark size={size} />;
    default:
      return <Wallet size={size} />;
  }
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "danger" | "success" }) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    accent: "bg-accent-soft text-accent",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", tones[tone])}>{children}</span>;
}

export function Row({
  title,
  subtitle,
  right,
  left,
  onClick,
  label,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  left?: ReactNode;
  onClick?: () => void;
  /** Nome acessível da linha quando o título não é texto simples. */
  label?: string;
}) {
  const inner = (
    <>
      {left && <div className="pointer-events-auto relative flex shrink-0">{left}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{title}</div>
        {subtitle && <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">{subtitle}</div>}
      </div>
      {right && <div className="shrink-0 text-right">{right}</div>}
    </>
  );
  if (!onClick) return <div className="flex w-full items-center gap-3 px-4 py-3">{inner}</div>;
  // Botão "por baixo" ocupando a linha toda: permite ter outro botão (ex.: check) dentro da linha sem aninhar <button>
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={label ?? (typeof title === "string" ? title : undefined)}
        className="absolute inset-0 transition hover:bg-surface-2/60 active:bg-surface-2"
      />
      <div className="pointer-events-none relative flex w-full items-center gap-3 px-4 py-3">{inner}</div>
    </div>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <Card className="divide-y divide-border overflow-hidden">{children}</Card>;
}
