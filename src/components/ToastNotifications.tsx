'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { X, Check, AlertCircle, Info, Radio } from 'lucide-react';

// ─── Toast Types ───
type ToastType = 'success' | 'error' | 'info' | 'realtime';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  createdAt: number;
}

// ─── Module-level store ───
let toasts: Toast[] = [];
let listeners: Array<() => void> = [];

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getSnapshot() {
  return toasts;
}

function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emitChange();
}

/** Show a toast notification. Call from anywhere (no hook needed). */
export function showToast(type: ToastType, message: string) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const toast: Toast = { id, type, message, createdAt: Date.now() };

  // Dedupe: skip if identical message exists within last 2s
  const isDupe = toasts.some(
    (t) => t.message === message && t.type === type && Date.now() - t.createdAt < 2000
  );
  if (isDupe) return;

  toasts = [...toasts.slice(-2), toast]; // Keep max 3
  emitChange();

  // Auto-dismiss
  const duration = type === 'error' ? 5000 : 3000;
  setTimeout(() => removeToast(id), duration);
}

// ─── Style config ───
const TOAST_STYLES: Record<ToastType, { bg: string; border: string; text: string; icon: typeof Check }> = {
  success: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', icon: Check },
  error:   { bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-800',     icon: AlertCircle },
  info:    { bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-800',    icon: Info },
  realtime:{ bg: 'bg-violet-50',  border: 'border-violet-200',  text: 'text-violet-800',  icon: Radio },
};

// ─── Component ───
export default function ToastNotifications() {
  const currentToasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (currentToasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {currentToasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  const style = TOAST_STYLES[toast.type];
  const Icon = style.icon;

  useEffect(() => {
    // Slide in
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    setTimeout(onDismiss, 200);
  }, [onDismiss]);

  return (
    <div
      className={`
        pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5
        rounded-lg border shadow-sm max-w-[340px]
        transition-all duration-200 ease-out
        ${style.bg} ${style.border}
        ${visible && !exiting ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}
      `}
    >
      <Icon size={15} className={`${style.text} mt-0.5 shrink-0`} />
      <p className={`text-[13px] leading-snug ${style.text} flex-1`}>
        {toast.message}
      </p>
      <button
        onClick={handleDismiss}
        className={`${style.text} opacity-40 hover:opacity-70 mt-0.5 shrink-0 cursor-pointer`}
      >
        <X size={13} />
      </button>
    </div>
  );
}
