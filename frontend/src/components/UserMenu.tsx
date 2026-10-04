import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { errorMessage } from "../lib/errors";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

/** Avatar button in the header: who is signed in, sign out, and delete account. */
export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  if (!user) return null;

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="user-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="user-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${ids}-menu` : undefined}
        aria-label={`Account menu for ${user.display_name}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{user.initials}</span>
      </button>
      {open && (
        <div className="user-pop" id={`${ids}-menu`} ref={menu} role="menu" aria-label="Account" onKeyDown={onMenuKey}>
          <div className="user-pop-head">
            <span className="user-avatar user-avatar-lg" aria-hidden="true">{user.initials}</span>
            <span className="user-pop-who">
              <strong>{user.display_name}</strong>
              <span className="user-pop-email">{user.email}</span>
            </span>
          </div>
          {user.is_demo && (
            <p className="user-pop-demo">Shared demo account: anyone can see and change it. It resets every day.</p>
          )}
          <button type="button" role="menuitem" className="user-pop-item" disabled={busy} onClick={() => void signOut()}>
            <Icon name="logout" />
            {busy ? "Signing out…" : "Sign out"}
          </button>
          {!user.is_demo && (
            <button
              type="button"
              role="menuitem"
              className="user-pop-item user-pop-danger"
              onClick={() => {
                close(false);
                setConfirming(true);
              }}
            >
              <Icon name="trash" />
              Delete account…
            </button>
          )}
        </div>
      )}
      {confirming && (
        <DeleteAccountDialog
          onClose={() => {
            setConfirming(false);
            button.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { deleteAccount } = useAuth();
  const navigate = useNavigate();
  const ids = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) {
      setError("Enter your password to confirm.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(password);
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.password ?? err.message) : errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Sheet labelledBy={`${ids}-title`} onClose={onClose} side="right" className="delete-sheet">
      <form className="delete-account" onSubmit={(event) => void submit(event)} noValidate>
        <div className="delete-head">
          <span className="delete-icon" aria-hidden="true">
            <Icon name="alert" />
          </span>
          <h2 id={`${ids}-title`}>Delete your account?</h2>
        </div>
        <p>
          This permanently deletes your recipes, shopping list, meal plan and history. It can&apos;t be undone.
        </p>
        <div className={`field${error ? " has-error" : ""}`}>
          <label htmlFor={`${ids}-password`}>Your password</label>
          <input
            id={`${ids}-password`}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-error` : undefined}
          />
          {error && (
            <p className="field-error" id={`${ids}-error`} role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Keep my account
          </button>
          <button type="submit" className="btn btn-danger-solid" disabled={busy}>
            {busy ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
