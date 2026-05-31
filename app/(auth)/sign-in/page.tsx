import { Suspense } from "react";
import type { Metadata } from "next";
import { SignInForm } from "@/components/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="w-full max-w-[420px]">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-3 text-2xl font-bold text-white">
          P
        </div>
        <h1 className="text-[24px] font-semibold leading-tight">Welcome back</h1>
        <p className="mt-2 text-sm text-muted">
          Sign in with your email — we&apos;ll send you a magic link.
        </p>
      </div>
      <Suspense fallback={<div className="h-64 rounded-card border border-border bg-panel" />}>
        <SignInForm />
      </Suspense>
    </div>
  );
}
