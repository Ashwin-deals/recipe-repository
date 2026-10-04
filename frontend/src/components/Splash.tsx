import { ChefMark } from "./ChefMark";

/** Shown while the session is checked, so the sign-in page and the app never flash past each other. */
export function Splash() {
  return (
    <div className="splash" role="status" aria-live="polite">
      <span className="splash-mark">
        <ChefMark />
      </span>
      <span className="splash-text">Opening your recipe box…</span>
    </div>
  );
}
