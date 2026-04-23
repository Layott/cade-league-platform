import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Plan 39 M1 — widened so non-admin staff roles (loc, idc, referee,
// production) can reach /admin/*. Per-page + per-action perm checks (via
// requirePermAsync) still gate every individual surface, so this is purely
// "may you cross the /admin/* threshold." `viewer`, `coach`, `team_manager`,
// `player`, `design`, `technical` stay out.
const ADMIN_ROLES = new Set([
  "admin",
  "loc",
  "idc",
  "referee",
  "production",
  "moderator",
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
  if (!isAdmin && !isPlayerArea && !isRefereeArea) return NextResponse.next();

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
  matcher: ["/admin/:path*", "/player/:path*", "/referee/:path*"],
};
