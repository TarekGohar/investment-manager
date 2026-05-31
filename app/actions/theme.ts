"use server";

import { cookies } from "next/headers";
import { THEME_COOKIE_NAME, type Theme } from "@/lib/theme";

export async function setThemeAction(theme: Theme): Promise<void> {
  const store = await cookies();
  store.set(THEME_COOKIE_NAME, theme, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}
