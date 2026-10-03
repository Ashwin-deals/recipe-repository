import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  id?: string;
  children?: ReactNode;
}

/** Consistent page masthead: small mono kicker, big display title, actions on the right. */
export function PageHeader({ eyebrow, title, id, children }: PageHeaderProps) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="display" id={id}>
          {title}
        </h1>
      </div>
      {children && <div className="page-head-actions">{children}</div>}
    </header>
  );
}
