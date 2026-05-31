import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto mt-12 max-w-md rounded-card border border-border bg-panel px-8 py-12 text-center">
      {icon ? (
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-panel-2 text-muted">
          {icon}
        </div>
      ) : null}
      <h2 className="text-[18px] font-semibold">{title}</h2>
      {description ? (
        <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
