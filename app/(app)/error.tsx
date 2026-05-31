"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const hint = looksLikeStalePrisma(error.message)
    ? "Your dev server is running an older Prisma client. Stop it (Ctrl-C) and run `npm run dev` again."
    : null;

  return (
    <div className="flex min-h-[calc(100vh-72px)] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-card border border-border bg-panel p-6">
        <h2 className="text-[18px] font-semibold">Something went wrong</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {error.message || "An unexpected error occurred."}
        </p>
        {hint ? (
          <p className="mt-3 rounded-[10px] border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            {hint}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-2 rounded-[24px] bg-gradient-to-r from-brand to-brand-3 px-5 py-2.5 text-sm font-semibold text-white transition-[filter] hover:brightness-110"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

function looksLikeStalePrisma(message: string): boolean {
  return (
    /Cannot read properties of undefined \(reading '(count|findUnique|findMany|create|update|delete)'\)/.test(
      message,
    ) ||
    /Unknown (field|argument)/.test(message) ||
    /no such column/i.test(message)
  );
}
