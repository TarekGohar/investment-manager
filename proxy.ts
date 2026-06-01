import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_PATHS = new Set<string>(["/sign-in"]);
const PUBLIC_PREFIXES = ["/api/auth", "/api/cron"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // getSessionCookie only checks token presence, not validity. That's fine
  // here as a fast gate to avoid hitting the DB for obviously-unauthed
  // requests; the page itself revalidates and can redirect on its own if
  // the cookie is stale. Don't use cookie presence to bounce authed users
  // off /sign-in — that creates a loop when the cookie is expired.
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const signInUrl = new URL("/sign-in", request.url);
    if (pathname !== "/") {
      signInUrl.searchParams.set("next", pathname + request.nextUrl.search);
    }
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

// Skip Next internals, static files, and image optimization
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
