'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { clsx } from 'clsx';

// ─── Types ──────────────────────────────────────────────────────
export type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

// ─── Context ────────────────────────────────────────────────────
const ToastContext = createContext<ToastContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────
const DISMISS_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = 'info') => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, message, variant }]);

      const timer = setTimeout(() => dismiss(id), DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  // Cleanup on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Toast viewport */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none max-w-sm w-full"
      >
        {toasts.map((t) => (
          <ToastItemComponent
            key={t.id}
            item={t}
            onDismiss={() => dismiss(t.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return ctx;
}

// ─── Single toast ───────────────────────────────────────────────
const variantStyles: Record<ToastVariant, string> = {
  success: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-200',
  error: 'bg-red-500/20 border-red-500/30 text-red-200',
  info: 'bg-brand-500/20 border-brand-500/30 text-brand-200',
};

const variantIcons: Record<ToastVariant, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
};

function ToastItemComponent({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className={clsx(
        'pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3',
        'text-sm font-medium shadow-lg backdrop-blur-md',
        'animate-fade-in',
        variantStyles[item.variant],
      )}
    >
      <span aria-hidden="true" className="mt-0.5 text-base shrink-0">
        {variantIcons[item.variant]}
      </span>
      <span className="flex-1 min-w-0">{item.message}</span>
      <button
        onClick={onDismiss}
        aria-label="Fechar notificação"
        className="shrink-0 mt-0.5 text-current opacity-60 hover:opacity-100 transition-opacity"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
