import type { ReactNode } from "react";

/**
 * Admin "control center" kit — deliberately minimal, monochrome, dense.
 *
 * This is a moderation console, not a consumer surface: no glass cards, no brand
 * gradients, no purple "aura" accents. Type is small and utilitarian, data lives
 * in hairline-bordered tables, and colour is used only as *information* (small
 * status dots), never as decoration. See /admin — kept intentionally boring.
 */

/* Shared control classes — string constants so client components (rows, forms)
   can style their own <button>/<input> without importing runtime components. */
export const ctrl =
  "inline-flex items-center gap-1.5 rounded-[3px] border border-glass-border bg-transparent px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-card hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";

export const ctrlDanger =
  "inline-flex items-center gap-1.5 rounded-[3px] border border-error/25 bg-transparent px-2.5 py-1 text-xs font-medium text-error/90 transition-colors hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-40";

export const field =
  "h-8 rounded-[3px] border border-glass-border bg-input px-2.5 text-sm text-fg outline-none placeholder:text-fg-disabled focus:border-fg-muted";

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-fg-muted">
      {children}
    </p>
  );
}

const nf = new Intl.NumberFormat("en-US");

export function PageHeader({
  title,
  count,
  sub,
}: {
  title: string;
  count?: number;
  sub?: string;
}) {
  return (
    <header className="mb-5 border-b border-glass-border pb-4">
      <div className="flex items-baseline gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-fg">{title}</h1>
        {count !== undefined && (
          <span className="font-mono text-xs text-fg-muted">{nf.format(count)}</span>
        )}
      </div>
      {sub && <p className="mt-1 text-xs text-fg-muted">{sub}</p>}
    </header>
  );
}

const DOT: Record<string, string> = {
  success: "bg-success",
  error: "bg-error",
  warning: "bg-warning",
  info: "bg-verified",
  neutral: "bg-fg-disabled",
};

/** Small coloured dot + label — the only place colour is allowed, as status. */
export function StatusDot({ tone = "neutral", label }: { tone?: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone] ?? DOT.neutral}`} />
      {label}
    </span>
  );
}

/** Monospace inline tag (categories, short enums). */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[3px] border border-glass-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-fg-muted">
      {children}
    </span>
  );
}

/* --- Table primitives --------------------------------------------------- */

export function Table({
  children,
  minWidth = 640,
}: {
  children: ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto rounded-[4px] border border-glass-border">
      <table
        className="w-full border-collapse text-sm"
        style={{ minWidth: `${minWidth}px` }}
      >
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`border-b border-glass-border px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-fg-muted ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2.5 align-middle ${className}`}>{children}</td>;
}

export const rowClass =
  "border-b border-glass-border last:border-0 transition-colors hover:bg-card/50";
