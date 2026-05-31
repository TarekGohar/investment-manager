import "server-only";
import { cookies } from "next/headers";

export type Theme = "dark" | "light";

const COOKIE_NAME = "theme";
const DEFAULT: Theme = "dark";

export async function getThemeFromCookie(): Promise<Theme> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  return raw === "light" ? "light" : raw === "dark" ? "dark" : DEFAULT;
}

export const THEME_COOKIE_NAME = COOKIE_NAME;
