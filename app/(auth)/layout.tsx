import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 pb-[calc(3rem+env(safe-area-inset-bottom))] pt-[calc(3rem+env(safe-area-inset-top))]">
      {children}
    </div>
  );
}
