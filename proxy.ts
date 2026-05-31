import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_PATHS = new Set<string>(["/sign-in"]);
const PUBLIC_PREFIXES = ["/api/auth"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);

  // Authed user trying to reach sign-in → bounce home
  if (sessionCookie && pathname === "/sign-in") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Unauthed user trying to reach protected route → bounce to sign-in,
  // preserving the destination so we can resume after auth
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
