import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Supabase auth callback.
 *
 * Handles the `?code=` exchange used by recovery and invite links. The tokens
 * arrive as a query parameter rather than a URL fragment, which is what lets
 * the session be established server-side — a fragment never reaches the server,
 * so a fragment-based link would leave the middleware seeing a logged-out user.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/set-password";

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Sign-in link was missing or malformed")}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Recovery links are single-use and time-limited; a second click lands here.
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("That link has expired or was already used. Ask an administrator for a new one.")}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
