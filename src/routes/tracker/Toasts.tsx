// Person B: tiny in-app toast system for XP / level / achievement moments.
// Mount <ToastHost /> once (TrackerPage); fire from anywhere with toast().

import { useEffect, useState } from "react";

interface Toast {
  id: number;
  emoji: string;
  title: string;
  sub?: string;
}

let pushToast: ((t: Omit<Toast, "id">) => void) | null = null;
let nextId = 1;

/** Show a toast. Safe to call before/without a mounted host (no-op). */
export function toast(emoji: string, title: string, sub?: string) {
  pushToast?.({ emoji, title, sub });
}

export default function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    pushToast = (t) => {
      const id = nextId++;
      setToasts((prev) => [...prev.slice(-2), { ...t, id }]); // max 3 on screen
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, 4200);
    };
    return () => {
      pushToast = null;
    };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="toast-emoji">{t.emoji}</span>
          <span className="toast-body">
            <span className="toast-title">{t.title}</span>
            {t.sub && <span className="toast-sub muted">{t.sub}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
