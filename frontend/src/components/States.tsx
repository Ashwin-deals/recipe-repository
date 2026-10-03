import type { ReactNode } from "react";
import { Illustration } from "./Illustration";

type SkeletonKind = "cards" | "list" | "block";

/** Skeleton placeholders shaped like the content, so nothing jumps when data arrives. */
export function LoadingState({ label, kind = "block" }: { label: string; kind?: SkeletonKind }) {
  return (
    <div className={`skeleton-wrap skeleton-${kind}`} role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {kind === "cards" &&
        [0, 1, 2, 3].map((i) => (
          <div className="skeleton-card" key={i} aria-hidden="true">
            <div className="skeleton skeleton-cover" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
          </div>
        ))}
      {kind === "list" &&
        [0, 1, 2, 3, 4].map((i) => <div className="skeleton skeleton-row" key={i} aria-hidden="true" />)}
      {kind === "block" && (
        <>
          <div className="skeleton skeleton-line" aria-hidden="true" />
          <div className="skeleton skeleton-panel" aria-hidden="true" />
        </>
      )}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <Illustration name="torn" />
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ illustration, children }: { illustration: "basket" | "pot" | "calendar" | "chart"; children: ReactNode }) {
  return (
    <div className="state state-empty">
      <Illustration name={illustration} />
      {children}
    </div>
  );
}
