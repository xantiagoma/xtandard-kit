import * as React from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { Check, Copy, X } from "lucide-react";
import { cn } from "../lib/utils.ts";
import { portalContainerRef } from "../lib/portal-container.ts";
import { Button } from "./ui-bits.tsx";
import { useToast } from "./Toast.tsx";

/* ─── Spinner ───────────────────────────────────────────────────────────────── */

/** A 16px spinning ring in the current text colour. */
export function Spinner({ className }: { className?: string }): React.ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={cn("animate-spin", className)}
      aria-hidden
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="24"
        strokeDashoffset="12"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A centred spinner with a label, for a view that is still loading. */
export function LoadingRow({ label }: { label: string }): React.ReactElement {
  return (
    <div className="mt-8 flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
      <Spinner />
      {label}
    </div>
  );
}

/* ─── Mono ──────────────────────────────────────────────────────────────────── */

/** Keys/ids render in the mono face per the design system. */
export function Mono({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return <span className={cn("font-mono text-[12px] text-foreground", className)}>{children}</span>;
}

/* ─── Page layout ───────────────────────────────────────────────────────────── */

/** Page wrapper with the shared max width and gutters (`wide` for tables and charts). */
export function Page({
  children,
  wide,
  className,
}: {
  children: React.ReactNode;
  wide?: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn("mx-auto px-4 py-8 sm:px-6", wide ? "max-w-7xl" : "max-w-6xl", className)}>
      {children}
    </div>
  );
}

/** A view's title row: heading, optional description and right-aligned actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ─── SectionCard ───────────────────────────────────────────────────────────── */

/** A bordered card with a titled header row and a padded body. */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}): React.ReactElement {
  return (
    <section className={cn("rounded-xl border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      <div className={cn("px-4 py-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ─── StatCard ──────────────────────────────────────────────────────────────── */

/** A KPI tile: uppercase label, a large tabular value, an optional hint and icon. */
export function StatCard({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** Extra classes for the value (e.g. `"text-success"`). */
  tone?: string;
  icon?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {icon ? <span className="text-muted-foreground/70">{icon}</span> : null}
      </div>
      <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums tracking-tight", tone)}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* ─── ModalDialog ───────────────────────────────────────────────────────────── */

/** A centred modal (Base UI Dialog), portaled into the embed wrapper when there is one. */
export function ModalDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}): React.ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal container={portalContainerRef()}>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-card text-card-foreground shadow-2xl outline-none",
            wide ? "max-w-2xl" : "max-w-md",
          )}
        >
          <div className="border-b border-border px-5 py-4">
            <Dialog.Title className="text-[15px] font-semibold text-foreground">
              {title}
            </Dialog.Title>
            {description ? (
              <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </Dialog.Description>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
            {children}
          </div>
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ─── ConfirmDialog ─────────────────────────────────────────────────────────── */

/** A {@link ModalDialog} with Cancel / confirm buttons (`danger` for destructive actions). */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  confirmLabel,
  danger,
  loading,
  children,
  confirmDisabled,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  children: React.ReactNode;
  confirmDisabled?: boolean;
}): React.ReactElement {
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={loading}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </ModalDialog>
  );
}

/* ─── Drawer (side sheet) ───────────────────────────────────────────────────── */

/** A right-hand sheet for details and long forms. */
export function Drawer({
  open,
  onClose,
  title,
  description,
  actions,
  children,
  footer,
  className,
  bodyClassName,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Header actions, left of the close button. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Extra classes for the sheet (e.g. `"max-w-xl"` to narrow it). */
  className?: string;
  bodyClassName?: string;
}): React.ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal container={portalContainerRef()}>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          data-testid="drawer"
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col border-l border-border bg-background text-foreground shadow-2xl outline-none",
            "transition-transform duration-200 data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full",
            className,
          )}
        >
          <div className="flex items-start gap-3 border-b border-border bg-card px-6 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-[15px] font-semibold text-foreground">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 truncate text-xs text-muted-foreground">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            {actions}
            <Dialog.Close
              aria-label="Close"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto", bodyClassName)}>{children}</div>
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-border bg-card px-6 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ─── EmptyCard ─────────────────────────────────────────────────────────────── */

/** A dashed placeholder card for empty lists, with an optional icon and call to action. */
export function EmptyCard({
  children,
  icon,
  action,
  className,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-4 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="flex size-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          {icon}
        </div>
      ) : null}
      <div className="max-w-sm text-[13px] text-muted-foreground">{children}</div>
      {action}
    </div>
  );
}

/* ─── CopyButton ────────────────────────────────────────────────────────────── */

/**
 * An icon button that copies `text` to the clipboard with a brief check-mark. A denied clipboard
 * shows an error toast; `toastMessage` also toasts on success.
 */
export function CopyButton({
  text,
  label = "Copy",
  className,
  toastMessage,
}: {
  text: string;
  /** Accessible name, e.g. "Copy event id". */
  label?: string;
  className?: string;
  toastMessage?: string;
}): React.ReactElement {
  const toast = useToast();
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          if (!navigator.clipboard) throw new Error("no clipboard");
          await navigator.clipboard.writeText(text);
          setCopied(true);
          if (toastMessage) toast.add("success", toastMessage, text);
        } catch {
          toast.add("error", "Could not copy to the clipboard");
        }
      }}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors",
        "hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
    </button>
  );
}
