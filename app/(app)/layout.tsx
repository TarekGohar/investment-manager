import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { ToastProvider } from "@/components/toast-provider";

// Auth gating happens in proxy.ts (cookie presence) and inside each page
// (full session verification). Keeping this layout synchronous lets the
// Suspense boundary created by loading.tsx fire on client navigations —
// otherwise the per-request auth await blocks the segment swap and the
// previous page stays frozen until the new one is ready.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </ToastProvider>
  );
}
