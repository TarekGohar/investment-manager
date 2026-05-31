"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ToastVariant = "success" | "error" | "info";

export type ToastInput = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Override the default 4s auto-dismiss; pass 0 for sticky. */
  durationMs?: number;
};

type Toast = ToastInput & { id: string };

type ToastContextValue = {
  toast: (input: ToastInput) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let counter = 0;
function nextId() {
  counter += 1;
  return `t-${Date.now()}-${counter}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId();
      const duration = input.durationMs ?? 4000;
      setToasts((current) => [...current, { ...input, id }]);
      if (duration > 0) {
        window.setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue["toast"] {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Render-time helpers that may run outside a provider (rare) just no-op
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn("useToast called outside <ToastProvider> — toast suppressed.");
    }
    return () => {};
  }
  return ctx.toast;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-[calc(100vw-32px)] flex-col gap-2 sm:bottom-6 sm:right-6">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  const accent =
    toast.variant === "error"
      ? "bg-danger"
      : toast.variant === "success"
        ? "bg-success"
        : "bg-brand";

  return (
    <div
      className={`pointer-events-auto flex w-[320px] max-w-full items-start gap-3 rounded-card border border-border bg-panel px-4 py-3 shadow-2xl transition-all duration-200 ease-out ${
        entered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
      role="status"
      aria-live="polite"
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${accent}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text">{toast.title}</div>
        {toast.description ? (
          <div className="mt-0.5 text-xs leading-relaxed text-muted">{toast.description}</div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted hover:text-text"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
