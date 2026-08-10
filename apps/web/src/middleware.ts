import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Refreshes the Supabase session cookie on every request.
 *
 * Without this, access tokens expire mid-session and Server Components start
 * seeing a logged-out user at random — which presents to a salesperson as being
 * kicked to the login screen halfway through writing call notes.
 *
 * This does NOT authorise anything. It only keeps the cookie fresh; whether the
 * user may see the CRM is decided by `requireUser`, which additionally checks
 * for an active row in our own `users` table.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  /**
   * Machine endpoints must never be redirected to a login page.
   *
   * `/v1/*` is the public ingestion API — it authenticates with a bearer API
   * key, and a website posting a lead would otherwise receive a 307 to /login
   * and silently drop the enquiry. `/api/cron/*` authenticates with the cron
   * bearer token for the same reason.
   *
   * Both do their own authentication; what they must not inherit is the
   * browser session check.
   */
  const isMachineEndpoint = path.startsWith("/v1") || path.startsWith("/api/");
  const isPublic = path.startsWith("/login") || path.startsWith("/auth") || path === "/health";

  if (isMachineEndpoint) return response;

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve the destination so a session timeout returns the user to what
    // they were actually doing.
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
