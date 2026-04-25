import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Plan 39 M1 — widened so non-admin staff roles (loc, idc, referee,
// production) can reach /admin/*. Per-page + per-action perm checks (via
// requirePermAsync) still gate every individual surface, so this is purely
// "may you cross the /admin/* threshold." `viewer`, `coach`, `team_manager`,
// `player`, `design`, `technical` stay out.
// Plan 51 — design + technical added so they can reach the new
// /admin/tournament + /admin/broadcast/v2 surfaces. Per-page perm checks
// still gate the actual sub-routes.
const ADMIN_ROLES = new Set([
  "admin",
  "loc",
  "idc",
  "referee",
  "production",
  "moderator",
  "design",
  "technical",
]);
// Plan 51 — sub-area role gates inside /admin. The outer ADMIN_ROLES set
// is the threshold check; these narrower sets reject early when a user
// crossed the threshold via some other tab but cannot enter this surface.
// Per-action perm checks (requirePermAsync) still re-validate.
const ADMIN_TOURNAMENT_ROLES = new Set([
  "admin",
  "loc",
  "idc",
  "technical",
]);
const ADMIN_BROADCAST_V2_ROLES = new Set([
  "admin",
  "technical",
  "production",
  "design",
]);
const PLAYER_AREA_ROLES = new Set([
  "admin",
  "moderator",
  "player",
  "loc",
  "referee",
]);
// Plan 46 — /referee/* is the simplified attendance surface for refs.
// Admins + moderators keep access for oversight / QA; everyone else is
// bounced. Per-action perm re-checks (attendance.mark / attendance.edit)
// still gate the server-action writes.
const REFEREE_AREA_ROLES = new Set(["admin", "moderator", "referee"]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAdmin = pathname.startsWith("/admin");
  const isPlayerArea = pathname.startsWith("/player");
  const isRefereeArea = pathname.startsWith("/referee");
  const isOverlayV2 = pathname.startsWith("/overlay/v2");
  const isRoot = pathname === "/";

  // Plan 51 — /overlay/v2/* is public (browser-source pull, no auth) but
  // is gated by per-overlay view_token validation inside each page. The
  // matcher includes it so future view_token enforcement can hook in
  // here without re-touching middleware.config.matcher.
  if (isOverlayV2) return NextResponse.next();

  if (!isAdmin && !isPlayerArea && !isRefereeArea && !isRoot)
    return NextResponse.next();

  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookies) {
          cookies.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Root route: unauthenticated visitors land on /welcome unless they
  // explicitly opted out with ?nolanding=1 (used by the "Public site" link
  // on /welcome so signed-out readers can still browse fixtures).
  if (isRoot) {
    if (user) return NextResponse.next();
    const nolanding = req.nextUrl.searchParams.get("nolanding");
    if (nolanding === "1") return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/welcome";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const { data: pub } = await supabase
    .from("users")
    .select("id")
    .eq("supabase_auth_id", user.id)
    .single();
  if (!pub) return NextResponse.redirect(new URL("/login", req.url));

  const { data: rolesRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);

  if (isAdmin) {
    const allowed = roles.some((r) => ADMIN_ROLES.has(r));
    if (!allowed) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    // Plan 51 — sub-area gates. Per-page requirePermAsync still re-checks
    // the actual perm; this is the cheap "may you even see the route"
    // threshold check so wrong-role staff get a 403 instead of a server
    // error from a missing perm.
    if (pathname.startsWith("/admin/tournament")) {
      const ok = roles.some((r) => ADMIN_TOURNAMENT_ROLES.has(r));
      if (!ok) return new NextResponse("Forbidden", { status: 403 });
    }
    if (pathname.startsWith("/admin/broadcast/v2")) {
      const ok = roles.some((r) => ADMIN_BROADCAST_V2_ROLES.has(r));
      if (!ok) return new NextResponse("Forbidden", { status: 403 });
    }
    return res;
  }

  if (isRefereeArea) {
    const allowed = roles.some((r) => REFEREE_AREA_ROLES.has(r));
    if (!allowed) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    return res;
  }

  // /player/** — any authenticated user whose roles include player (or an
  // admin/moderator/ref impersonation path). Admins + refs still need to see
  // this area for impersonation QA; the server action layer re-checks perms.
  const allowed = roles.some((r) => PLAYER_AREA_ROLES.has(r));
  if (!allowed) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return res;
}

export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/player/:path*",
    "/referee/:path*",
    // Plan 51 — overlay v2 routes added so future view_token validation
    // can hook into middleware. Today the body just NextResponse.next()'s.
    "/overlay/v2/:path*",
  ],
};
