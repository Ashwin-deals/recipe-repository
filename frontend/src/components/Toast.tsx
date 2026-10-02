import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ToastContext } from "../hooks/useToast";

interface ToastMessage {
  id: number;
  message: string;
  error: boolean;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(0);

  const show = useCallback((message: string, options?: { error?: boolean }) => {
    const id = ++nextId.current;
    setToasts((current) => [...current, { id, message, error: Boolean(options?.error) }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={toast.error ? "toast is-error" : "toast"} role={toast.error ? "alert" : "status"}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
