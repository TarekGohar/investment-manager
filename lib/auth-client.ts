"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";
import { resolveBaseUrl } from "@/lib/base-url";

export const authClient = createAuthClient({
  baseURL: resolveBaseUrl(),
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, useSession } = authClient;
