import { useEffect, useState, type ReactNode } from "react";

interface ConfirmButtonProps {
  onConfirm: () => void;
  confirmLabel: string;
  className: string;
  disabled?: boolean;
  children: ReactNode;
}

/** A destructive button that needs a second tap within 3 seconds (no browser dialogs). */
export function ConfirmButton({ onConfirm, confirmLabel, className, disabled, children }: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={armed ? `${className} is-armed` : className}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
