import type { ReactNode } from "react";

export function AiCard({
  title,
  generatedAgo = "30m ago",
  children,
  footer,
}: {
  title: string;
  generatedAgo?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="mb-[26px] rounded-card border border-border bg-panel px-6 py-[22px]">
      <h3 className="mb-[10px] text-[16px] font-semibold">{title}</h3>
      <div className="mb-4 inline-flex items-center gap-[6px] text-xs text-muted">
        <span className="h-2 w-2 rounded-full bg-gradient-to-br from-brand to-brand-3" />
        AI generated · {generatedAgo}
      </div>
      <div className="space-y-3 text-[14px] leading-[1.65] text-soft">{children}</div>
      {footer ? <div className="mt-2">{footer}</div> : null}
    </section>
  );
}

export function ReadMoreButton({ label = "Read more" }: { label?: string }) {
  return (
    <button
      type="button"
      className="block w-full rounded-[24px] border border-border bg-panel-2 py-[13px] text-center text-sm font-semibold text-text transition-colors hover:bg-hover"
    >
      {label}
    </button>
  );
}
